import type {
  ImageModelOption,
  ProjectSummary,
  ProjectView,
  VideoModelOption,
} from "./api";

export const DEFAULT_IMAGE_MODEL = "gpt-image-2.5-flare-2026-09-08";
export const DEFAULT_VIDEO_MODEL = "sora-2";

export type AppStatus =
  | "idle"
  | "generating-image"
  | "generating-video"
  | "extracting-frames"
  | "done"
  | "error";

export interface AppState {
  project: ProjectView["project"] | null;
  navigating: boolean;
  activeAnimationId: string;
  animations: { id: string; name: string }[];
  asepriteSrc: string | null;
  status: AppStatus;
  errorMessage: string | null;
  spritePrompt: string;
  spriteModel: string;
  imageModels: ImageModelOption[];
  motionPrompt: string;
  motionModel: string;
  videoModels: VideoModelOption[];
  spriteSrc: string | null;
  spriteDimensions: { w: number; h: number } | null;
  frames: string[];
  selectedFrameIndices: Set<number>;
  spritesheetSrc: string | null;
  spritesheetCols: number | null;
  previewGifSrc: string | null;
  previewGifBuilding: boolean;
  currentProjectName: string;
  savedProjects: ProjectSummary[];
  kind: "character" | "asset";
  category: string;
  perspective: "isometric" | "sidescroller";
  direction: string;
  moveType: string;
  assetKind: "character" | "asset";
  endingType: "open-ended" | "seamless" | "custom";
}

export function createInitialState(): AppState {
  return {
    project: null,
    navigating: false,
    activeAnimationId: "",
    animations: [],
    asepriteSrc: null,
    status: "idle",
    errorMessage: null,
    spritePrompt: "",
    spriteModel: DEFAULT_IMAGE_MODEL,
    imageModels: [],
    motionPrompt: "",
    motionModel: DEFAULT_VIDEO_MODEL,
    videoModels: [],
    spriteSrc: null,
    spriteDimensions: null,
    frames: [],
    selectedFrameIndices: new Set(),
    spritesheetSrc: null,
    spritesheetCols: null,
    previewGifSrc: null,
    previewGifBuilding: false,
    currentProjectName: "",
    savedProjects: [],
    kind: "character",
    category: "Main Assets",
    perspective: "isometric",
    direction: "N",
    moveType: "walk",
    assetKind: "character",
    endingType: "seamless",
  };
}

export function cacheBust(url: string | null, key: string): string | null {
  if (!url) return null;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${encodeURIComponent(key)}`;
}

export function hydrateFromView(view: ProjectView): Partial<AppState> {
  const v = view.updatedAt;
  return {
    project: view.project,
    activeAnimationId: view.activeAnimationId,
    animations: view.animations,
    asepriteSrc: cacheBust(view.asepriteUrl, v),
    spritePrompt: view.spritePrompt,
    spriteModel: view.spriteModel || DEFAULT_IMAGE_MODEL,
    motionPrompt: view.motionPrompt,
    motionModel: view.motionModel || DEFAULT_VIDEO_MODEL,
    spriteSrc: cacheBust(view.spriteUrl, v),
    spriteDimensions: view.spriteDimensions,
    frames: view.frames.map((f) => cacheBust(f, v)!),
    selectedFrameIndices: new Set(view.selectedFrameIndices),
    spritesheetSrc: cacheBust(view.spritesheetUrl, v),
    spritesheetCols: view.spritesheetUrl ? view.spritesheetFrameCount : null,
    previewGifSrc: cacheBust(view.previewGifUrl, v),
    previewGifBuilding: false,
    currentProjectName: view.name,
    kind: view.kind ?? "character",
    category: view.category ?? (view.kind === "asset" ? "Main Assets" : "Main Characters"),
    perspective: view.perspective ?? "isometric",
    direction: view.direction ?? "N",
    moveType: view.moveType ?? "walk",
    assetKind: view.assetKind ?? (view.kind === "asset" ? "asset" : "character"),
    endingType: view.endingType ?? "seamless",
  };
}

type Listener = (state: AppState) => void;

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor(initial: AppState) {
    this.state = initial;
  }

  get(): AppState {
    return this.state;
  }

  set(partial: Partial<AppState>) {
    this.state = { ...this.state, ...partial };
    for (const fn of this.listeners) fn(this.state);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }
}
