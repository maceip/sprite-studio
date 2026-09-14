import { test } from "node:test";
import assert from "node:assert/strict";
import { AnimationVerificationHarness, type RawFrame } from "../server/pipeline/harness.js";
import { SpriteSegmenter, type BoundingBox } from "../server/pipeline/segmenter.js";
import { WebComponentGenerator } from "../server/pipeline/web-component.js";
import { LocalModelProvider, detectActiveProvider } from "../server/pipeline/providers.js";

function createSyntheticFrame(
  width: number,
  height: number,
  drawFn: (x: number, y: number, rgba: Uint8Array) => void
): RawFrame {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      drawFn(x, y, rgba);
    }
  }
  return { width, height, rgba };
}

test("AnimationVerificationHarness catches STIFF_LEGS_GLIDING (the ladder worker failure mode)", () => {
  const W = 100;
  const H = 100;

  // Frame sequence where upper body/ladder moves or changes, but lower legs are completely stationary
  const frames: RawFrame[] = [];
  for (let t = 0; t < 5; t++) {
    frames.push(
      createSyntheticFrame(W, H, (x, y, rgba) => {
        const idx = (y * W + x) * 4;
        // Torso & ladder (upper 58%): moves/shifts with time
        if (y >= 20 && y < 55 && x >= 40 + t * 2 && x <= 60 + t * 2) {
          rgba[idx] = 200;
          rgba[idx + 1] = 100;
          rgba[idx + 2] = 50;
          rgba[idx + 3] = 255;
        }
        // Legs (lower part >= 58%): completely frozen at x in [45, 55] across all frames
        if (y >= 58 && y <= 90 && x >= 45 && x <= 55) {
          rgba[idx] = 30;
          rgba[idx + 1] = 50;
          rgba[idx + 2] = 200;
          rgba[idx + 3] = 255;
        }
      })
    );
  }

  const result = AnimationVerificationHarness.verifyBipedLocomotion(frames);
  assert.equal(result.passed, false);
  assert.equal(result.failureReason, "STIFF_LEGS_GLIDING");
  assert.ok(result.legActivityRatio < 0.55);
});

test("AnimationVerificationHarness passes active biped treadmill walk cycle", () => {
  const W = 100;
  const H = 100;

  // Frames where torso stays centered at x=50, and legs cycle back and forth (active stepping)
  const frames: RawFrame[] = [];
  for (let t = 0; t < 6; t++) {
    const legPhase = (t % 2 === 0 ? 1 : -1) * 8;
    frames.push(
      createSyntheticFrame(W, H, (x, y, rgba) => {
        const idx = (y * W + x) * 4;
        // Centered torso
        if (y >= 20 && y < 55 && x >= 42 && x <= 58) {
          rgba[idx] = 200;
          rgba[idx + 1] = 100;
          rgba[idx + 2] = 50;
          rgba[idx + 3] = 255;
        }
        // Stepping alternating legs
        if (y >= 58 && y <= 90 && x >= 50 + legPhase - 5 && x <= 50 + legPhase + 5) {
          rgba[idx] = 30;
          rgba[idx + 1] = 50;
          rgba[idx + 2] = 200;
          rgba[idx + 3] = 255;
        }
      })
    );
  }

  const result = AnimationVerificationHarness.verifyBipedLocomotion(frames);
  assert.equal(result.passed, true);
  assert.equal(result.failureReason, undefined);
  assert.ok(result.legActivityRatio >= 0.55);
  assert.ok(result.driftPx < 12);
});

test("AnimationVerificationHarness catches CANVAS_DRIFT_OFF_CENTER when character travels off canvas", () => {
  const W = 100;
  const H = 100;

  // Character translating 25px horizontally across canvas
  const frames: RawFrame[] = [];
  for (let t = 0; t < 5; t++) {
    const shift = t * 6; // 0, 6, 12, 18, 24 px drift
    frames.push(
      createSyntheticFrame(W, H, (x, y, rgba) => {
        const idx = (y * W + x) * 4;
        if (y >= 20 && y <= 85 && x >= 30 + shift && x <= 50 + shift) {
          rgba[idx] = 180;
          rgba[idx + 1] = 120;
          rgba[idx + 2] = 60;
          rgba[idx + 3] = 255;
        }
      })
    );
  }

  const result = AnimationVerificationHarness.verifyBipedLocomotion(frames);
  assert.equal(result.passed, false);
  assert.equal(result.failureReason, "CANVAS_DRIFT_OFF_CENTER");
  assert.ok(result.driftPx > 12);
});

test("AnimationVerificationHarness machinery check catches CHASSIS_WARPED and ACTUATOR_STATIC", () => {
  const W = 80;
  const H = 80;

  // 1. Static actuator (upper) -> ACTUATOR_STATIC
  const staticActuatorFrames: RawFrame[] = [];
  for (let t = 0; t < 3; t++) {
    staticActuatorFrames.push(
      createSyntheticFrame(W, H, (x, y, rgba) => {
        const idx = (y * W + x) * 4;
        // Upper boom is completely static
        if (y < 40 && x >= 30 && x <= 50) {
          rgba[idx] = 255;
          rgba[idx + 1] = 200;
          rgba[idx + 2] = 0;
          rgba[idx + 3] = 255;
        }
        // Lower chassis
        if (y >= 40 && y < 70 && x >= 20 && x <= 60) {
          rgba[idx] = 80;
          rgba[idx + 1] = 80;
          rgba[idx + 2] = 80;
          rgba[idx + 3] = 255;
        }
      })
    );
  }

  const staticResult = AnimationVerificationHarness.verifyMachineryKinematics(staticActuatorFrames);
  assert.equal(staticResult.passed, false);
  assert.equal(staticResult.failureReason, "ACTUATOR_STATIC");

  // 2. Actuator moves, but chassis warps heavily -> CHASSIS_WARPED
  const warpedFrames: RawFrame[] = [];
  for (let t = 0; t < 4; t++) {
    warpedFrames.push(
      createSyntheticFrame(W, H, (x, y, rgba) => {
        const idx = (y * W + x) * 4;
        // Upper boom moves
        if (y < 40 && x >= 30 && x <= 30 + t * 6) {
          rgba[idx] = 255;
          rgba[idx + 1] = 200;
          rgba[idx + 2] = 0;
          rgba[idx + 3] = 255;
        }
        // Lower chassis warps/shifts heavily across frames
        if (y >= 40 && y < 70 && x >= 10 && x <= 70) {
          const val = t % 2 === 0 ? 30 : 220;
          rgba[idx] = val;
          rgba[idx + 1] = val;
          rgba[idx + 2] = val;
          rgba[idx + 3] = 255;
        }
      })
    );
  }

  const warpResult = AnimationVerificationHarness.verifyMachineryKinematics(warpedFrames);
  assert.equal(warpResult.passed, false);
  assert.equal(warpResult.failureReason, "CHASSIS_WARPED");
});

test("SpriteSegmenter isolates connected objects from multi-asset pseudo sheets", () => {
  const W = 200;
  const H = 200;
  const bg = [230, 235, 236]; // Light gray background like construction sheet

  // Draw 2 separate objects (e.g. Dump truck and Forklift)
  const sheet = createSyntheticFrame(W, H, (x, y, rgba) => {
    const idx = (y * W + x) * 4;
    rgba[idx] = bg[0];
    rgba[idx + 1] = bg[1];
    rgba[idx + 2] = bg[2];
    rgba[idx + 3] = 255;

    // Object 1: top-left (Dump truck)
    if (x >= 20 && x <= 60 && y >= 20 && y <= 60) {
      rgba[idx] = 240;
      rgba[idx + 1] = 180;
      rgba[idx + 2] = 20;
    }

    // Object 2: bottom-right (Forklift)
    if (x >= 120 && x <= 170 && y >= 110 && y <= 160) {
      rgba[idx] = 40;
      rgba[idx + 1] = 120;
      rgba[idx + 2] = 220;
    }
  });

  const detectedBg = SpriteSegmenter.detectBackgroundColor(sheet.rgba, W, H);
  assert.deepEqual(detectedBg, bg);

  const boxes = SpriteSegmenter.segmentConnectedComponents(sheet.rgba, W, H, {
    bgColor: bg as [number, number, number],
    colorThreshold: 20,
    minArea: 100,
  });

  assert.equal(boxes.length, 2);
  assert.ok(boxes[0].x >= 18 && boxes[0].x <= 22);
  assert.ok(boxes[1].x >= 118 && boxes[1].x <= 122);

  // Test normalized 128x128 extraction with ground anchoring
  const normalized = SpriteSegmenter.extractNormalizedFrame(sheet.rgba, W, H, boxes[0], 128, bg as [number, number, number]);
  assert.equal(normalized.length, 128 * 128 * 4);
});

test("WebComponentGenerator outputs valid standard Custom Element code", () => {
  const code = WebComponentGenerator.generateHappyMeterComponent({
    tag: "happy-meter",
    className: "HappyMeterElement",
  });
  assert.ok(code.includes("class HappyMeterElement extends HTMLElement"));
  assert.ok(code.includes("customElements.define('happy-meter', HappyMeterElement)"));
  assert.ok(code.includes("observedAttributes"));
  assert.ok(code.includes("getDialCoordinates"));

  const actorCode = WebComponentGenerator.generateSpriteActorComponent();
  assert.ok(actorCode.includes("class SpriteActorElement extends HTMLElement"));
  assert.ok(actorCode.includes("customElements.define('sprite-actor', SpriteActorElement)"));
});

test("LocalModelProvider is extensible and detectActiveProvider respects environment", () => {
  const local = new LocalModelProvider("http://127.0.0.1:11434");
  assert.equal(local.type, "local");
  assert.equal(local.isConfigured, true);

  const active = detectActiveProvider();
  assert.ok(["openai", "openrouter", "local"].includes(active));
});
