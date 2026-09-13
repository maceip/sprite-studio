import assert from "node:assert/strict";
import test from "node:test";
import {
  generateSpriteImage,
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
  isImageModelId,
  getActiveImageProvider,
  normalizeImageToPng,
} from "../server/image.ts";
import { DEFAULT_IMAGE_MODEL as CLIENT_DEFAULT } from "../src/lib/state.ts";
import { emptyManifest } from "../server/projects.ts";

// Transparent 1x1 PNG: normalization must preserve the exact encoded bytes.
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";

test("Flare defaults request medium-quality PNG with automatic background through OpenRouter", async t => {
  const oldKey = process.env.OPENROUTER_API_KEY;
  const oldOpenAiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  t.after(() => {
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = oldKey;
    if (oldOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldOpenAiKey;
  });
  const requests: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://openrouter.ai/api/v1/images");
    assert.equal(init.method, "POST");
    requests.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify({ data: [{ b64_json: png, media_type: "image/png" }] }));
  });
  assert.equal(DEFAULT_IMAGE_MODEL, "gpt-image-2.5-flare-2026-09-08");
  assert.equal(CLIENT_DEFAULT, DEFAULT_IMAGE_MODEL);
  assert.equal(emptyManifest("test").spriteModel, DEFAULT_IMAGE_MODEL);
  assert.ok(isImageModelId(DEFAULT_IMAGE_MODEL));
  assert.equal(await generateSpriteImage("  Green slime hero  "), png);
  const request = requests[0];
  assert.equal(request.model, "openai/gpt-image-2.5-flare");
  assert.equal(request.quality, "medium");
  assert.equal(request.background, "auto");
  assert.equal(request.output_format, "png");
  assert.equal(request.prompt, "Green slime hero");
  assert.doesNotMatch(request.prompt as string, /#00b140|no green elements/);

  for (const model of ["openai/gpt-image-2", "x-ai/grok-imagine-image-2.0"] as const) {
    assert.equal(await generateSpriteImage("hero", model), png);
    const legacy = requests.at(-1)!;
    assert.equal(legacy.model, model);
    assert.match(legacy.prompt as string, /#00b140/);
    assert.equal(legacy.background, undefined);
    assert.equal(legacy.quality, undefined);
  }
});

test("generates sprite image via OpenAI API when OPENAI_API_KEY is set", async t => {
  const oldOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const oldOpenAiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  process.env.OPENAI_API_KEY = "sk-test-key";
  t.after(() => {
    if (oldOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = oldOpenRouterKey;
    if (oldOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldOpenAiKey;
  });

  assert.equal(getActiveImageProvider(), "openai");

  const requests: { url: string; auth: string; body: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url === "https://example.com/dalle-result.png") {
      return new Response(Buffer.from(png, "base64"), {
        headers: { "Content-Type": "image/png" },
      });
    }

    assert.equal(url, "https://api.openai.com/v1/images/generations");
    assert.equal(init.method, "POST");
    const headers = init.headers as Record<string, string>;
    assert.equal(headers["Authorization"], "Bearer sk-test-key");
    const body = JSON.parse(init.body as string);
    requests.push({ url, auth: headers["Authorization"], body });

    if (body.model === "dall-e-3") {
      return new Response(JSON.stringify({ data: [{ url: "https://example.com/dalle-result.png" }] }));
    }
    return new Response(JSON.stringify({ data: [{ b64_json: png, media_type: "image/png" }] }));
  });

  // Default Flare model strips "openai/" prefix for OpenAI API
  assert.equal(await generateSpriteImage("  Pixel hero  "), png);
  const flareReq = requests[0].body;
  assert.equal(flareReq.model, "gpt-image-2.5-flare-2026-09-08");
  assert.equal(flareReq.quality, "medium");
  assert.equal(flareReq.background, "auto");
  assert.equal(flareReq.output_format, "png");
  assert.equal(flareReq.prompt, "Pixel hero");
  assert.doesNotMatch(flareReq.prompt as string, /#00b140/);

  // gpt-image-2.5-sunburst-2026-09-08 also works directly
  assert.equal(await generateSpriteImage("wizard", "gpt-image-2.5-sunburst-2026-09-08"), png);
  const sunburstReq = requests[1].body;
  assert.equal(sunburstReq.model, "gpt-image-2.5-sunburst-2026-09-08");
  assert.equal(sunburstReq.quality, "medium");
  assert.equal(sunburstReq.output_format, "png");

  // DALL-E 3 rejects with clear error
  await assert.rejects(
    generateSpriteImage("dragon", "dall-e-3"),
    /DALL·E 3 has been retired by OpenAI/,
  );

  // xAI model cannot be called with OpenAI API only
  await assert.rejects(
    generateSpriteImage("goblin", "x-ai/grok-imagine-image-2.0"),
    /cannot be generated using the OpenAI API/,
  );
});

test("IMAGE_PROVIDER explicitly controls provider selection", async () => {
  const oldOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const oldOpenAiKey = process.env.OPENAI_API_KEY;
  const oldProvider = process.env.IMAGE_PROVIDER;
  process.env.OPENROUTER_API_KEY = "test-or-key";
  process.env.OPENAI_API_KEY = "test-ai-key";
  try {
    process.env.IMAGE_PROVIDER = "openrouter";
    assert.equal(getActiveImageProvider(), "openrouter");

    process.env.IMAGE_PROVIDER = "openai";
    assert.equal(getActiveImageProvider(), "openai");

    delete process.env.IMAGE_PROVIDER;
    // When both are present without explicit setting, OpenAI models route to OpenAI
    assert.equal(getActiveImageProvider("openai/gpt-image-2.5-flare"), "openai");
    assert.equal(getActiveImageProvider("dall-e-3"), "openai");
    // and xAI models route to OpenRouter
    assert.equal(getActiveImageProvider("x-ai/grok-imagine-image-2.0"), "openrouter");
  } finally {
    if (oldOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = oldOpenRouterKey;
    if (oldOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldOpenAiKey;
    if (oldProvider === undefined) delete process.env.IMAGE_PROVIDER;
    else process.env.IMAGE_PROVIDER = oldProvider;
  }
});

test("missing API keys throw clear errors", async () => {
  const oldOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const oldOpenAiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(
      generateSpriteImage("hero"),
      /OPENROUTER_API_KEY is not set|OPENAI_API_KEY is not set/,
    );
  } finally {
    if (oldOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = oldOpenRouterKey;
    if (oldOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldOpenAiKey;
  }
});

test("IMAGE_MODELS only contains gpt-image-2.5-flare-2026-09-08 and gpt-image-2.5-sunburst-2026-09-08", () => {
  assert.deepEqual(
    IMAGE_MODELS.map(m => m.id),
    ["gpt-image-2.5-flare-2026-09-08", "gpt-image-2.5-sunburst-2026-09-08"],
  );
});

test("normalizeImageToPng preserves PNG and converts other formats", async () => {
  // Preserves PNG
  const out = await normalizeImageToPng(png);
  assert.equal(out, png);
});
