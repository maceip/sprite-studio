// API Router for Sprite Pipeline & Automated Verification Harness
import { Router, type Request, type Response } from "express";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { decodeImageToRgba } from "./decoder.js";
import { SpriteSegmenter } from "./segmenter.js";
import { AnimationVerificationHarness, type RawFrame } from "./harness.js";
import { WebComponentGenerator } from "./web-component.js";
import { activeSpriteDir, ensureInsideRoot } from "../files.js";
import { readManifest } from "../projects.js";

export const pipelineRouter = Router();

/**
 * POST /api/pipeline/analyze
 * Segments sprite sheets (grid or arbitrary CCA layout like construction vehicles or worker lineups)
 */
pipelineRouter.post("/analyze", async (req: Request, res: Response) => {
  try {
    const rawImage = req.body?.image;
    if (!rawImage || typeof rawImage !== "string") {
      res.status(400).json({ error: "Missing image parameter" });
      return;
    }

    let buffer: Buffer;
    if (rawImage.startsWith("data:")) {
      const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(rawImage);
      if (!match) throw new Error("Invalid base64 data URL");
      buffer = Buffer.from(match[1], "base64");
    } else if (existsSync(rawImage)) {
      // Local file reference (e.g. from Downloads or assets)
      buffer = await readFile(rawImage);
    } else {
      res.status(400).json({ error: "Image file not found" });
      return;
    }

    const decoded = await decodeImageToRgba(buffer);
    const bgColor = SpriteSegmenter.detectBackgroundColor(decoded.rgba, decoded.width, decoded.height);
    const boxes = SpriteSegmenter.segmentConnectedComponents(decoded.rgba, decoded.width, decoded.height, {
      bgColor,
      colorThreshold: req.body?.colorThreshold ?? 22,
      minArea: req.body?.minArea ?? 200,
    });

    res.json({
      ok: true,
      dimensions: { width: decoded.width, height: decoded.height },
      backgroundColor: bgColor,
      detectedObjectsCount: boxes.length,
      boundingBoxes: boxes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/pipeline/verify
 * Runs the verification harness on active animation or provided frames
 */
pipelineRouter.post("/verify", async (req: Request, res: Response) => {
  try {
    const type = req.body?.type === "machinery" ? "machinery" : "biped";
    let frames: RawFrame[] = [];

    if (Array.isArray(req.body?.frames) && req.body.frames.length > 0) {
      // Provided frame buffers / dataUrls
      for (const f of req.body.frames) {
        if (f.rgbaBase64 && f.width && f.height) {
          frames.push({
            width: f.width,
            height: f.height,
            rgba: Buffer.from(f.rgbaBase64, "base64"),
          });
        } else if (f.dataUrl) {
          const m = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(f.dataUrl);
          if (m) {
            const dec = await decodeImageToRgba(Buffer.from(m[1], "base64"));
            frames.push(dec);
          }
        }
      }
    } else {
      // Read current active animation frames from disk
      const manifest = await readManifest();
      if (!manifest.activeAnimationId) {
        res.status(400).json({ error: "No active animation to verify" });
        return;
      }
      if (!manifest.frames || !manifest.frames.length) {
        res.status(400).json({ error: "Active animation has no frames" });
        return;
      }

      for (const relFrame of manifest.frames) {
        const frameAbs = path.join(activeSpriteDir(), relFrame);
        ensureInsideRoot(frameAbs);
        if (existsSync(frameAbs)) {
          const buf = await readFile(frameAbs);
          const dec = await decodeImageToRgba(buf);
          frames.push(dec);
        }
      }
    }

    if (frames.length < 2) {
      res.status(400).json({ error: "At least 2 frames required for verification" });
      return;
    }

    if (type === "biped") {
      const result = AnimationVerificationHarness.verifyBipedLocomotion(frames);
      res.json({ ok: true, type: "biped", ...result });
    } else {
      const result = AnimationVerificationHarness.verifyMachineryKinematics(frames, {
        chassisFraction: req.body?.chassisFraction,
      });
      res.json({ ok: true, type: "machinery", ...result });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/pipeline/ui-component
 * Generates custom element code for UI sprite sheets
 */
pipelineRouter.post("/ui-component", (req: Request, res: Response) => {
  try {
    const tag = req.body?.tag || "happy-meter";
    const componentCode = WebComponentGenerator.generateHappyMeterComponent({
      tag,
      className: req.body?.className,
      sheetUrl: req.body?.sheetUrl,
      bannerUrl: req.body?.bannerUrl,
    });

    const spriteActorCode = WebComponentGenerator.generateSpriteActorComponent();

    const demoHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${tag} Demo</title>
  <style>
    body { background: #0f172a; color: #f8fafc; font-family: sans-serif; padding: 40px; display: flex; flex-direction: column; gap: 24px; align-items: center; }
    .controls { display: flex; gap: 16px; align-items: center; background: rgba(255,255,255,0.06); padding: 16px 24px; border-radius: 12px; }
    input[type=range] { width: 160px; accent-color: #38bdf8; }
  </style>
</head>
<body>
  <h2>Web Component: &lt;${tag}&gt;</h2>
  <div class="controls">
    <label>Value: <input type="range" id="valInput" min="0" max="100" value="75"></label>
    <label>Time: <input type="time" id="timeInput" value="14:00"></label>
  </div>
  <${tag} id="meter" value="75" time="14:00"></${tag}>

  <script type="module">
    ${componentCode}

    const meter = document.getElementById('meter');
    const valInput = document.getElementById('valInput');
    const timeInput = document.getElementById('timeInput');

    valInput.addEventListener('input', (e) => meter.setAttribute('value', e.target.value));
    timeInput.addEventListener('input', (e) => meter.setAttribute('time', e.target.value));
  </script>
</body>
</html>`;

    res.json({
      ok: true,
      tag,
      componentCode,
      spriteActorCode,
      demoHtml,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
