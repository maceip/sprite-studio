// Image generation via OpenRouter or OpenAI Images API.

import { spawn } from "node:child_process";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENAI_BASE = "https://api.openai.com/v1";

export const IMAGE_MODELS = [
  { id: "gpt-image-2.5-flare-2026-09-08", label: "OpenAI GPT Image 2.5 Flare" },
  { id: "gpt-image-2.5-sunburst-2026-09-08", label: "OpenAI GPT Image 2.5 Sunburst" },
] as const;

export type ImageModelId =
  | (typeof IMAGE_MODELS)[number]["id"]
  | "openai/gpt-image-2.5-flare-2026-09-08"
  | "openai/gpt-image-2.5-sunburst-2026-09-08"
  | "openai/gpt-image-2.5-flare"
  | "openai/gpt-image-2.5-sunburst"
  | "gpt-image-2.5-flare"
  | "gpt-image-2.5-sunburst"
  | "openai/gpt-image-2"
  | "gpt-image-2"
  | "chatgpt-image-latest"
  | "x-ai/grok-imagine-image-2.0"
  | "dall-e-3"
  | "dall-e-2";

export const DEFAULT_IMAGE_MODEL: ImageModelId = "gpt-image-2.5-flare-2026-09-08";

export function isImageModelId(value: unknown): value is ImageModelId {
  return (
    typeof value === "string" &&
    (IMAGE_MODELS.some((model) => model.id === value) ||
      value === "gpt-image-2.5-flare-2026-09-08" ||
      value === "gpt-image-2.5-sunburst-2026-09-08" ||
      value === "openai/gpt-image-2.5-flare-2026-09-08" ||
      value === "openai/gpt-image-2.5-sunburst-2026-09-08" ||
      value === "openai/gpt-image-2.5-flare" ||
      value === "openai/gpt-image-2.5-sunburst" ||
      value === "gpt-image-2.5-flare" ||
      value === "gpt-image-2.5-sunburst" ||
      value === "openai/gpt-image-2" ||
      value === "gpt-image-2" ||
      value === "chatgpt-image-latest" ||
      value === "x-ai/grok-imagine-image-2.0" ||
      value === "dall-e-3" ||
      value === "dall-e-2")
  );
}

export type ImageProvider = "openai" | "openrouter";

export function getActiveImageProvider(model?: string): ImageProvider {
  const explicit = process.env.IMAGE_PROVIDER?.toLowerCase().trim();
  if (explicit === "openai" || explicit === "openrouter") {
    return explicit;
  }

  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY);
  const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);

  // If the model is an xAI model, only OpenRouter can serve it
  if (model?.startsWith("x-ai/") && hasOpenRouter) {
    return "openrouter";
  }

  // If OPENAI_API_KEY is available, use OpenAI
  if (hasOpenAi) {
    return "openai";
  }

  return "openrouter";
}

const CHROMA_DIRECTIVE =
  "Place the subject on a perfectly flat solid pure chroma green background, " +
  "hex #00b140 (RGB 0, 177, 64). The background must be one uniform color " +
  "with no gradients, no shadows, no lighting variation, and no texture. " +
  "The subject itself must contain no green elements that could conflict " +
  "with chroma keying. Centered, full subject visible.";

interface ImageGenerationResponse {
  data?: Array<{
    b64_json?: string;
    url?: string;
    media_type?: string;
  }>;
  error?: { message?: string; code?: string | number } | string;
}

function isPng(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  );
}

export async function normalizeImageToPng(
  base64: string,
  declaredMediaType?: string,
): Promise<string> {
  const source = Buffer.from(base64, "base64");
  if (isPng(source)) return base64;

  const png = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let stderr = "";
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      const message = "code" in err && err.code === "ENOENT" ? "ffmpeg is not installed" : err.message;
      reject(new Error(`Image conversion to PNG failed: ${message}`));
    });
    child.stdin.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code !== "EPIPE") reject(err);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        const detail = stderr.trim() ? `: ${stderr.trim()}` : ` (ffmpeg exited with ${code})`;
        const format = declaredMediaType ? ` (${declaredMediaType})` : "";
        reject(new Error(`Image conversion to PNG failed${detail}${format}`));
        return;
      }
      const output = Buffer.concat(chunks);
      if (!isPng(output)) {
        reject(new Error("Image conversion did not produce a valid PNG"));
        return;
      }
      resolve(output);
    });

    child.stdin.end(source);
  });

  return png.toString("base64");
}

async function generateSpriteImageOpenAI(
  prompt: string,
  model: string,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  if (model.startsWith("x-ai/")) {
    throw new Error(
      `${model} is an xAI model and cannot be generated using the OpenAI API. Please choose an OpenAI model or configure OPENROUTER_API_KEY.`,
    );
  }

  const openAiModel = model.replace(/^openai\//, "");

  if (openAiModel.startsWith("dall-e")) {
    throw new Error(
      "DALL·E 3 has been retired by OpenAI. Please choose 'gpt-image-2.5-flare-2026-09-08' or 'gpt-image-2.5-sunburst-2026-09-08' in the model dropdown instead.",
    );
  }

  const isGpt25 = openAiModel.includes("flare") || openAiModel.includes("sunburst");
  const fullPrompt = isGpt25 ? prompt.trim() : `${prompt.trim()}\n\n${CHROMA_DIRECTIVE}`;

  const baseUrl = (process.env.OPENAI_BASE_URL ?? OPENAI_BASE).replace(/\/+$/, "");

  const body: Record<string, unknown> = {
    model: openAiModel,
    prompt: fullPrompt,
    quality: "medium",
    output_format: "png",
    ...(isGpt25 ? { background: "auto" } : {}),
  };

  const res = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as ImageGenerationResponse;

  if (!res.ok) {
    const message =
      typeof json.error === "string"
        ? json.error
        : json.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`OpenAI image generation failed: ${message}`);
  }

  const image = json.data?.[0];
  if (!image) {
    throw new Error("OpenAI response did not include an image");
  }

  let base64 = image.b64_json;
  if (!base64 && image.url) {
    const imgRes = await fetch(image.url);
    if (!imgRes.ok) {
      throw new Error(`Failed to fetch generated image from URL (${imgRes.status})`);
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    base64 = buf.toString("base64");
  }

  if (!base64) {
    throw new Error("OpenAI response did not include image data");
  }

  return normalizeImageToPng(base64, image.media_type);
}

async function generateSpriteImageOpenRouter(
  prompt: string,
  model: string,
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  let orModel = model;
  if (!orModel.startsWith("openai/") && !orModel.startsWith("x-ai/")) {
    const baseSlug = orModel.replace(/-\d{4}-\d{2}-\d{2}$/, "");
    orModel = `openai/${baseSlug}`;
  }

  const isGpt25 = orModel.includes("flare") || orModel.includes("sunburst");
  const fullPrompt = isGpt25 ? prompt.trim() : `${prompt.trim()}\n\n${CHROMA_DIRECTIVE}`;

  const res = await fetch(`${OPENROUTER_BASE}/images`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: orModel,
      prompt: fullPrompt,
      ...(isGpt25 ? { quality: "medium", background: "auto", output_format: "png" } : {}),
    }),
  });

  const json = (await res.json().catch(() => ({}))) as ImageGenerationResponse;

  if (!res.ok) {
    const message =
      typeof json.error === "string"
        ? json.error
        : json.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`OpenRouter image generation failed: ${message}`);
  }

  const image = json.data?.[0];
  if (!image?.b64_json) {
    throw new Error("OpenRouter response did not include an image");
  }

  return normalizeImageToPng(image.b64_json, image.media_type);
}

export async function generateSpriteImage(
  prompt: string,
  model: string = DEFAULT_IMAGE_MODEL,
): Promise<string> {
  const provider = getActiveImageProvider(model);
  if (provider === "openai") {
    return generateSpriteImageOpenAI(prompt, model);
  }
  return generateSpriteImageOpenRouter(prompt, model);
}
