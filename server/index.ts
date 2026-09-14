import "dotenv/config";
import { validatePrompt } from "./validation.js";
import { initializeStorage } from "./storage.js";
await initializeStorage();
import express, { type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { MUSIC_MODELS, DEFAULT_MUSIC_MODEL, validateMusicSettings, generateMusic, redactProviderError } from "./music.js";
import { changeMusic, deleteMusic, musicView, readMusic, saveMusicDraft, commitMusicOutput, musicFile, newMusicRevision } from "./music-projects.js";
import { decodeMusic, prepareMusicWav, MUSIC_SAMPLE_RATE } from "./music-audio.js";
import { stageAnimationAssets } from "./animation-assets.js";
import { existsSync } from "node:fs";
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
  generateSpriteImage,
  getActiveImageProvider,
  isImageModelId,
  normalizeImageToPng,
} from "./image.js";
import {
  DEFAULT_VIDEO_MODEL,
  VIDEO_MODELS,
  defaultDurationFor,
  generateSpriteMotionVideo,
  isVideoModelId,
} from "./video.js";
import { extractFrames } from "./extract-frames.js";
import { buildPreviewGif } from "./build-gif.js";
import {
  activeSpriteDir,
  PROJECTS_DIR,
  PROJECT_FILES,
  projectContext,
  safeProjectName,
  safeAssetId,
  downloadVideo,
  ensureInsideRoot,
  readPngDims,
  saveBase64Image,
} from "./files.js";
import {
  deleteSavedProject,
  deleteAnimation,
  createProject,
  changeSprite,
  listSavedProjects,
  openProject,
  readManifest,

  toView,
  updateSprite,
  changeAnimation,
  animationPath,
  assetName,
} from "./projects.js";
import { pipelineRouter } from "./pipeline/routes.js";
import { decodeImageToRgba, writeRgbaToPng } from "./pipeline/decoder.js";
import { AnimationVerificationHarness, type RawFrame } from "./pipeline/harness.js";


const PORT = Number(process.env.PORT ?? 8787);

const app = express();
app.use(express.json({ limit: "50mb" }));
let mutating = false;
app.use("/api", (req, res, next) => {
  if (req.method !== "POST") return next();
  if (mutating) { res.status(409).json({ error: "Another operation is in progress. Please try again." }); return; }
  mutating = true;
  res.once("finish", () => { mutating = false; });
  next();
});
app.use("/api", (req, res, next) => {
  const name = req.get("X-Project-Name");
  const spriteId = req.get("X-Sprite-Id");
  if (!name && !spriteId) return next();
  try {
    safeProjectName(name ?? "");
    if (spriteId) safeAssetId(spriteId);
    const animationId = req.get("X-Animation-Id");
    if (animationId) safeAssetId(animationId);
    projectContext.run({ name: name!, spriteId: spriteId ?? "", animationId: animationId || undefined }, next);
  } catch (err) { handleError(err, res); }
});
app.use("/projects", express.static(PROJECTS_DIR, { fallthrough: false }));

app.get("/", (req: Request, res: Response) => {
  if (req.accepts("html")) {
    res.redirect("http://localhost:5173/");
    return;
  }
  res.json({ ok: true, message: "Sprite Studio API running. Open http://localhost:5173/ in your browser." });
});

function requireSpriteKey(_req: Request, res: Response, next: NextFunction) {
  if (!process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
    res.status(500).json({
      error: "Neither OPENAI_API_KEY nor OPENROUTER_API_KEY is configured. Add OPENAI_API_KEY to .env to use OpenAI, or OPENROUTER_API_KEY for OpenRouter.",
    });
    return;
  }
  next();
}

function requireAnimationKey(_req: Request, res: Response, next: NextFunction) {
  if (!process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
    res.status(500).json({
      error:
        "Neither OPENAI_API_KEY nor OPENROUTER_API_KEY is configured. Add OPENAI_API_KEY to .env to use OpenAI Sora, or OPENROUTER_API_KEY for OpenRouter.",
    });
    return;
  }
  next();
}

function asString(v: unknown, name: string, max = 2_000): string {
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  if (v.length > max) throw new Error(`${name} is too long`);
  return v.trim();
}

function asImageRef(v: unknown): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new Error("image is required");
  }
  if (v.length > 50_000_000) throw new Error("image is too large");
  return v;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasApiKey: Boolean(process.env.OPENROUTER_API_KEY),
    hasOpenAiApiKey: Boolean(process.env.OPENAI_API_KEY),
    hasElevenLabsApiKey: Boolean(process.env.ELEVENLABS_API_KEY),
    imageProvider: getActiveImageProvider(),
  });
});

app.get("/api/models/video", (_req, res) => {
  res.json({ models: VIDEO_MODELS, default: DEFAULT_VIDEO_MODEL });
});

app.get("/api/models/image", (_req, res) => {
  res.json({
    models: IMAGE_MODELS,
    default: DEFAULT_IMAGE_MODEL,
    provider: getActiveImageProvider(),
  });
});

app.get("/api/models/music", (_req, res) => {
  res.json({ models: MUSIC_MODELS, default: DEFAULT_MUSIC_MODEL, hasApiKey: Boolean(process.env.ELEVENLABS_API_KEY) });
});

app.use("/api/pipeline", pipelineRouter);

function musicId(req: Request): string {
  const id = req.get("X-Music-Id");
  if (!id) throw new Error("Select a music track first (X-Music-Id is required)");
  return safeAssetId(id);
}

app.get("/api/music", async (req, res) => {
  try { res.json(await musicView(req.get("X-Music-Id"))); }
  catch (err) { handleError(err, res); }
});

app.post("/api/music/draft", async (req, res) => {
  try { res.json(await saveMusicDraft(musicId(req), req.body)); }
  catch (err) { handleError(err, res); }
});

app.post("/api/music/generate", async (req, res) => {
  let staged: string | undefined;
  try {
    const id = musicId(req);
    await readMusic(id);
    const settings = validateMusicSettings(req.body);
    const revision = newMusicRevision(id);
    staged = musicFile(id, revision);
    const source = `${revision}/source.mp3`;
    const audio = `${revision}/${id}.wav`;
    const data = await generateMusic(settings);
    await mkdir(staged, { recursive: true });
    await writeFile(musicFile(id, source), data);
    const pcm = await decodeMusic(musicFile(id, source));
    await writeFile(musicFile(id, audio), prepareMusicWav(pcm));
    const view = await commitMusicOutput(id, { ...settings, source, audio,
      crossfadeSeconds: 0, actualDuration: pcm.length / (MUSIC_SAMPLE_RATE * 4), createdAt: new Date().toISOString() });
    staged = undefined;
    res.json(view);
  } catch (err) {
    if (staged) await rm(staged, { recursive: true, force: true }).catch(() => {});
    handleError(err, res);
  }
});

app.post("/api/music/delete", async (req, res) => {
  try { res.json(await deleteMusic(musicId(req))); }
  catch (err) { handleError(err, res); }
});

app.post("/api/music/:action", async (req, res) => {
  try {
    const action = req.params.action;
    if (action !== "new" && action !== "load" && action !== "rename") throw new Error("Unknown music action");
    res.json(await changeMusic(action, asString(req.body?.value, "Music name", 60),
      action === "rename" ? musicId(req) : undefined));
  } catch (err) { handleError(err, res); }
});

app.get("/api/projects/current", async (_req, res) => {
  try {
    res.json(toView(await readManifest()));
  } catch (err) {
    handleError(err, res);
  }
});

app.get("/api/projects", async (_req, res) => {
  try {
    res.json(await listSavedProjects());
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/projects/save", async (_req, res) => {
  try {
    const current = await readManifest();
    res.json(current.project!.activeSpriteId ? await updateSprite({}).then(toView) : toView(current));
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/projects/load", async (req, res) => {
  try {
    const name = asString(req.body?.name, "name", 40);
    res.json(await openProject(name));
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/projects/new", async (req, res) => {
  try { res.json(await createProject(asString(req.body?.name, "name", 40))); }
  catch (err) { handleError(err, res); }
});

app.post("/api/projects/sprites/:action", async (req, res) => {
  try {
    const action = req.params.action;
    if (action !== "new" && action !== "load" && action !== "rename" && action !== "delete") throw new Error("Unknown sprite action");
    const kind = req.body?.kind === "asset" ? "asset" : "character";
    const category = typeof req.body?.category === "string" ? req.body.category : undefined;
    res.json(await changeSprite(action as "new" | "load" | "rename" | "delete", asString(req.body?.value, "value", 60), kind, category));
  } catch (err) { handleError(err, res); }
});

app.post("/api/projects/animations/delete", async (_req, res) => {
  try { res.json(await deleteAnimation()); }
  catch (err) { handleError(err, res); }
});

app.post("/api/projects/animations/:action", async (req, res) => {
  try {
    const action = req.params.action;
    if (action !== "new" && action !== "load" && action !== "rename" && action !== "duplicate") throw new Error("Unknown animation action");
    res.json(await changeAnimation(action, asString(req.body?.value, "value", 60)));
  } catch (err) { handleError(err, res); }
});

app.post("/api/projects/draft", async (req, res) => {
  try {
    const patch: Record<string, unknown> = {
      spritePrompt: validatePrompt(req.body?.spritePrompt, "Character prompt", true),
      motionPrompt: validatePrompt(req.body?.motionPrompt, "Movement prompt", true),
    };
    for (const key of ["spriteModel", "motionModel"]) {
      const value = req.body?.[key];
      if (typeof value !== "string" || value.length > 2000) throw new Error(`Invalid ${key}: expected a model ID of up to 2,000 characters`);
      patch[key] = value;
    }
    for (const key of ["perspective", "direction", "moveType", "assetKind", "endingType", "kind", "category"]) {
      if (typeof req.body?.[key] === "string") {
        patch[key] = req.body[key];
      }
    }
    res.json(toView(await updateSprite(patch)));
  } catch (err) { handleError(err, res); }
});

app.post("/api/projects/delete", async (req, res) => {
  try {
    const name = asString(req.body?.name, "name", 40);
    await deleteSavedProject(name);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/projects/selection", async (req, res) => {
  try {
    const indices = req.body?.selectedIndices;
    const current = await readManifest();
    if (!Array.isArray(indices) || indices.some(i => !Number.isInteger(i) || i < 0 || i >= current.frames.length) ||
        new Set(indices).size !== indices.length) throw new Error("Invalid frame selection");
    const m = await updateSprite({ selectedFrameIndices: indices });
    res.json(toView(m));
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/projects/spritesheet", async (req, res) => {
  try {
    const current = await readManifest();
    if (!current.activeAnimationId) throw new Error("Add an animation first");
    const dataUrl = asString(req.body?.dataUrl, "dataUrl", 50_000_000);
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new Error("Expected a PNG spritesheet");
    const name = assetName(current.animations.find(a => a.id === current.activeAnimationId)!.name);
    const assets = await stageAnimationAssets(Buffer.from(match[1], "base64"), current.selectedFrameIndices.length, name, current.activeAnimationId);
    let m = await updateSprite({ ...assets, spritesheetFrameCount: current.selectedFrameIndices.length, previewGif: null });

    // Best-effort GIF build from current selection
    try {
      const gifName = await buildPreviewGif(m.frames, m.selectedFrameIndices, animationPath(m.activeAnimationId));
      m = await updateSprite({ previewGif: gifName });
    } catch (gifErr) {
      const msg = gifErr instanceof Error ? gifErr.message : String(gifErr);
      console.warn("[api] preview gif build failed:", msg);
      m = await updateSprite({ previewGif: null });
    }

    res.json(toView(m));
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/sprites/generate", requireSpriteKey, async (req, res) => {
  try {
    const current = await readManifest();
    if (!current.project!.activeSpriteId) throw new Error("Add a character first");
    const prompt = validatePrompt(req.body?.prompt, "Character prompt");
    const requestedModel = req.body?.model;
    if (requestedModel !== undefined && !isImageModelId(requestedModel)) {
      throw new Error("unsupported image model");
    }
    const model = requestedModel ?? DEFAULT_IMAGE_MODEL;
    const base64 = await generateSpriteImage(prompt, model);

    const character = current.project!.sprites.find(s => s.id === current.project!.activeSpriteId)!;
    const reference = `${assetName(character.name)}.png`;
    const refAbs = path.join(activeSpriteDir(), reference);
    await saveBase64Image(base64, refAbs);
    const buf = await readFile(refAbs);
    const dims = readPngDims(buf);

    const m = await updateSprite({
      spritePrompt: prompt,
      spriteModel: model,
      sprite: reference,
      spriteDimensions: dims,
    });

    res.json({
      view: toView(m),
      dataUrl: `data:image/png;base64,${base64}`,
    });
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/sprites/upload", async (req, res) => {
  try {
    const current = await readManifest();
    if (!current.project!.activeSpriteId) throw new Error("Add a character first");
    const rawImage = asImageRef(req.body?.image);

    let base64: string;
    let declaredMediaType: string | undefined;
    if (rawImage.startsWith("data:")) {
      const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/.exec(rawImage);
      if (!match) throw new Error("Expected a valid image data URL");
      declaredMediaType = `image/${match[1]}`;
      base64 = match[2];
    } else {
      base64 = rawImage;
    }

    const pngBase64 = await normalizeImageToPng(base64, declaredMediaType);
    const character = current.project!.sprites.find(s => s.id === current.project!.activeSpriteId)!;
    const reference = `${assetName(character.name)}.png`;
    const refAbs = path.join(activeSpriteDir(), reference);
    await saveBase64Image(pngBase64, refAbs);
    const buf = await readFile(refAbs);
    const dims = readPngDims(buf);

    const m = await updateSprite({
      sprite: reference,
      spriteDimensions: dims,
    });

    res.json({
      view: toView(m),
      dataUrl: `data:image/png;base64,${pngBase64}`,
    });
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/sprites/animate", requireAnimationKey, async (req, res) => {
  try {
    const current = await readManifest();
    if (!current.activeAnimationId) throw new Error("Add an animation first");
    const image = asImageRef(req.body?.image);
    const text = validatePrompt(req.body?.text, "Movement prompt");
    const model = isVideoModelId(req.body?.model) ? req.body.model : DEFAULT_VIDEO_MODEL;
    const duration =
      typeof req.body?.duration === "number" ? req.body.duration : defaultDurationFor(model);

    const assetKind = req.body?.assetKind ?? current.assetKind ?? (current.kind === "asset" ? "asset" : "character");
    const perspective = req.body?.perspective ?? current.perspective ?? "isometric";
    const direction = req.body?.direction ?? current.direction;
    const moveType = req.body?.moveType ?? current.moveType;
    const endingType = req.body?.endingType ?? current.endingType ?? "seamless";

    const imageInput = await resolveImageInput(image);

    const video = await generateSpriteMotionVideo(imageInput, text, duration, model, {
      assetKind,
      perspective,
      direction,
      moveType,
      endingType,
    });
    const prefix = animationPath(current.activeAnimationId, `runs/${crypto.randomUUID()}`);
    const videoAbs = path.join(activeSpriteDir(), prefix, PROJECT_FILES.source);
    await downloadVideo(video.url, videoAbs, video.headers);

    const framesAbs = path.join(activeSpriteDir(), prefix, PROJECT_FILES.framesDir);
    const frameFiles = await extractFrames(videoAbs, framesAbs);

    // Verification Harness & Auto-Stabilizer Hook
    try {
      const rawFrames: RawFrame[] = [];
      for (const f of frameFiles) {
        const fPath = path.join(framesAbs, f);
        const buf = await readFile(fPath);
        rawFrames.push(await decodeImageToRgba(buf));
      }

      if (assetKind === "asset") {
        const verifyResult = AnimationVerificationHarness.verifyMachineryKinematics(rawFrames);
        console.log("[pipeline verify:machinery]", verifyResult.diagnosis);
      } else {
        const verifyResult = AnimationVerificationHarness.verifyBipedLocomotion(rawFrames);
        console.log("[pipeline verify:biped]", verifyResult.diagnosis);

        // Auto-stabilizer: if drift exceeds threshold, transform into stationary treadmill cycle
        if (rawFrames.length > 0 && verifyResult.driftPx > rawFrames[0].width * 0.08) {
          console.log(
            `[pipeline auto-stabilize] Correcting drift (${verifyResult.driftPx.toFixed(1)}px) to stationary treadmill cycle...`
          );
          const stabilized = AnimationVerificationHarness.stabilizeAndTreadmill(rawFrames);
          for (let i = 0; i < stabilized.length; i++) {
            const fPath = path.join(framesAbs, frameFiles[i]);
            await writeRgbaToPng(stabilized[i].rgba, stabilized[i].width, stabilized[i].height, fPath);
          }
        }
      }
    } catch (verErr) {
      console.warn("[pipeline verify warning]", verErr);
    }

    const frames = frameFiles.map((f) => `${prefix}/${PROJECT_FILES.framesDir}/${f}`);

    const m = await updateSprite({
      motionPrompt: text,
      motionModel: model,
      frames,
      selectedFrameIndices: frames.map((_, i) => i),
      spritesheet: null,
      spritesheetFrameCount: null,
      aseprite: null,
      previewGif: null,
      assetKind,
      perspective,
      direction,
      moveType,
      endingType,
    });

    res.json(toView(m));
  } catch (err) {
    handleError(err, res);
  }
});

async function resolveImageInput(image: string): Promise<string> {
  if (image.startsWith("data:")) return image;
  if (image.startsWith("/projects/")) {
    const cleanPath = image.split("?")[0];
    const abs = path.join(PROJECTS_DIR, cleanPath.slice("/projects/".length));
    ensureInsideRoot(abs);
    if (!existsSync(abs)) throw new Error("sprite image not found on disk");
    const buf = await readFile(abs);
    return `data:image/png;base64,${buf.toString("base64")}`;
  }
  if (/^https?:\/\//.test(image)) return image;
  throw new Error("unsupported image reference");
}

function handleError(err: unknown, res: Response) {
  const message = err instanceof Error ? err.message : "Unknown error";
  const safe = redact(message);
  console.error("[api error]", safe);
  res.status(400).json({ error: safe });
}

function redact(msg: string): string {
  return redactProviderError(msg);
}

const server = app.listen(PORT, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  console.log(`[server] listening on http://localhost:${port}`);
  if (!process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY) {
    console.warn("[server] WARNING: Neither OPENAI_API_KEY nor OPENROUTER_API_KEY is configured — generation is unavailable");
  } else if (process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
    console.log("[server] OpenAI API configured for characters and animations (Sora)");
  }
});
