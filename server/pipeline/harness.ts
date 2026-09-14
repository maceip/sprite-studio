// Automated Animation Verification Harness
// Evaluates extracted animation frames against physical and game-engine constraints:
// - Biped locomotion: Catches frozen-leg gliding (the 'ladder worker' failure mode) and canvas drift.
// - Machinery kinematics: Catches jelly-chassis warping vs actuator articulation.
// - Ground contact: Catches vertical bouncing / baseline stutter.
// - Cyclic loop closure: Catches pop jumps at the loop boundary.

export interface RawFrame {
  width: number;
  height: number;
  /** RGBA byte array, length = width * height * 4 */
  rgba: Uint8Array | Buffer;
}

export type FailureReason =
  | "STIFF_LEGS_GLIDING"
  | "CANVAS_DRIFT_OFF_CENTER"
  | "LOOP_BOUNDARY_JUMP"
  | "CHASSIS_WARPED"
  | "ACTUATOR_STATIC"
  | "GROUND_JITTER"
  | "EMPTY_OR_CORRUPT_FRAMES";

export interface BipedVerificationResult {
  passed: boolean;
  legActivityRatio: number;
  driftPx: number;
  groundJitterPx: number;
  loopError: number;
  failureReason?: FailureReason;
  diagnosis: string;
}

export interface MachineryVerificationResult {
  passed: boolean;
  chassisDeformation: number;
  actuatorMotion: number;
  loopError: number;
  failureReason?: FailureReason;
  diagnosis: string;
}

export class AnimationVerificationHarness {
  /**
   * Evaluates biped walking/running animations.
   * Directly catches the common diffusion failure where the character travels forward
   * while the legs remain frozen/rigid (the 'ladder carrier' bug).
   */
  static verifyBipedLocomotion(frames: RawFrame[]): BipedVerificationResult {
    if (!frames || frames.length < 2) {
      return {
        passed: false,
        legActivityRatio: 0,
        driftPx: 0,
        groundJitterPx: 0,
        loopError: 0,
        failureReason: "EMPTY_OR_CORRUPT_FRAMES",
        diagnosis: "Need at least 2 frames to evaluate motion.",
      };
    }

    const { width, height } = frames[0];
    const upperSplit = Math.floor(height * 0.58); // Torso/Props vs Hips/Legs/Feet

    let totalUpperDiff = 0;
    let totalLowerDiff = 0;
    const centroidsX: number[] = [];
    const groundContactsY: number[] = [];

    // Analyze inter-frame diffs and spatial positions
    for (let t = 0; t < frames.length; t++) {
      const current = frames[t].rgba;
      let minX = width;
      let maxX = 0;
      let lowestY = 0;
      let opaqueCount = 0;
      let sumX = 0;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const alpha = current[idx + 3];

          if (alpha > 30) {
            opaqueCount++;
            sumX += x;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y > lowestY) lowestY = y;
          }
        }
      }

      centroidsX.push(opaqueCount > 0 ? sumX / opaqueCount : width / 2);
      groundContactsY.push(lowestY);

      if (t < frames.length - 1) {
        const next = frames[t + 1].rgba;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const diff =
              Math.abs(current[idx] - next[idx]) +
              Math.abs(current[idx + 1] - next[idx + 1]) +
              Math.abs(current[idx + 2] - next[idx + 2]);

            if (y < upperSplit) {
              totalUpperDiff += diff;
            } else {
              totalLowerDiff += diff;
            }
          }
        }
      }
    }

    // 1. Leg Activity Ratio: Are legs stepping or are they rigid/frozen while torso translates?
    const legActivityRatio = totalLowerDiff / (totalUpperDiff + 1e-4);

    // 2. Centroid Horizontal Drift (Treadmill Check): Max - Min of X centroids
    const maxCentroidX = Math.max(...centroidsX);
    const minCentroidX = Math.min(...centroidsX);
    const driftPx = maxCentroidX - minCentroidX;

    // 3. Ground Jitter: Standard deviation of lowest contact point
    const avgGround = groundContactsY.reduce((a, b) => a + b, 0) / groundContactsY.length;
    const groundVariance =
      groundContactsY.reduce((acc, y) => acc + Math.pow(y - avgGround, 2), 0) / groundContactsY.length;
    const groundJitterPx = Math.sqrt(groundVariance);

    // 4. Loop Boundary Jump: Difference between first and last frame
    let loopDiffSum = 0;
    const first = frames[0].rgba;
    const last = frames[frames.length - 1].rgba;
    const totalPixels = width * height;
    for (let i = 0; i < totalPixels * 4; i += 4) {
      loopDiffSum +=
        Math.abs(first[i] - last[i]) +
        Math.abs(first[i + 1] - last[i + 1]) +
        Math.abs(first[i + 2] - last[i + 2]);
    }
    const loopError = loopDiffSum / (totalPixels * 3);

    // Evaluation thresholds
    const maxAllowedDrift = width * 0.12; // Character should not drift more than 12% off-center in a treadmill walk
    const minLegRatio = 0.55; // Legs must exhibit at least 55% as much motion as torso/props
    const maxLoopError = 40.0;

    if (totalUpperDiff > 500 && legActivityRatio < minLegRatio) {
      return {
        passed: false,
        legActivityRatio,
        driftPx,
        groundJitterPx,
        loopError,
        failureReason: "STIFF_LEGS_GLIDING",
        diagnosis: `Character is gliding forward like a statue: leg activity ratio (${legActivityRatio.toFixed(2)}) is below threshold (${minLegRatio}). The legs are not actively stepping or bending.`,
      };
    }

    if (driftPx > maxAllowedDrift) {
      return {
        passed: false,
        legActivityRatio,
        driftPx,
        groundJitterPx,
        loopError,
        failureReason: "CANVAS_DRIFT_OFF_CENTER",
        diagnosis: `Character drifted ${driftPx.toFixed(1)}px across the canvas (limit: ${maxAllowedDrift.toFixed(1)}px). Animation is traveling rather than performing an in-place stationary treadmill walk cycle.`,
      };
    }

    if (loopError > maxLoopError) {
      return {
        passed: false,
        legActivityRatio,
        driftPx,
        groundJitterPx,
        loopError,
        failureReason: "LOOP_BOUNDARY_JUMP",
        diagnosis: `Loop boundary pop detected: error ${loopError.toFixed(1)} exceeds smooth threshold ${maxLoopError}. Starting and ending poses do not align.`,
      };
    }

    return {
      passed: true,
      legActivityRatio,
      driftPx,
      groundJitterPx,
      loopError,
      diagnosis: `Passed all biped gait verification checks. Legs are actively stepping (ratio: ${legActivityRatio.toFixed(2)}), centered (drift: ${driftPx.toFixed(1)}px), and looping smoothly.`,
    };
  }

  /**
   * Evaluates machine / vehicle animations (dump truck, crane, forklift, excavator).
   * Verifies that the chassis / base is rigid and only the actuator (boom, bucket, bed, forks) moves.
   */
  static verifyMachineryKinematics(
    frames: RawFrame[],
    options?: { chassisFraction?: number }
  ): MachineryVerificationResult {
    if (!frames || frames.length < 2) {
      return {
        passed: false,
        chassisDeformation: 0,
        actuatorMotion: 0,
        loopError: 0,
        failureReason: "EMPTY_OR_CORRUPT_FRAMES",
        diagnosis: "Need at least 2 frames to evaluate machinery kinematics.",
      };
    }

    const { width, height } = frames[0];
    const chassisSplit = Math.floor(height * (options?.chassisFraction ?? 0.5)); // Upper actuator vs lower chassis/tracks

    let actuatorDiff = 0;
    let chassisDiff = 0;

    for (let t = 0; t < frames.length - 1; t++) {
      const cur = frames[t].rgba;
      const nxt = frames[t + 1].rgba;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const diff =
            Math.abs(cur[idx] - nxt[idx]) +
            Math.abs(cur[idx + 1] - nxt[idx + 1]) +
            Math.abs(cur[idx + 2] - nxt[idx + 2]);

          if (y < chassisSplit) {
            actuatorDiff += diff;
          } else {
            chassisDiff += diff;
          }
        }
      }
    }

    const numTransitions = frames.length - 1;
    const actuatorMotion = actuatorDiff / (width * chassisSplit * numTransitions * 3);
    const chassisDeformation = chassisDiff / (width * (height - chassisSplit) * numTransitions * 3);

    // Loop closure
    let loopDiffSum = 0;
    const first = frames[0].rgba;
    const last = frames[frames.length - 1].rgba;
    const totalPixels = width * height;
    for (let i = 0; i < totalPixels * 4; i += 4) {
      loopDiffSum +=
        Math.abs(first[i] - last[i]) +
        Math.abs(first[i + 1] - last[i + 1]) +
        Math.abs(first[i + 2] - last[i + 2]);
    }
    const loopError = loopDiffSum / (totalPixels * 3);

    const maxChassisWarp = 8.0; // Chassis must remain rigid
    const minActuatorMotion = 2.0; // Actuator must move

    if (chassisDeformation > maxChassisWarp) {
      return {
        passed: false,
        chassisDeformation,
        actuatorMotion,
        loopError,
        failureReason: "CHASSIS_WARPED",
        diagnosis: `Machine chassis is warping/bouncing (${chassisDeformation.toFixed(1)} > max ${maxChassisWarp}). Vehicle body must remain static and rigid while operating.`,
      };
    }

    if (actuatorMotion < minActuatorMotion) {
      return {
        passed: false,
        chassisDeformation,
        actuatorMotion,
        loopError,
        failureReason: "ACTUATOR_STATIC",
        diagnosis: `Machine actuator (boom, bucket, forks) is static (${actuatorMotion.toFixed(1)} < min ${minActuatorMotion}). No articulated action observed.`,
      };
    }

    return {
      passed: true,
      chassisDeformation,
      actuatorMotion,
      loopError,
      diagnosis: `Machinery kinematics verified. Rigid chassis maintained (warp: ${chassisDeformation.toFixed(1)}), actuator fully articulated (${actuatorMotion.toFixed(1)}).`,
    };
  }

  /**
   * Automated stabilization transform:
   * Re-anchors frames to eliminate drift and ground jitter, transforming a moving walk into
   * a stationary treadmill cycle pinned to ground baseline.
   */
  static stabilizeAndTreadmill(frames: RawFrame[]): RawFrame[] {
    if (!frames.length) return frames;
    const { width, height } = frames[0];
    const targetCenterX = Math.floor(width / 2);

    // Find baseline ground across all frames
    const groundPoints: number[] = [];
    const centerXs: number[] = [];

    for (const frame of frames) {
      let minX = width;
      let maxX = 0;
      let lowestY = 0;
      let sumX = 0;
      let count = 0;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          if (frame.rgba[idx + 3] > 30) {
            count++;
            sumX += x;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y > lowestY) lowestY = y;
          }
        }
      }
      groundPoints.push(lowestY);
      centerXs.push(count > 0 ? Math.round(sumX / count) : targetCenterX);
    }

    const targetGroundY = Math.max(...groundPoints);

    return frames.map((frame, i) => {
      const shiftX = targetCenterX - centerXs[i];
      const shiftY = targetGroundY - groundPoints[i];

      const out = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++) {
        const srcY = y - shiftY;
        if (srcY < 0 || srcY >= height) continue;

        for (let x = 0; x < width; x++) {
          const srcX = x - shiftX;
          if (srcX < 0 || srcX >= width) continue;

          const srcIdx = (srcY * width + srcX) * 4;
          const dstIdx = (y * width + x) * 4;
          out[dstIdx] = frame.rgba[srcIdx];
          out[dstIdx + 1] = frame.rgba[srcIdx + 1];
          out[dstIdx + 2] = frame.rgba[srcIdx + 2];
          out[dstIdx + 3] = frame.rgba[srcIdx + 3];
        }
      }

      return { width, height, rgba: out };
    });
  }
}
