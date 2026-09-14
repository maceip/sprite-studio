// Image-to-video generation via OpenAI Sora or OpenRouter with polling.
// Flow: submit job → poll every few seconds → on `completed`, return download target.

import { prepareVideoReference } from "./video-reference.js";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENAI_BASE = "https://api.openai.com/v1";

export const VIDEO_MODELS = [
  { id: "sora-2", label: "OpenAI Sora 2", defaultDuration: 4 },
  { id: "sora-2-pro", label: "OpenAI Sora 2 Pro", defaultDuration: 4 },
] as const;

export type VideoModelId =
  | (typeof VIDEO_MODELS)[number]["id"]
  | "openai/sora-2"
  | "openai/sora-2-pro"
  | "x-ai/grok-imagine-video"
  | "minimax/hailuo-3"
  | "minimax/hailuo-3-max"
  | "bytedance/seedance-2.0";

export const DEFAULT_VIDEO_MODEL: VideoModelId = "sora-2";

export function isVideoModelId(v: unknown): v is VideoModelId {
  return (
    typeof v === "string" &&
    (VIDEO_MODELS.some((m) => m.id === v) ||
      v === "openai/sora-2" ||
      v === "openai/sora-2-pro" ||
      v === "x-ai/grok-imagine-video" ||
      v === "minimax/hailuo-3" ||
      v === "minimax/hailuo-3-max" ||
      v === "bytedance/seedance-2.0")
  );
}

export function defaultDurationFor(id: VideoModelId): number {
  const found = VIDEO_MODELS.find((m) => m.id === id);
  if (found) return found.defaultDuration;
  if (id === "x-ai/grok-imagine-video") return 2;
  if (id === "bytedance/seedance-2.0") return 4;
  if (id.startsWith("minimax/")) return 5;
  return 4;
}

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 120; // ~6 min cap

export interface MotionOptions {
  assetKind?: "character" | "asset";
  perspective?: "isometric" | "sidescroller";
  direction?: string;
  moveType?: string;
  endingType?: "open-ended" | "seamless" | "custom";
}

export function buildMotionPrompt(text: string, options?: MotionOptions): string {
  const assetKind = options?.assetKind ?? "character";
  const perspective = options?.perspective ?? "isometric";
  const direction = options?.direction;
  const endingType = options?.endingType ?? "seamless";

  const directives: string[] = [];

  directives.push(
    "Maintain the exact same flat solid pure chroma green background, hex #00b140, throughout the entire clip. " +
    "No background changes, no environmental elements, no shadows on the background, no camera movement."
  );

  if (perspective === "isometric") {
    directives.push(
      "Fixed isometric 2.5D perspective angle. No camera rotation, panning, or tilt."
    );
  } else {
    directives.push(
      "Fixed 2D side-scroller perspective angle. No camera rotation or tilt."
    );
  }

  if (direction) {
    const dirMap: Record<string, string> = {
      N: "North (facing away from camera / rear-angled)",
      NE: "North-East (facing diagonally away to the right)",
      E: "East (facing right)",
      SE: "South-East (facing diagonally forward to the right)",
      S: "South (facing toward camera / front-angled)",
      SW: "South-West (facing diagonally forward to the left)",
      W: "West (facing left)",
      NW: "North-West (facing diagonally away to the left)",
    };
    const dirDesc = dirMap[direction.toUpperCase()] ?? direction;
    directives.push(`Subject orientation: Facing ${dirDesc} in isometric space.`);
  }

  if (assetKind === "asset") {
    directives.push(
      "MECHANICAL ASSET / OBJECT CONSTRAINTS:\n" +
      "- The vehicle chassis, truck body, wheels, base, cabin, and ground anchors must remain 100% COMPLETELY STATIC, RIGID, and FIRMLY GROUNDED. Do NOT drive, roll, bounce, drift, shake, tilt, or distort the vehicle.\n" +
      "- ONLY the articulated moving components described in the prompt (e.g. hydraulic boom arm, crane, bucket, hinges, joints) move. The arm smoothly articulates and extends/lifts the bucket into the air and lowers it down with realistic mechanical precision.\n" +
      "- Strictly preserve hard mechanical edges, textures, colors, and rigid geometry. No rubbery bending or morphing of non-articulated parts."
    );
  } else {
    directives.push(
      "Preserve the reference character's exact design, proportions, colors and pixel-art style. " +
      "Keep the full character visible with consistent scale and framing. " +
      "Perform only the requested movement; do not add motion or morph the character."
    );
    const isLocomotion =
      /walk|run|march|jog|stride|step|carry|lineup|action/i.test(text) ||
      options?.moveType === "walk" ||
      options?.moveType === "run";
    if (isLocomotion) {
      directives.push(
        "STATIONARY TREADMILL LOCOMOTION CONSTRAINTS:\n" +
        "- The character must walk/run IN PLACE ON A STATIONARY TREADMILL. Center of mass, hips, and torso stay locked at the center of the frame.\n" +
        "- Do NOT translate, glide, skate, or drift across the screen. Never move the subject horizontally across the frame like a statue.\n" +
        "- BOTH LEGS MUST ACTIVELY CYCLE: alternating high knee lifts, bending at hips and knees, planting feet firmly on the ground baseline.\n" +
        "- Any carried object, tool, ladder, box, or wheelbarrow stays firmly held in the hands and naturally bobs with torso cadence while the legs step actively."
      );
    }
  }

  if (endingType === "seamless") {
    directives.push(
      "Create a seamless cycle with matching starting and ending poses so the animation loops perfectly."
    );
  } else if (endingType === "open-ended") {
    directives.push(
      "Perform the animation action naturally through its full movement arc."
    );
  }

  return `${text.trim()}\n\n${directives.join(" ")}`;
}

type JobStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

interface VideoJob {
  id: string;
  status: JobStatus;
  polling_url?: string;
  unsigned_urls?: string[];
  generation_id?: string;
  error?: string | { message?: string };
}

interface ErrorResponse {
  error?: string | { message?: string };
}

export interface VideoDownload {
  url: string;
  headers?: Record<string, string>;
}

export async function generateSpriteMotionVideo(
  image: string,
  text: string,
  duration = 4,
  model: VideoModelId = DEFAULT_VIDEO_MODEL,
  options?: MotionOptions,
): Promise<VideoDownload> {
  const isOpenAi =
    model === "sora-2" ||
    model === "sora-2-pro" ||
    model === "openai/sora-2" ||
    model === "openai/sora-2-pro" ||
    (!model.startsWith("x-ai/") &&
      !model.startsWith("minimax/") &&
      !model.startsWith("bytedance/") &&
      Boolean(process.env.OPENAI_API_KEY));

  if (isOpenAi) {
    return generateSpriteMotionVideoOpenAI(image, text, duration, model, options);
  }
  return generateSpriteMotionVideoOpenRouter(image, text, duration, model, options);
}

async function generateSpriteMotionVideoOpenAI(
  image: string,
  text: string,
  duration: number,
  model: string,
  options?: MotionOptions,
): Promise<VideoDownload> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const openAiModel = model.replace(/^openai\//, "");
  const fullText = buildMotionPrompt(text, options);
  // Sora strictly requires the input image dimensions to match the requested size (1280x720)
  const videoReference = await prepareVideoReference(image, { width: 1280, height: 720 });

  const baseUrl = (process.env.OPENAI_BASE_URL ?? OPENAI_BASE).replace(/\/+$/, "");

  let seconds: "4" | "8" | "12" = "4";
  if (duration >= 10) seconds = "12";
  else if (duration >= 6) seconds = "8";

  const submitRes = await fetch(`${baseUrl}/videos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openAiModel,
      prompt: fullText,
      seconds,
      size: "1280x720",
      input_reference: {
        image_url: videoReference,
      },
    }),
  });

  const submitJson = (await submitRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!submitRes.ok) {
    const message =
      typeof submitJson.error === "string"
        ? submitJson.error
        : (submitJson.error as { message?: string })?.message ?? `HTTP ${submitRes.status}`;
    throw new Error(`OpenAI video submit failed: ${message}`);
  }

  const jobId = submitJson.id as string;
  if (!jobId) {
    throw new Error("OpenAI video submit returned no job id");
  }

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const pollRes = await fetch(`${baseUrl}/videos/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const job = (await pollRes.json().catch(() => ({}))) as {
      status?: string;
      error?: string | { message?: string };
    };

    if (job.status === "completed") {
      return {
        url: `${baseUrl}/videos/${jobId}/content`,
        headers: { Authorization: `Bearer ${apiKey}` },
      };
    }

    if (job.status === "failed" || job.status === "cancelled" || job.status === "expired") {
      const err =
        typeof job.error === "string"
          ? job.error
          : job.error?.message ?? `OpenAI video ${job.status}`;
      throw new Error(`OpenAI video ${job.status}: ${err}`);
    }
  }

  throw new Error("OpenAI video did not complete within the timeout period");
}

async function generateSpriteMotionVideoOpenRouter(
  image: string,
  text: string,
  duration = 2,
  model: VideoModelId = DEFAULT_VIDEO_MODEL,
  options?: MotionOptions,
): Promise<VideoDownload> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const fullText = buildMotionPrompt(text, options);
  const videoReference = await prepareVideoReference(image);
  const reference = { type: "image_url", image_url: { url: videoReference } };

  const submitRes = await fetch(`${OPENROUTER_BASE}/videos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: fullText,
      duration,
      // H3 Max uses first-frame image-to-video. Keep its resolution at the cheaper tier.
      ...(model === "minimax/hailuo-3-max"
        ? { resolution: "480p", frame_images: [{ ...reference, frame_type: "first_frame" }] }
        : { input_references: [reference] }),
    }),
  });

  let job = (await submitRes.json().catch(() => ({}))) as VideoJob & ErrorResponse;
  if (!submitRes.ok) {
    throw new Error(`OpenRouter video submit failed: ${extractError(job, submitRes.status)}`);
  }
  if (!job.id) {
    throw new Error("OpenRouter video submit returned no job id");
  }

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    if (job.status === "completed") break;
    if (
      job.status === "failed" ||
      job.status === "cancelled" ||
      job.status === "expired"
    ) {
      throw new Error(
        `OpenRouter video ${job.status}: ${extractError(job, 200)}`,
      );
    }

    await sleep(POLL_INTERVAL_MS);

    const pollUrl = job.polling_url
      ? new URL(job.polling_url, "https://openrouter.ai").toString()
      : `${OPENROUTER_BASE}/videos/${job.id}`;

    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    job = (await pollRes.json().catch(() => ({}))) as VideoJob & ErrorResponse;
    if (!pollRes.ok) {
      throw new Error(
        `OpenRouter video poll failed: ${extractError(job, pollRes.status)}`,
      );
    }
  }

  if (job.status !== "completed") {
    throw new Error(`OpenRouter video did not complete in time (last status: ${job.status})`);
  }

  return resolveDownloadable(job, apiKey);
}

function resolveDownloadable(job: VideoJob, apiKey: string): VideoDownload {
  const authHeaders = { Authorization: `Bearer ${apiKey}` };
  const unsigned = job.unsigned_urls?.[0];
  if (unsigned) {
    // openrouter.ai-hosted unsigned URLs still need the bearer token. Send the key only
    // to openrouter so it can't leak to a third-party CDN.
    return isOpenRouterHost(unsigned)
      ? { url: unsigned, headers: authHeaders }
      : { url: unsigned };
  }
  return {
    url: `${OPENROUTER_BASE}/videos/${job.id}/content?index=0`,
    headers: authHeaders,
  };
}

function isOpenRouterHost(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "openrouter.ai" || h.endsWith(".openrouter.ai");
  } catch {
    return false;
  }
}

function extractError(payload: ErrorResponse, status: number): string {
  if (typeof payload.error === "string") return payload.error;
  if (payload.error?.message) return payload.error.message;
  return `HTTP ${status}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
