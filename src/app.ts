import {
  changeSprite,
  changeAnimation,
  saveDraft,
  animateSprite,
  checkHealth,
  deleteAnimation,
  generateSprite,
  uploadSprite,
  setActiveProject,
  getImageModels,
  getVideoModels,
  listProjects,
  loadProject,
  newProject,
  saveSelection,
  saveSpritesheet,
  type ProjectView,
} from "./lib/api";
import { mountMusic } from "./components/music";
import { Store, createInitialState, hydrateFromView } from "./lib/state";
import { composeSpritesheet } from "./lib/spritesheet";
import {
  copyIcon,
  frameIcon,
  gridIcon,
  plusIcon,
  sparkleIcon,
  trashIcon,
  uploadIcon,
  characterIcon,
  assetIcon,
  emeraldMarkIcon,
  panelLeftIcon,
  soundIcon,
} from "./components/icons";

const EMPTY_PLACEHOLDER_SLOTS = 8;
const SELECTION_DEBOUNCE_MS = 700;

export function mountApp(root: HTMLElement) {
  const store = new Store(createInitialState());
  root.innerHTML = renderShell();

  const toast = createToast(root);
  const music = mountMusic(root.querySelector<HTMLElement>("#music-workspace")!,
    busy => store.set({ navigating: busy }), askName);
  let workspace: "characters" | "assets" | "music" = "characters";
  let selectedAssetFolder = "All Assets";

  function generateAssetId(): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let hash = "";
    for (let i = 0; i < 6; i++) {
      hash += chars[Math.floor(Math.random() * chars.length)];
    }
    return hash;
  }

  // App & Sidebar elements
  const appEl = root.querySelector<HTMLElement>(".app")!;
  const btnToggleSidebar = root.querySelector<HTMLButtonElement>("#btn-toggle-sidebar");
  const btnCollapseSidebar = root.querySelector<HTMLButtonElement>("#btn-collapse-sidebar");

  function toggleSidebar() {
    const isCollapsed = appEl.classList.toggle("sidebar-collapsed");
    try {
      localStorage.setItem("sprite_studio_sidebar_collapsed", isCollapsed ? "1" : "0");
    } catch {}
  }

  btnToggleSidebar?.addEventListener("click", toggleSidebar);
  btnCollapseSidebar?.addEventListener("click", toggleSidebar);

  try {
    if (localStorage.getItem("sprite_studio_sidebar_collapsed") === "1") {
      appEl.classList.add("sidebar-collapsed");
    }
  } catch {}

  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      toggleSidebar();
    }
  });

  // Sidebar elements
  const sidebarTabCharacters = root.querySelector<HTMLButtonElement>("#sidebar-tab-characters")!;
  const sidebarTabAssets = root.querySelector<HTMLButtonElement>("#sidebar-tab-assets")!;
  const sidebarTabMusic = root.querySelector<HTMLButtonElement>("#sidebar-tab-music")!;
  const sidebarCharactersPanel = root.querySelector<HTMLDivElement>("#sidebar-characters-panel")!;
  const sidebarAssetsPanel = root.querySelector<HTMLDivElement>("#sidebar-assets-panel")!;
  const btnNewCharacter = root.querySelector<HTMLButtonElement>("#btn-new-character")!;
  const characterItemsList = root.querySelector<HTMLDivElement>("#character-items-list")!;
  const countCharacters = root.querySelector<HTMLSpanElement>("#count-characters")!;
  const countAssetsFolder = root.querySelector<HTMLSpanElement>("#count-assets-folder")!;

  // Workspaces
  const spritesWorkspace = root.querySelector<HTMLDivElement>("#sprites-workspace")!;
  const assetsWorkspace = root.querySelector<HTMLDivElement>("#assets-workspace")!;
  const musicWorkspace = root.querySelector<HTMLDivElement>("#music-workspace")!;

  sidebarTabCharacters.addEventListener("click", async () => {
    if (workspace === "characters") return;
    store.set({ navigating: true });
    try {
      await persistDraft();
      music.stopPlayback();
      workspace = "characters";
      store.set({ assetKind: "character" });
      const state = store.get();
      const currentSprite = state.project?.sprites.find((s) => s.id === state.project?.activeSpriteId);
      if (!currentSprite || currentSprite.kind === "asset") {
        const firstChar = state.project?.sprites.find((s) => s.kind !== "asset");
        if (firstChar) {
          void navigateSprite("load", firstChar.id);
        }
      }
    } catch (err) { toast(err instanceof Error ? err.message : "Could not switch workspace"); }
    finally { store.set({ navigating: false }); }
  });

  sidebarTabAssets.addEventListener("click", async () => {
    if (workspace === "assets") return;
    store.set({ navigating: true });
    try {
      await persistDraft();
      music.stopPlayback();
      workspace = "assets";
      store.set({ assetKind: "asset" });
      const state = store.get();
      const currentSprite = state.project?.sprites.find((s) => s.id === state.project?.activeSpriteId);
      if (!currentSprite || currentSprite.kind !== "asset") {
        const firstAsset = state.project?.sprites.find((s) => s.kind === "asset");
        if (firstAsset) {
          void navigateSprite("load", firstAsset.id);
        }
      }
    } catch (err) { toast(err instanceof Error ? err.message : "Could not switch workspace"); }
    finally { store.set({ navigating: false }); }
  });

  sidebarTabMusic.addEventListener("click", async () => {
    if (workspace === "music") return;
    store.set({ navigating: true });
    try {
      await persistDraft();
      workspace = "music";
    } catch (err) { toast(err instanceof Error ? err.message : "Could not switch workspace"); }
    finally { store.set({ navigating: false }); }
  });

  // ---- Refs ----
  const promptInput = root.querySelector<HTMLTextAreaElement>("#sprite-prompt")!;
  const spriteModelSelect = root.querySelector<HTMLSelectElement>("#sprite-model")!;
  const generateSpriteBtn = root.querySelector<HTMLButtonElement>("#btn-generate-sprite")!;
  const uploadSpriteBtn = root.querySelector<HTMLButtonElement>("#btn-upload-sprite")!;
  const spriteFileInput = root.querySelector<HTMLInputElement>("#sprite-file-input")!;
  const step1Card = root.querySelector<HTMLElement>("#step-1-card")!;
  const spritePreview = root.querySelector<HTMLDivElement>("#sprite-preview")!;
  const spriteCaption = root.querySelector<HTMLDivElement>("#sprite-caption")!;
  const spriteStatus = root.querySelector<HTMLDivElement>("#sprite-status")!;

  const motionInput = root.querySelector<HTMLTextAreaElement>("#motion-prompt")!;
  const motionModelSelect = root.querySelector<HTMLSelectElement>("#motion-model")!;
  const generateFramesBtn = root.querySelector<HTMLButtonElement>("#btn-generate-frames")!;
  const framesGrid = root.querySelector<HTMLDivElement>("#frames-grid")!;
  const framesStatus = root.querySelector<HTMLDivElement>("#frames-status")!;
  const generateSheetBtn = root.querySelector<HTMLButtonElement>("#btn-generate-sheet")!;

  const sheetPreview = root.querySelector<HTMLDivElement>("#sheet-preview")!;
  const sheetMeta = root.querySelector<HTMLDivElement>("#sheet-meta")!;
  const gifPreview = root.querySelector<HTMLDivElement>("#gif-preview")!;

  // Characters Directional & Movement Refs
  const perspectiveToggle = root.querySelector<HTMLDivElement>("#char-perspective-toggle")!;
  const moveCards = root.querySelector<HTMLDivElement>("#char-move-cards")!;
  const compassContainer = root.querySelector<HTMLDivElement>("#char-compass-container")!;
  const compassFacingLabel = root.querySelector<HTMLSpanElement>("#compass-facing-label")!;
  const exportUnityBtn = root.querySelector<HTMLButtonElement>("#btn-export-unity");
  const exportGodotBtn = root.querySelector<HTMLButtonElement>("#btn-export-godot");

  // Assets Workspace Refs
  const assetFolders = root.querySelector<HTMLDivElement>("#asset-folders")!;
  const assetItemsList = root.querySelector<HTMLDivElement>("#asset-items-list")!;
  const btnNewAsset = root.querySelector<HTMLButtonElement>("#btn-new-asset")!;
  const wizardStep1 = root.querySelector<HTMLDivElement>("#wizard-step-1")!;
  const wizardStep2 = root.querySelector<HTMLDivElement>("#wizard-step-2")!;
  const wizardStep3 = root.querySelector<HTMLDivElement>("#wizard-step-3")!;
  const dotStep1 = root.querySelector<HTMLSpanElement>("#dot-step-1")!;
  const dotStep2 = root.querySelector<HTMLSpanElement>("#dot-step-2")!;
  const dotStep3 = root.querySelector<HTMLSpanElement>("#dot-step-3")!;
  const btnAssetStep1Next = root.querySelector<HTMLButtonElement>("#btn-asset-step-1-next")!;
  const btnAssetStep2Back = root.querySelector<HTMLButtonElement>("#btn-asset-step-2-back")!;
  const btnAssetStep2Next = root.querySelector<HTMLButtonElement>("#btn-asset-step-2-next")!;
  const btnAssetStep3Back = root.querySelector<HTMLButtonElement>("#btn-asset-step-3-back")!;
  const actionFlowFirst = root.querySelector<HTMLDivElement>("#action-flow-first")!;
  const actionFlowText = root.querySelector<HTMLDivElement>("#action-flow-text")!;
  const assetActionInput = root.querySelector<HTMLTextAreaElement>("#asset-action-input")!;
  const reviewAssetName = root.querySelector<HTMLSpanElement>("#review-asset-name")!;
  const reviewActionText = root.querySelector<HTMLSpanElement>("#review-action-text")!;
  const reviewEndingText = root.querySelector<HTMLSpanElement>("#review-ending-text")!;
  const assetVideoModel = root.querySelector<HTMLSelectElement>("#asset-video-model")!;
  const assetDurationSelect = root.querySelector<HTMLSelectElement>("#asset-duration-select")!;
  const btnAssetGenerate = root.querySelector<HTMLButtonElement>("#btn-asset-generate")!;
  const assetStatus = root.querySelector<HTMLDivElement>("#asset-status")!;
  const assetReferenceBox = root.querySelector<HTMLDivElement>("#asset-reference-box")!;
  const btnAssetUpload = root.querySelector<HTMLButtonElement>("#btn-asset-upload")!;
  const assetFileInput = root.querySelector<HTMLInputElement>("#asset-file-input")!;
  const assetActiveName = root.querySelector<HTMLSpanElement>("#asset-active-name")!;
  const assetReferenceCaption = root.querySelector<HTMLDivElement>("#asset-reference-caption")!;
  const assetOutputSection = root.querySelector<HTMLDivElement>("#asset-output-section")!;
  const assetGifPreview = root.querySelector<HTMLDivElement>("#asset-gif-preview")!;
  const assetSheetMeta = root.querySelector<HTMLDivElement>("#asset-sheet-meta")!;

  // ---- Event handlers ----
  promptInput.addEventListener("input", () => {
    store.set({ spritePrompt: promptInput.value });
  });

  spriteModelSelect.addEventListener("change", () => {
    store.set({ spriteModel: spriteModelSelect.value });
  });

  motionInput.addEventListener("input", () => {
    store.set({ motionPrompt: motionInput.value });
  });

  motionModelSelect.addEventListener("change", () => {
    store.set({ motionModel: motionModelSelect.value });
  });

  generateSpriteBtn.addEventListener("click", async () => {
    const prompt = store.get().spritePrompt.trim();
    if (!prompt) {
      setStatus(spriteStatus, "Enter a sprite prompt first.", "error");
      return;
    }
    store.set({ status: "generating-image", errorMessage: null });
    setStatus(spriteStatus, `${spinner()}Generating reference sprite…`);
    try {
      if (!store.get().project?.activeSpriteId) {
        const hash = `c-${generateAssetId()}`;
        const initView = await changeSprite("new", hash, "character");
        await applyView(initView);
      }
      await persistDraft();
      const result = await generateSprite(prompt, store.get().spriteModel);
      await applyView(result.view);
      store.set({ spriteSrc: result.dataUrl });
      setStatus(spriteStatus, "Reference sprite ready.", "success");
      toast("Reference sprite generated");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate sprite";
      store.set({ status: "error", errorMessage: message });
      setStatus(spriteStatus, message, "error");
    }
  });

  async function handleImageFile(file: File) {
    let state = store.get();
    if (!state.project?.activeSpriteId) {
      try {
        const hash = workspace === "assets" ? `a-${generateAssetId()}` : `c-${generateAssetId()}`;
        const view = await changeSprite("new", hash, workspace === "assets" ? "asset" : "character");
        await applyView(view);
        state = store.get();
      } catch (err) {
        toast("Could not initialize character for image");
        return;
      }
    }
    if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name)) {
      setStatus(spriteStatus, "Please select an image file (PNG, JPEG, WebP, etc.).", "error");
      return;
    }
    if (file.size > 20_000_000) {
      setStatus(spriteStatus, "Image is too large (max 20 MB).", "error");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      store.set({ status: "generating-image", errorMessage: null });
      setStatus(spriteStatus, `${spinner()}Uploading character image…`);
      try {
        await persistDraft();
        const result = await uploadSprite(dataUrl);
        await applyView(result.view);
        store.set({ spriteSrc: result.dataUrl });
        setStatus(spriteStatus, "Reference sprite ready.", "success");
        toast("Character image uploaded");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to upload image";
        store.set({ status: "error", errorMessage: message });
        setStatus(spriteStatus, message, "error");
      }
    };
    reader.onerror = () => {
      setStatus(spriteStatus, "Failed to read image file.", "error");
    };
    reader.readAsDataURL(file);
  }

  uploadSpriteBtn.addEventListener("click", () => {
    spriteFileInput.click();
  });

  spriteFileInput.addEventListener("change", () => {
    const file = spriteFileInput.files?.[0];
    if (file) {
      handleImageFile(file);
      spriteFileInput.value = "";
    }
  });

  spritePreview.addEventListener("click", (e) => {
    const state = store.get();
    const busy = state.status !== "idle" && state.status !== "done" && state.status !== "error";
    if (busy || !state.project?.activeSpriteId) return;
    if (e.target instanceof HTMLElement && e.target.closest("button")) return;
    spriteFileInput.click();
  });

  function wireDropZone(target: HTMLElement) {
    let dragDepth = 0;
    target.addEventListener("dragenter", (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      dragDepth++;
      target.classList.add("is-dragover");
    });
    target.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      target.classList.add("is-dragover");
    });
    target.addEventListener("dragleave", (e) => {
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        target.classList.remove("is-dragover");
      }
    });
    target.addEventListener("drop", (e) => {
      e.preventDefault();
      dragDepth = 0;
      target.classList.remove("is-dragover");
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        handleImageFile(file);
      }
    });
  }
  wireDropZone(spritePreview);
  wireDropZone(step1Card);
  if (assetReferenceBox) wireDropZone(assetReferenceBox);

  generateFramesBtn.addEventListener("click", async () => {
    let state = store.get();
    if (!state.spriteSrc) {
      setStatus(framesStatus, "Generate a reference sprite first.", "error");
      return;
    }
    const text = state.motionPrompt.trim();
    if (!text) {
      setStatus(framesStatus, "Enter a movement prompt first.", "error");
      return;
    }
    const spriteSrc = state.spriteSrc;
    store.set({ status: "generating-video", errorMessage: null });
    setStatus(framesStatus, `${spinner()}Generating motion video…`);
    try {
      if (!state.activeAnimationId) {
        const animName = state.moveType || "walk";
        const animView = await changeAnimation("new", animName);
        await applyView(animView);
      }
      await persistDraft();
      const currentState = store.get();
      const view = await animateSprite(spriteSrc, text, currentState.motionModel, {
        assetKind: currentState.assetKind ?? "character",
        perspective: currentState.perspective,
        direction: currentState.direction,
        moveType: currentState.moveType,
        endingType: currentState.endingType ?? "seamless",
      });
      await applyView(view);
      await saveCurrentAnimation();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate frames";
      store.set({ status: "error", errorMessage: message });
      setStatus(framesStatus, message, "error");
    }
  });

  framesGrid.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const tile = target.closest<HTMLElement>(".frame-tile");
    if (!tile) return;
    const idxStr = tile.dataset.index;
    if (idxStr === undefined) return;
    const index = Number(idxStr);
    const state = store.get();
    if (index >= state.frames.length) return;
    const next = new Set(state.selectedFrameIndices);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    store.set({ selectedFrameIndices: next });
    scheduleSelectionPersist();
  });

  async function saveCurrentAnimation() {
    const state = store.get();
    const selected = [...state.selectedFrameIndices].sort((a, b) => a - b)
      .map(i => state.frames[i]).filter(Boolean);
    if (!selected.length) throw new Error("Select at least one frame to include.");
    store.set({ previewGifBuilding: true });
    setStatus(framesStatus, `${spinner()}Saving PNG and Aseprite…`);
    try {
      await persistDraft();
      const sheet = await composeSpritesheet({ frameSrcs: selected });
      const view = await saveSpritesheet(sheet.dataUrl);
      await applyView(view);
      setStatus(framesStatus, view.previewGifUrl
        ? "PNG, Aseprite and animated preview saved."
        : "PNG and Aseprite saved. Animated preview could not be built.", "success");
    } finally {
      store.set({ previewGifBuilding: false });
    }
  }

  generateSheetBtn.addEventListener("click", async () => {
    try { await saveCurrentAnimation(); }
    catch (err) { setStatus(framesStatus, err instanceof Error ? err.message : "Could not save animation", "error"); }
  });

  // ---- Directional Isometric Controls ----
  const DIRECTION_DESCRIPTIONS: Record<string, string> = {
    N: "Facing North (rear / away)",
    NE: "Facing North-East",
    E: "Facing East",
    SE: "Facing South-East",
    S: "Facing South (front / camera)",
    SW: "Facing South-West",
    W: "Facing West",
    NW: "Facing North-West",
  };

  function syncMotionPrompt(state: ReturnType<typeof store.get>) {
    const dir = state.direction || "N";
    const dirLabel = DIRECTION_DESCRIPTIONS[dir] ?? `Facing ${dir}`;
    if (compassFacingLabel) compassFacingLabel.textContent = dirLabel;

    const currentPrompt = motionInput.value.trim();
    const isTemplate =
      !currentPrompt ||
      /^(walk|idle|run|jump|attack)\b/i.test(currentPrompt);

    if (isTemplate && state.moveType !== "custom") {
      const formatted =
        state.perspective === "sidescroller"
          ? `${state.moveType} side view, 2D side-scroller movement`
          : `${state.moveType} ${dirLabel.toLowerCase()}, smooth 8-direction isometric 2.5D animation`;
      motionInput.value = formatted;
      store.set({ motionPrompt: formatted });
    }
  }

  perspectiveToggle?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".view-pill");
    if (!btn || !btn.dataset.perspective) return;
    const p = btn.dataset.perspective as "isometric" | "sidescroller";
    store.set({ perspective: p });
    if (compassContainer) compassContainer.hidden = p === "sidescroller";
    syncMotionPrompt(store.get());
  });

  moveCards?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".move-card");
    if (!btn || !btn.dataset.move) return;
    const move = btn.dataset.move;
    store.set({ moveType: move });
    syncMotionPrompt(store.get());
  });

  compassContainer?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".compass-btn");
    if (!btn || !btn.dataset.dir) return;
    const dir = btn.dataset.dir;
    store.set({ direction: dir });
    syncMotionPrompt(store.get());
  });

  function downloadUrl(url: string, filename: string) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  exportUnityBtn?.addEventListener("click", () => {
    const state = store.get();
    if (!state.spritesheetSrc) { toast("Generate a spritesheet first"); return; }
    const name = state.animations.find((a) => a.id === state.activeAnimationId)?.name || "character";
    downloadUrl(state.spritesheetSrc, `${state.currentProjectName}-${name}-unity.png`);
    toast("Exported spritesheet for Unity");
  });

  exportGodotBtn?.addEventListener("click", () => {
    const state = store.get();
    if (!state.spritesheetSrc) { toast("Generate a spritesheet first"); return; }
    const name = state.animations.find((a) => a.id === state.activeAnimationId)?.name || "character";
    downloadUrl(state.spritesheetSrc, `${state.currentProjectName}-${name}-godot.png`);
    toast("Exported spritesheet for Godot");
  });

  // ---- Assets 3-Step Wizard Handlers ----
  function setWizardStep(step: 1 | 2 | 3) {
    if (!wizardStep1) return;
    wizardStep1.hidden = step !== 1;
    wizardStep2.hidden = step !== 2;
    wizardStep3.hidden = step !== 3;

    if (dotStep1) dotStep1.className = "wizard-dot" + (step === 1 ? " is-active" : " is-completed");
    if (dotStep2) dotStep2.className = "wizard-dot" + (step === 2 ? " is-active" : step > 2 ? " is-completed" : "");
    if (dotStep3) dotStep3.className = "wizard-dot" + (step === 3 ? " is-active" : "");

    const state = store.get();
    const activeSprite = state.project?.sprites.find((s) => s.id === state.project?.activeSpriteId);
    const assetName = activeSprite?.name ?? "Asset";

    if (step === 2) {
      if (actionFlowFirst) {
        actionFlowFirst.innerHTML = state.spriteSrc
          ? `<img src="${state.spriteSrc}" alt="${escapeAttr(assetName)}" />`
          : `<span>Ref</span>`;
      }
      if (actionFlowText) {
        actionFlowText.textContent = assetActionInput?.value.trim() || "Describe the motion…";
      }
    } else if (step === 3) {
      if (reviewAssetName) reviewAssetName.textContent = assetName;
      if (reviewActionText) reviewActionText.textContent = `"${assetActionInput?.value.trim() || "arm raises up and down"}"`;
      const endingMap: Record<string, string> = {
        "open-ended": "Open-ended (natural finish)",
        seamless: "Seamless loop (returns to start)",
        custom: "Custom ending pose",
      };
      if (reviewEndingText) reviewEndingText.textContent = endingMap[state.endingType] || "Open-ended";
    }
  }

  wizardStep1?.querySelectorAll<HTMLInputElement>('input[name="asset-ending"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      wizardStep1.querySelectorAll(".ending-card").forEach((c) => c.classList.remove("is-active"));
      radio.closest(".ending-card")?.classList.add("is-active");
      store.set({ endingType: radio.value as "open-ended" | "seamless" | "custom" });
    });
  });

  btnAssetStep1Next?.addEventListener("click", () => {
    setWizardStep(2);
  });

  assetActionInput?.addEventListener("input", () => {
    if (actionFlowText) actionFlowText.textContent = assetActionInput.value.trim() || "Describe the motion…";
    store.set({ motionPrompt: assetActionInput.value });
  });

  wizardStep2?.querySelectorAll<HTMLButtonElement>(".chip-btn").forEach((chip) => {
    chip.addEventListener("click", () => {
      const val = chip.dataset.chip;
      if (!val || !assetActionInput) return;
      assetActionInput.value = val;
      if (actionFlowText) actionFlowText.textContent = val;
      store.set({ motionPrompt: val });
    });
  });

  btnAssetStep2Back?.addEventListener("click", () => {
    setWizardStep(1);
  });

  btnAssetStep2Next?.addEventListener("click", () => {
    const text = assetActionInput?.value.trim();
    if (!text) {
      toast("Please describe the motion or pick a quick preset");
      return;
    }
    setWizardStep(3);
  });

  btnAssetStep3Back?.addEventListener("click", () => {
    setWizardStep(2);
  });

  btnAssetGenerate?.addEventListener("click", async () => {
    const state = store.get();
    if (!state.spriteSrc) {
      setStatus(assetStatus, "Upload or generate an asset reference image first.", "error");
      return;
    }
    const text = (assetActionInput?.value || state.motionPrompt || "hydraulic crane arm raises up and down").trim();
    const model = assetVideoModel?.value || state.motionModel;
    const duration = Number(assetDurationSelect?.value) || 4;

    store.set({ status: "generating-video", errorMessage: null });
    setStatus(assetStatus, `${spinner()}Generating articulated asset animation…`);
    try {
      await persistDraft();
      const view = await animateSprite(state.spriteSrc, text, model, {
        assetKind: "asset",
        perspective: "isometric",
        endingType: state.endingType,
        moveType: "custom",
        duration,
      });
      await applyView(view);
      await saveCurrentAnimation();
      setStatus(assetStatus, "Asset animation generated and saved!", "success");
      toast("Asset animation created!");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate asset animation";
      store.set({ status: "error", errorMessage: message });
      setStatus(assetStatus, message, "error");
    }
  });

  function renderCharacterList(state: ReturnType<typeof store.get>) {
    if (!characterItemsList) return;
    renderAssetList(state);
    const project = state.project;
    const sprites = (project?.sprites ?? []).filter((s) => s.kind !== "asset");
    const activeId = project?.activeSpriteId;

    if (countCharacters) countCharacters.textContent = String(sprites.length);

    if (sprites.length === 0) {
      characterItemsList.innerHTML = `<div class="sidebar-empty">No characters yet.<br>Click "+ New Character"</div>`;
      return;
    }

    characterItemsList.innerHTML = sprites
      .map((s) => {
        const isActive = s.id === activeId;
        const thumb = s.id === activeId && state.spriteSrc ? state.spriteSrc : "";
        return `
          <div class="sidebar-item-card ${isActive ? "is-active current emerald-active" : ""}" data-sprite-id="${escapeAttr(s.id)}">
            <span class="task-status-dot ${isActive ? "running" : "completed"}"></span>
            <div class="sidebar-item-thumb">
              ${thumb ? `<img src="${thumb}" alt="${escapeAttr(s.name)}" />` : `<span class="sidebar-item-icon">👤</span>`}
            </div>
            <div class="sidebar-item-info">
              <span class="sidebar-item-name">${escapeHtml(s.name)}</span>
            </div>
            <button type="button" class="sidebar-item-delete" data-delete-sprite-id="${escapeAttr(s.id)}" title="Delete character">${trashIcon}</button>
          </div>
        `;
      })
      .join("");
  }

  function renderAssetList(state: ReturnType<typeof store.get>) {
    if (!assetItemsList) return;
    const project = state.project;
    const sprites = (project?.sprites ?? []).filter((s) => s.kind === "asset");
    const activeId = project?.activeSpriteId;

    const countAll = root.querySelector<HTMLSpanElement>("#count-all");
    const countVehicles = root.querySelector<HTMLSpanElement>("#count-vehicles");
    const countEquipment = root.querySelector<HTMLSpanElement>("#count-equipment");
    const countProps = root.querySelector<HTMLSpanElement>("#count-props");
    const countItems = root.querySelector<HTMLSpanElement>("#count-items");
    const countEffects = root.querySelector<HTMLSpanElement>("#count-effects");
    if (countAll) countAll.textContent = String(sprites.length);
    if (countVehicles) countVehicles.textContent = String(sprites.filter((s) => s.category === "Vehicles" || s.name.toLowerCase().includes("truck")).length);
    if (countEquipment) countEquipment.textContent = String(sprites.filter((s) => s.category === "Equipment").length);
    if (countProps) countProps.textContent = String(sprites.filter((s) => s.category === "Props").length);
    if (countItems) countItems.textContent = String(sprites.filter((s) => s.category === "Items").length);
    if (countEffects) countEffects.textContent = String(sprites.filter((s) => s.category === "Effects").length);

    const filtered = sprites.filter((s) => {
      if (selectedAssetFolder === "All Assets") return true;
      return s.category === selectedAssetFolder || (selectedAssetFolder === "Vehicles" && s.name.toLowerCase().includes("truck"));
    });

    if (countAssetsFolder) countAssetsFolder.textContent = String(filtered.length);

    if (filtered.length === 0) {
      assetItemsList.innerHTML = `<div class="sidebar-empty">No assets in this folder.<br>Click "+ New Asset"</div>`;
      return;
    }

    assetItemsList.innerHTML = filtered
      .map((s) => {
        const isActive = s.id === activeId;
        const thumb = s.id === activeId && state.spriteSrc ? state.spriteSrc : "";
        return `
          <div class="sidebar-item-card ${isActive ? "is-active current emerald-active" : ""}" data-sprite-id="${escapeAttr(s.id)}">
            <span class="task-status-dot ${isActive ? "running" : "completed"}"></span>
            <div class="sidebar-item-thumb">
              ${thumb ? `<img src="${thumb}" alt="${escapeAttr(s.name)}" />` : `<span class="sidebar-item-icon">🚛</span>`}
            </div>
            <div class="sidebar-item-info">
              <span class="sidebar-item-name">${escapeHtml(s.name)}</span>
            </div>
            <button type="button" class="sidebar-item-delete" data-delete-sprite-id="${escapeAttr(s.id)}" title="Delete asset">${trashIcon}</button>
          </div>
        `;
      })
      .join("");
  }

  function wireSidebarList(listEl: HTMLElement | null) {
    listEl?.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement;
      const deleteBtn = target.closest<HTMLButtonElement>("[data-delete-sprite-id]");
      if (deleteBtn) {
        e.stopPropagation();
        const id = deleteBtn.dataset.deleteSpriteId;
        if (!id) return;
        if (!confirm(`Delete '${id}'? This cannot be undone.`)) return;
        await navigateSprite("delete", id);
        toast(`Deleted ${id}`);
        return;
      }
      const card = target.closest<HTMLElement>("[data-sprite-id]");
      if (card?.dataset.spriteId) {
        void navigateSprite("load", card.dataset.spriteId);
      }
    });
  }
  wireSidebarList(characterItemsList);
  wireSidebarList(assetItemsList);

  assetFolders?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".folder-btn");
    if (!btn || !btn.dataset.folder) return;
    assetFolders.querySelectorAll(".folder-btn").forEach((f) => f.classList.remove("is-active"));
    btn.classList.add("is-active");
    selectedAssetFolder = btn.dataset.folder;
    renderAssetList(store.get());
  });

  btnNewCharacter?.addEventListener("click", async () => {
    const hash = `c-${generateAssetId()}`;
    await navigateSprite("new", hash, "character");
    toast(`Created character ${hash}`);
  });

  btnNewAsset?.addEventListener("click", async () => {
    const category = selectedAssetFolder === "All Assets" ? "Vehicles" : selectedAssetFolder;
    const hash = `a-${generateAssetId()}`;
    await navigateSprite("new", hash, "asset", category);
    toast(`Created asset ${hash}`);
  });

  btnAssetUpload?.addEventListener("click", () => {
    if (assetFileInput) assetFileInput.click();
  });

  assetFileInput?.addEventListener("change", () => {
    const file = assetFileInput.files?.[0];
    if (file) {
      handleImageFile(file);
      assetFileInput.value = "";
    }
  });

  async function navigateSprite(action: "new" | "load" | "rename" | "delete", value: string, kind?: "character" | "asset", category?: string) {
    store.set({ navigating: true });
    try {
      await persistDraft();
      await applyView(await changeSprite(action, value, kind, category));
    } catch (err) { toast(err instanceof Error ? err.message : "Could not update sprite"); }
    finally { store.set({ navigating: false }); }
  }
  const animationPicker = root.querySelector<HTMLSelectElement>("#animation-picker")!;
  const addAnimationBtn = root.querySelector<HTMLButtonElement>("#btn-add-animation")!;
  const renameAnimationBtn = root.querySelector<HTMLButtonElement>("#btn-rename-animation")!;
  const duplicateAnimationBtn = root.querySelector<HTMLButtonElement>("#btn-duplicate-animation")!;
  const deleteAnimationBtn = root.querySelector<HTMLButtonElement>("#btn-delete-animation")!;
  async function navigateAnimation(action: "new" | "load" | "rename" | "duplicate", value: string) {
    store.set({ navigating: true });
    try {
      await persistDraft();
      await applyView(await changeAnimation(action, value));
    } catch (err) { toast(err instanceof Error ? err.message : "Could not update animation"); }
    finally { store.set({ navigating: false }); }
  }
  animationPicker.addEventListener("change", () => { void navigateAnimation("load", animationPicker.value); });
  addAnimationBtn.addEventListener("click", async () => {
    const name = await askName("Add animation");
    if (name?.trim()) void navigateAnimation("new", name.trim());
  });
  const btnAddFirstAnimation = root.querySelector<HTMLButtonElement>("#btn-add-first-animation");
  btnAddFirstAnimation?.addEventListener("click", () => {
    addAnimationBtn.click();
  });
  renameAnimationBtn.addEventListener("click", async () => {
    const state = store.get();
    const name = await askName("Rename animation", state.animations.find(a => a.id === state.activeAnimationId)?.name);
    if (name?.trim()) void navigateAnimation("rename", name.trim());
  });
  duplicateAnimationBtn.addEventListener("click", async () => {
    const state = store.get();
    const current = state.animations.find(a => a.id === state.activeAnimationId);
    if (!current) return;
    const base = current.name.replace(/-\d+$/, "");
    const names = new Set(state.animations.map(a => a.name.toLowerCase()));
    let suffix = 2;
    let suggestion: string;
    do {
      const ending = `-${suffix++}`;
      suggestion = `${base.slice(0, 60 - ending.length)}${ending}`;
    } while (names.has(suggestion.toLowerCase()));
    const name = await askName("Duplicate animation", suggestion);
    if (name?.trim()) void navigateAnimation("duplicate", name.trim());
  });
  deleteAnimationBtn.addEventListener("click", async () => {
    const state = store.get();
    const animation = state.animations.find(a => a.id === state.activeAnimationId);
    if (!animation || !window.confirm(`Delete animation '${animation.name}' and all its generated files? This can't be undone.`)) return;
    store.set({ navigating: true });
    try {
      await persistDraft();
      await applyView(await deleteAnimation());
      toast(`Deleted animation '${animation.name}'`);
    } catch (err) { toast(err instanceof Error ? err.message : "Could not delete animation"); }
    finally { store.set({ navigating: false }); }
  });
  async function persistDraft() {
    window.clearTimeout(selectionTimer);
    await selectionPending;
    await music.persist();
    const state = store.get();
    if (!state.project?.activeSpriteId) return;
    if (state.activeAnimationId) await saveSelection([...state.selectedFrameIndices]);
    await saveDraft({
      spritePrompt: state.spritePrompt,
      motionPrompt: state.motionPrompt,
      spriteModel: state.spriteModel,
      motionModel: state.motionModel,
      perspective: state.perspective,
      direction: state.direction,
      moveType: state.moveType,
      assetKind: state.assetKind,
      endingType: state.endingType,
      kind: state.kind,
      category: state.category,
    });
  }

  // ---- Debounced selection persistence ----
  let selectionPending: Promise<unknown> = Promise.resolve();
  let selectionTimer: number | undefined;
  function scheduleSelectionPersist() {
    if (selectionTimer) window.clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(() => {
      const indices = [...store.get().selectedFrameIndices].sort((a, b) => a - b);
      selectionPending = saveSelection(indices).catch((err) => {
        console.warn("[client] failed to persist selection", err);
      });
    }, SELECTION_DEBOUNCE_MS);
  }

  // ---- Apply a server view into local state ----
  async function applyView(view: import("./lib/api").ProjectView) {
    setStatus(spriteStatus, "");
    setStatus(framesStatus, "");
    setActiveProject(view);
    await music.openProject(view.name);
    const patch = { ...hydrateFromView(view), status: "idle" as const, errorMessage: null };
    store.set(patch);
    promptInput.value = view.spritePrompt;
    motionInput.value = view.motionPrompt;
    if (assetActionInput && view.motionPrompt) {
      assetActionInput.value = view.motionPrompt;
      if (actionFlowText) actionFlowText.textContent = view.motionPrompt;
    }
  }

  let lastImageModelOptionsKey = "";
  let lastVideoModelOptionsKey = "";

  // ---- Render reactivity ----
  store.subscribe((state) => {
    const busy =
      state.navigating || state.previewGifBuilding ||
      state.status === "generating-image" ||
      state.status === "generating-video" ||
      state.status === "extracting-frames";

    music.setBusy(busy);
    sidebarTabCharacters.classList.toggle("is-active", workspace === "characters");
    sidebarTabCharacters.classList.toggle("active", workspace === "characters");
    sidebarTabAssets.classList.toggle("is-active", workspace === "assets");
    sidebarTabAssets.classList.toggle("active", workspace === "assets");
    sidebarTabMusic.classList.toggle("is-active", workspace === "music");
    sidebarTabMusic.classList.toggle("active", workspace === "music");
    sidebarTabCharacters.setAttribute("aria-pressed", String(workspace === "characters"));
    sidebarTabAssets.setAttribute("aria-pressed", String(workspace === "assets"));
    sidebarTabMusic.setAttribute("aria-pressed", String(workspace === "music"));
    sidebarCharactersPanel.hidden = workspace !== "characters";
    sidebarAssetsPanel.hidden = workspace !== "assets";
    spritesWorkspace.hidden = workspace !== "characters";
    assetsWorkspace.hidden = workspace !== "assets";
    musicWorkspace.hidden = workspace !== "music";

    const currentSprite = state.project?.sprites.find(s => s.id === state.project?.activeSpriteId);
    const breadcrumbTab = root.querySelector<HTMLSpanElement>("#breadcrumb-current-tab");
    const breadcrumbSprite = root.querySelector<HTMLSpanElement>("#breadcrumb-current-sprite");
    if (breadcrumbTab) breadcrumbTab.textContent = workspace === "characters" ? "Characters" : workspace === "assets" ? "Assets" : "Sound & SFX";
    if (breadcrumbSprite) breadcrumbSprite.textContent = currentSprite?.name || (workspace === "music" ? "Audio Tracks" : "none");

    for (const button of [btnNewCharacter, btnNewAsset, btnAssetUpload, btnAssetGenerate, addAnimationBtn, renameAnimationBtn, duplicateAnimationBtn, deleteAnimationBtn]) {
      if (button) button.disabled = busy;
    }

    renderCharacterList(state);
    renderAssetList(state);

    const hasCharacter = !!state.project?.activeSpriteId;
    const hasAnimation = !!state.activeAnimationId;
    root.querySelector<HTMLElement>(".columns")!.hidden = !hasCharacter;
    animationPicker.hidden = !hasAnimation;
    renameAnimationBtn.hidden = !hasAnimation;
    duplicateAnimationBtn.hidden = !hasAnimation;
    duplicateAnimationBtn.disabled = busy || !hasAnimation;
    deleteAnimationBtn.hidden = !hasAnimation;
    deleteAnimationBtn.disabled = busy || !hasAnimation;
    root.querySelector<HTMLElement>('label[for="animation-picker"]')!.hidden = !hasAnimation;
    root.querySelector<HTMLElement>("#animation-fields")!.hidden = !hasAnimation;
    const animEmpty = root.querySelector<HTMLElement>("#animation-empty");
    if (animEmpty) animEmpty.hidden = hasAnimation || !hasCharacter;
    animationPicker.disabled = busy || !hasAnimation;
    addAnimationBtn.disabled = busy || !hasCharacter;
    animationPicker.innerHTML = state.animations.map(a => `<option value="${escapeAttr(a.id)}">${escapeHtml(a.name)}</option>`).join("");
    animationPicker.value = state.activeAnimationId;
    promptInput.disabled = busy || !hasCharacter;
    motionInput.disabled = busy || !hasAnimation;
    motionModelSelect.disabled = busy || !hasAnimation;
    framesGrid.inert = busy;
    generateSpriteBtn.disabled = busy || !hasCharacter;
    spriteModelSelect.disabled = busy || !hasCharacter;
    uploadSpriteBtn.disabled = busy || !hasCharacter;
    spriteFileInput.disabled = busy || !hasCharacter;
    generateFramesBtn.disabled = busy || !hasAnimation || !state.spriteSrc;
    generateSheetBtn.disabled = busy || state.selectedFrameIndices.size === 0;

    // Directional Isometric controls sync
    perspectiveToggle?.querySelectorAll(".view-pill").forEach((pill) => {
      pill.classList.toggle("is-active", pill.getAttribute("data-perspective") === state.perspective);
    });
    moveCards?.querySelectorAll(".move-card").forEach((card) => {
      card.classList.toggle("is-active", card.getAttribute("data-move") === state.moveType);
    });
    compassContainer?.querySelectorAll(".compass-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-dir") === state.direction);
    });
    if (compassFacingLabel) {
      compassFacingLabel.textContent = DIRECTION_DESCRIPTIONS[state.direction] ?? `Facing ${state.direction}`;
    }
    if (compassContainer) {
      compassContainer.hidden = state.perspective === "sidescroller";
    }

    // Asset Studio sync
    if (workspace === "assets") {
      renderAssetList(state);
      const activeSprite = state.project?.sprites.find((s) => s.id === state.project?.activeSpriteId);
      if (assetActiveName) assetActiveName.textContent = activeSprite?.name ?? "—";

      if (state.spriteSrc) {
        assetReferenceBox.innerHTML = `<img src="${state.spriteSrc}" alt="${escapeAttr(activeSprite?.name ?? "Asset")}" />`;
        if (state.spriteDimensions) {
          assetReferenceCaption.textContent = `${activeSprite?.name}.png · ${state.spriteDimensions.w} × ${state.spriteDimensions.h} px`;
        } else {
          assetReferenceCaption.textContent = "—";
        }
      } else if (!busy) {
        assetReferenceBox.innerHTML = `<span class="preview__placeholder">No asset image yet<br><small class="drop-hint">Drop image here or click Upload</small></span>`;
        assetReferenceCaption.textContent = "—";
      }

      if (state.previewGifSrc) {
        assetOutputSection.hidden = false;
        assetGifPreview.innerHTML = `<img src="${state.previewGifSrc}" alt="Asset animation preview" />`;
        assetSheetMeta.textContent = `${activeSprite?.name ?? "Asset"} · ${state.selectedFrameIndices.size || 0} frames`;
      } else {
        assetOutputSection.hidden = true;
      }
    }

    if (state.spriteSrc) {
      spritePreview.innerHTML = `<img src="${state.spriteSrc}" alt="Reference sprite" />`;
      if (state.spriteDimensions) {
        spriteCaption.textContent = `${state.project?.sprites.find(s => s.id === state.project?.activeSpriteId)?.name}.png · ${state.spriteDimensions.w} × ${state.spriteDimensions.h} px`;
      } else {
        spriteCaption.textContent = "—";
      }
    } else if (!busy) {
      spritePreview.innerHTML = `
        <div class="empty-state-content">
          <div class="empty-state-title">No sprite yet</div>
          <div class="empty-state-subtitle">Drop image here or click to browse</div>
        </div>
      `;
      spriteCaption.textContent = "—";
    }

    framesGrid.innerHTML = renderFramesGrid(state.frames, state.selectedFrameIndices);

    if (state.spritesheetSrc && state.spritesheetCols) {
      sheetPreview.innerHTML = `<img src="${state.spritesheetSrc}" alt="Spritesheet" />`;
      const animationName = state.animations.find(a => a.id === state.activeAnimationId)?.name ?? "animation";
      sheetMeta.textContent = `${animationName}.png${state.asepriteSrc ? ` + ${animationName}.aseprite` : " (regenerate to save Aseprite)"} · ${state.spritesheetCols} frames`;
    } else {
      sheetPreview.innerHTML = `
        <div class="empty-state-content">
          <div class="empty-state-title">No spritesheet yet</div>
          <div class="empty-state-subtitle">Generate a spritesheet to preview here</div>
        </div>
      `;
      const pending = state.selectedFrameIndices.size;
      sheetMeta.textContent = pending > 0 ? `1 × ${pending} · pending` : "No spritesheet yet";
    }

    if (state.previewGifBuilding) {
      gifPreview.innerHTML = `
        <div class="empty-state-content">
          <div class="empty-state-title">${spinner()}Building animated preview…</div>
          <div class="empty-state-subtitle">Composing frames into preview</div>
        </div>
      `;
    } else if (state.previewGifSrc) {
      gifPreview.innerHTML = `<img src="${state.previewGifSrc}" alt="Animated preview" />`;
    } else {
      gifPreview.innerHTML = `
        <div class="empty-state-content">
          <div class="empty-state-title">No animation preview</div>
          <div class="empty-state-subtitle">Generate a spritesheet to see the animation</div>
        </div>
      `;
    }

    // Re-render the model select only when the list changes (avoid clobbering user input mid-edit)
    const imageOptionsKey = state.imageModels.map((m) => `${m.id}|${m.label}`).join(",");
    if (imageOptionsKey !== lastImageModelOptionsKey) {
      spriteModelSelect.innerHTML = state.imageModels
        .map((m) => `<option value="${escapeAttr(m.id)}">${escapeHtml(m.label)}</option>`)
        .join("");
      lastImageModelOptionsKey = imageOptionsKey;
    }
    if (spriteModelSelect.value !== state.spriteModel) {
      spriteModelSelect.value = state.spriteModel;
    }

    const videoOptionsKey = state.videoModels.map((m) => `${m.id}|${m.label}`).join(",");
    if (videoOptionsKey !== lastVideoModelOptionsKey) {
      motionModelSelect.innerHTML = state.videoModels
        .map((m) => `<option value="${escapeAttr(m.id)}">${escapeHtml(m.label)}</option>`)
        .join("");
      if (assetVideoModel) {
        assetVideoModel.innerHTML = state.videoModels
          .map((m) => `<option value="${escapeAttr(m.id)}">${escapeHtml(m.label)}</option>`)
          .join("");
      }
      lastVideoModelOptionsKey = videoOptionsKey;
    }
    if (motionModelSelect.value !== state.motionModel) {
      motionModelSelect.value = state.motionModel;
    }
    if (assetVideoModel && assetVideoModel.value !== state.motionModel) {
      assetVideoModel.value = state.motionModel;
    }
  });

  // ---- Boot ----
  Promise.all([
    checkHealth(),
    listProjects(),
    getImageModels(),
    getVideoModels(),
  ])
    .then(async ([health, projects, imageModelsResp, videoModelsResp]) => {
      if (!health.hasApiKey && !health.hasOpenAiApiKey) {
        toast("OPENAI_API_KEY or OPENROUTER_API_KEY is missing. Add it to .env to generate characters and animations.");
        setStatus(
          spriteStatus,
          "OPENAI_API_KEY or OPENROUTER_API_KEY is missing on the server. Add it to .env and restart.",
          "error",
        );
      }
      store.set({
        savedProjects: projects,
        imageModels: [...imageModelsResp.models],
        videoModels: [...videoModelsResp.models],
      });

      // Auto-load or initialize single project
      try {
        let view: ProjectView;
        if (projects.length > 0) {
          const target = projects.find((p) => p.name === "default")?.name || projects[0].name;
          view = await loadProject(target);
        } else {
          view = await newProject("default");
        }
        await applyView(view);

        // Auto-create initial character with hash if project has no characters
        if (!view.project.sprites || view.project.sprites.length === 0) {
          const charHash = `c-${generateAssetId()}`;
          const initView = await changeSprite("new", charHash, "character");
          await applyView(initView);
        }
      } catch (err) {
        console.warn("[boot] auto-load project failed, initializing default", err);
        try {
          const view = await newProject("default");
          await applyView(view);
          const charHash = `c-${generateAssetId()}`;
          const initView = await changeSprite("new", charHash, "character");
          await applyView(initView);
        } catch (e) {
          console.error("[boot] failed to initialize project", e);
        }
      }
    })
    .catch((err) => {
      console.error("[client] boot failed", err);
      toast("Backend not reachable. Start the server and refresh to try again.");
      setStatus(spriteStatus, "Backend not reachable.", "error");
    });
}

function spinner(): string {
  return `<span class="spinner"></span>`;
}

function setStatus(
  el: HTMLElement,
  html: string,
  kind: "info" | "error" | "success" = "info",
) {
  el.className =
    "status" +
    (kind === "error" ? " status--error" : kind === "success" ? " status--success" : "");
  el.innerHTML = html;
}

function renderFramesGrid(frames: string[], selected: Set<number>): string {
  const count = frames.length > 0 ? frames.length : EMPTY_PLACEHOLDER_SLOTS;
  const tiles: string[] = [];
  for (let i = 0; i < count; i++) {
    const frame = frames[i];
    const isSelected = selected.has(i);
    const empty = !frame;
    tiles.push(`
      <div class="frame-tile ${isSelected ? "is-selected" : ""} ${empty ? "is-empty" : ""}" data-index="${i}">
        <div class="frame-tile__num">${i + 1}</div>
        ${frame ? `<img src="${frame}" alt="Frame ${i + 1}" />` : ""}
      </div>
    `);
  }
  return tiles.join("");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]!);
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function renderShell(): string {
  return `
    <div id="editor" class="trae-experience app studio-experience">
      <!-- Glass Refraction SVG Filter Definition (Zero footprint) -->
      <svg class="glass-definitions" aria-hidden="true" style="position: absolute; width: 0; height: 0; pointer-events: none; visibility: hidden;">
        <defs>
          <filter id="emerald-refraction" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
            <feImage href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22400%22%20height%3D%22100%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22x%22%3E%3Cstop%20stop-color%3D%22%23ff8080%22%2F%3E%3Cstop%20offset%3D%22.08%22%20stop-color%3D%22%23808080%22%2F%3E%3Cstop%20offset%3D%22.92%22%20stop-color%3D%22%23808080%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23008080%22%2F%3E%3C%2FlinearGradient%3E%3ClinearGradient%20id%3D%22y%22%20x2%3D%220%22%20y2%3D%221%22%3E%3Cstop%20stop-color%3D%22%2380ff80%22%2F%3E%3Cstop%20offset%3D%22.2%22%20stop-color%3D%22%23808080%22%20stop-opacity%3D%220%22%2F%3E%3Cstop%20offset%3D%22.8%22%20stop-color%3D%22%23808080%22%20stop-opacity%3D%220%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23800080%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20width%3D%22400%22%20height%3D%22100%22%20fill%3D%22url(%23x)%22%2F%3E%3Crect%20width%3D%22400%22%20height%3D%22100%22%20fill%3D%22url(%23y)%22%2F%3E%3C%2Fsvg%3E" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map"></feImage>
            <feDisplacementMap in="SourceGraphic" in2="map" scale="18" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap>
            <feGaussianBlur stdDeviation="2"></feGaussianBlur>
          </filter>
        </defs>
      </svg>

      <!-- Trae / Emerald Studio Sidebar -->
      <aside class="workspace-sidebar studio-sidebar">
        <div class="sidebar-brand">
          <a href="/" class="wordmark" aria-label="Sprite Studio">
            <span class="emerald-mark-glyph">${emeraldMarkIcon}</span>
            <strong>sprite.studio</strong>
          </a>
          <button id="btn-collapse-sidebar" class="sidebar-collapse-btn" type="button" title="Hide sidepanel (Ctrl+B)" aria-label="Hide sidepanel">
            ${panelLeftIcon}
          </button>
        </div>

        <div class="workspace-label">
          YOUR WORKSPACE <span>001</span>
        </div>

        <nav class="workspace-tabs sidebar-mode-toggle" role="tablist" aria-label="Workspace mode">
          <button id="sidebar-tab-characters" class="sidebar-mode-btn is-active active" type="button" role="tab" aria-pressed="true">
            ${characterIcon}
            <span>Characters</span>
          </button>
          <button id="sidebar-tab-assets" class="sidebar-mode-btn" type="button" role="tab" aria-pressed="false">
            ${assetIcon}
            <span>Assets</span>
          </button>
          <button id="sidebar-tab-music" class="sidebar-mode-btn" type="button" role="tab" aria-pressed="false">
            ${soundIcon}
            <span>Sound</span>
          </button>
        </nav>

        <!-- Characters Sidebar Panel -->
        <div id="sidebar-characters-panel" class="sidebar-panel-glass">
          <button id="btn-new-character" class="new-task-button" type="button">
            ${plusIcon}
            <span>New Character</span>
            <kbd aria-hidden="true">N</kbd>
          </button>
          <div class="task-list-heading sidebar-section-header">
            <span>ALL CHARACTERS</span>
            <span class="sidebar-count" id="count-characters">0</span>
          </div>
          <div class="sidebar-task-list sidebar-items-list" id="character-items-list"></div>
        </div>

        <!-- Assets Sidebar Panel -->
        <div id="sidebar-assets-panel" class="sidebar-panel-glass" hidden>
          <button id="btn-new-asset" class="new-task-button" type="button">
            ${plusIcon}
            <span>New Asset</span>
            <kbd aria-hidden="true">A</kbd>
          </button>
          <div class="folder-tree" id="asset-folders">
            <button type="button" class="folder-btn is-active" data-folder="All Assets">
              <span>📁 All Assets</span>
              <span class="folder-btn__count" id="count-all">0</span>
            </button>
            <button type="button" class="folder-btn" data-folder="Vehicles">
              <span>🚛 Vehicles / Trucks</span>
              <span class="folder-btn__count" id="count-vehicles">0</span>
            </button>
            <button type="button" class="folder-btn" data-folder="Equipment">
              <span>🏗 Equipment</span>
              <span class="folder-btn__count" id="count-equipment">0</span>
            </button>
            <button type="button" class="folder-btn" data-folder="Props">
              <span>📦 Props</span>
              <span class="folder-btn__count" id="count-props">0</span>
            </button>
            <button type="button" class="folder-btn" data-folder="Items">
              <span>💎 Items</span>
              <span class="folder-btn__count" id="count-items">0</span>
            </button>
            <button type="button" class="folder-btn" data-folder="Effects">
              <span>✨ Effects</span>
              <span class="folder-btn__count" id="count-effects">0</span>
            </button>
          </div>
          <div class="task-list-heading sidebar-section-header">
            <span>ASSETS IN FOLDER</span>
            <span class="sidebar-count" id="count-assets-folder">0</span>
          </div>
          <div class="sidebar-task-list sidebar-items-list" id="asset-items-list"></div>
        </div>

        <!-- Sidebar Workspace Footer -->
        <div class="workspace-account">
          <div class="profile-avatar studio-avatar">✦</div>
          <div class="account-details">
            <div class="account-name-row">
              <strong>Studio Local</strong>
              <span class="pro-badge">ACTIVE</span>
            </div>
            <small>Single Project Mode</small>
          </div>
        </div>

        <div class="sidebar-footer">
          <span class="sidebar-footer-link">💬 Feedback</span>
          <span class="sidebar-footer-link">❓ Help</span>
          <span class="task-demo-label sidebar-version-chip">v0.2</span>
        </div>
      </aside>

      <!-- Main Workspace Area -->
      <main class="workspace-main studio-main">
        <header class="workspace-header app-header">
          <div class="header-left">
            <button id="btn-toggle-sidebar" class="sidebar-toggle-btn" type="button" title="Toggle sidepanel (Ctrl+B)" aria-label="Toggle sidepanel">
              ${panelLeftIcon}
            </button>
            <div class="workspace-breadcrumb">
              <span class="breadcrumb-product">Workspace</span>
              <span class="breadcrumb-slash">/</span>
              <span id="breadcrumb-current-tab" class="breadcrumb-view">Characters</span>
              <span class="breadcrumb-slash">/</span>
              <span id="breadcrumb-current-sprite" class="breadcrumb-view font-semibold">c-default</span>
            </div>
          </div>
          <div class="header-actions">
            <span class="preview-badge">Interactive 2.5D</span>
            <span id="project-status" class="app-header__status status-pill">✓ Auto-saved</span>
          </div>
        </header>

        <div class="workspace-scroll-area">
          <!-- Characters Workspace -->
          <div id="sprites-workspace">
            <div class="columns">

          <section class="card frosted-surface" id="step-1-card">
            <div class="card-header-bar">
              <span class="card-step-badge">01</span>
              <div>
                <span class="eyebrow">STEP 01</span>
                <h2 class="card__title">Character Reference</h2>
              </div>
            </div>
            <div class="field">
              <label class="field__label" for="sprite-prompt">Character Prompt</label>
              <div class="prompt-shell">
                <div class="prompt-paper">
                  <textarea
                    id="sprite-prompt"
                    class="textarea"
                    placeholder="Describe the character or object…"
                    rows="3"
                  ></textarea>
                </div>
              </div>
            </div>
            <div class="field">
              <label class="field__label" for="sprite-model">Model</label>
              <select id="sprite-model" class="select"></select>
            </div>
            <button id="btn-generate-sprite" class="btn btn--primary btn--block" type="button">
              ${sparkleIcon}
              <span>Generate Character</span>
            </button>
            <div class="step-divider"><span>or drop / upload image</span></div>
            <input type="file" id="sprite-file-input" accept="image/*" style="display: none;" />
            <button id="btn-upload-sprite" class="btn btn--secondary btn--block" type="button">
              ${uploadIcon}
              <span>Upload Image</span>
            </button>
            <div id="sprite-status" class="status"></div>
            <div class="preview">
              <div class="preview__label">Character Reference</div>
              <div id="sprite-preview" class="preview__box preview__box--droppable" title="Drop an image here or click to browse">
                <div class="empty-state-content">
                  <div class="empty-state-title">No sprite yet</div>
                  <div class="empty-state-subtitle">Drop image here or click to browse</div>
                </div>
              </div>
              <div id="sprite-caption" class="preview__caption">—</div>
            </div>
          </section>

          <section class="card frosted-surface">
            <div class="card-header-bar">
              <span class="card-step-badge">02</span>
              <div>
                <span class="eyebrow">STEP 02</span>
                <h2 class="card__title">Create Animation</h2>
              </div>
            </div>
            <div class="field">
              <label class="field__label" for="animation-picker">Animation</label>
              <select id="animation-picker" class="select"></select>
              <div class="animation-actions">
                <button id="btn-rename-animation" class="btn btn--secondary btn--sm" type="button">Rename</button>
                <button id="btn-duplicate-animation" class="btn btn--secondary btn--sm" type="button" title="Duplicate animation" aria-label="Duplicate animation">${copyIcon}</button>
                <button id="btn-delete-animation" class="btn btn--secondary btn--sm" type="button" title="Delete animation" aria-label="Delete animation">${trashIcon}</button>
                <button id="btn-add-animation" class="btn btn--secondary btn--sm" type="button">${plusIcon} Add animation</button>
              </div>
            </div>
            <div id="animation-empty" class="animation-empty-state" hidden>
              <div class="empty-state-content">
                <div class="empty-state-title">No animations yet for this character</div>
                <div class="empty-state-subtitle">Create an animation to start generating motion frames</div>
              </div>
              <button id="btn-add-first-animation" class="btn btn--primary" type="button" style="margin-top: 6px;">${plusIcon} Create First Animation</button>
            </div>
            <div id="animation-fields">
              <!-- Perspective Mode Pills -->
              <div class="view-mode-toggle" id="char-perspective-toggle">
                <button type="button" class="view-pill is-active" data-perspective="isometric">
                  <span>⬡ Isometric (8-direction)</span>
                </button>
                <button type="button" class="view-pill" data-perspective="sidescroller">
                  <span>⇄ Side-scroller</span>
                </button>
              </div>

              <!-- Essentials Movement Cards -->
              <div class="move-cards-section">
                <div class="move-cards-label">
                  <span>Essentials</span>
                  <span>Core moves</span>
                </div>
                <div class="move-cards" id="char-move-cards">
                  <button type="button" class="move-card is-active" data-move="walk">
                    <span class="move-card__icon">🚶</span>
                    <span class="move-card__title">Walk</span>
                  </button>
                  <button type="button" class="move-card" data-move="idle">
                    <span class="move-card__icon">🧍</span>
                    <span class="move-card__title">Idle</span>
                  </button>
                  <button type="button" class="move-card" data-move="run">
                    <span class="move-card__icon">🏃</span>
                    <span class="move-card__title">Run</span>
                  </button>
                  <button type="button" class="move-card" data-move="jump">
                    <span class="move-card__icon">🤸</span>
                    <span class="move-card__title">Jump</span>
                  </button>
                  <button type="button" class="move-card" data-move="attack">
                    <span class="move-card__icon">🤺</span>
                    <span class="move-card__title">Attack</span>
                  </button>
                  <button type="button" class="move-card" data-move="custom">
                    <span class="move-card__icon">✨</span>
                    <span class="move-card__title">Custom</span>
                  </button>
                </div>
              </div>

              <!-- 8-Direction Compass Pad -->
              <div class="compass-pad-container" id="char-compass-container">
                <div class="compass-pad-header">
                  <span class="compass-pad-title">Facing Direction</span>
                  <span id="compass-facing-label" class="compass-facing-label">Facing North</span>
                </div>
                <div class="compass-pad" role="group" aria-label="Facing direction">
                  <button type="button" class="compass-btn" data-dir="NW" title="North-West">↖</button>
                  <button type="button" class="compass-btn is-active" data-dir="N" title="North">↑</button>
                  <button type="button" class="compass-btn" data-dir="NE" title="North-East">↗</button>
                  <button type="button" class="compass-btn" data-dir="W" title="West">←</button>
                  <div class="compass-center">⬡</div>
                  <button type="button" class="compass-btn" data-dir="E" title="East">→</button>
                  <button type="button" class="compass-btn" data-dir="SW" title="South-West">↙</button>
                  <button type="button" class="compass-btn" data-dir="S" title="South">↓</button>
                  <button type="button" class="compass-btn" data-dir="SE" title="South-East">↘</button>
                </div>
              </div>

              <div class="field">
                <label class="field__label" for="motion-prompt">Movement Prompt</label>
                <div class="prompt-shell">
                  <div class="prompt-paper">
                    <textarea
                      id="motion-prompt"
                      class="textarea"
                      placeholder="e.g., walking left, jump, attack right…"
                      rows="3"
                    ></textarea>
                  </div>
                </div>
              </div>
            <div class="motion-controls">
              <div class="field motion-controls__model">
                <label class="field__label" for="motion-model">Model</label>
                <select id="motion-model" class="select"></select>
              </div>
              <button id="btn-generate-frames" class="btn btn--secondary motion-controls__btn" type="button">
                ${frameIcon}
                <span>Generate Animation</span>
              </button>
            </div>
            <div id="frames-status" class="status"></div>
            <div class="frames-section">
              <div class="frames-section__label">Select frames to include</div>
              <div id="frames-grid" class="frames-grid"></div>
            </div>
            <button id="btn-generate-sheet" class="btn btn--primary btn--block btn--lg" type="button">
              ${gridIcon}
              <span>Update Spritesheet</span>
            </button>
            </div>
          </section>

          <section class="card frosted-surface">
            <div class="card-header-bar">
              <span class="card-step-badge">03</span>
              <div>
                <span class="eyebrow">STEP 03</span>
                <h2 class="card__title">Spritesheet Preview</h2>
              </div>
            </div>
            <div id="sheet-preview" class="sheet-preview">
              <div class="empty-state-content">
                <div class="empty-state-title">No spritesheet yet</div>
                <div class="empty-state-subtitle">Generate a spritesheet to preview here</div>
              </div>
            </div>
            <div class="sheet-footer">
              <div id="sheet-meta" class="sheet-footer__meta">No spritesheet yet</div>
            </div>
            <div style="display: flex; gap: 8px; margin-top: 10px;">
              <button id="btn-export-unity" class="btn btn--secondary btn--sm" type="button" style="flex: 1;">Export for Unity</button>
              <button id="btn-export-godot" class="btn btn--secondary btn--sm" type="button" style="flex: 1;">Export for Godot</button>
            </div>
            <p class="asset-save-note">PNG and Aseprite are saved automatically in your project. Update the spritesheet after changing the frame selection.</p>
            <div class="gif-section">
              <div class="gif-section__label">Animated Preview</div>
              <div id="gif-preview" class="gif-preview">
                <div class="empty-state-content">
                  <div class="empty-state-title">No animation preview</div>
                  <div class="empty-state-subtitle">Generate a spritesheet to see the animation</div>
                </div>
              </div>
            </div>
          </section>

        </div>
        </div>

        <!-- Non-Character Articulated Assets & Machinery Workspace -->
        <div id="assets-workspace" hidden>
          <div class="assets-container">
            <div class="assets-content-layout">
              <!-- Center: 3-Step Wizard for Animating Asset -->
              <section class="wizard-card frosted-surface">
                <div class="wizard-stepper">
                  <div class="wizard-stepper__title">
                    <span class="eyebrow">ARTICULATED MACHINERY</span>
                    <h3 style="margin: 0; font-size: 16px;">✨ Animate Asset</h3>
                  </div>
                  <div class="wizard-dots">
                    <span class="wizard-dot is-active" id="dot-step-1" title="Step 1: Ending"></span>
                    <span class="wizard-dot" id="dot-step-2" title="Step 2: Action"></span>
                    <span class="wizard-dot" id="dot-step-3" title="Step 3: Review"></span>
                  </div>
                </div>

                <!-- Step 1: Animation Ending -->
                <div class="wizard-step" id="wizard-step-1">
                  <h3 style="margin: 0 0 6px; font-size: 15px;">Animation Ending</h3>
                  <p style="margin: 0 0 16px; color: var(--text-muted); font-size: 13px;">How should the animation end?</p>
                  <div class="ending-cards">
                    <label class="ending-card is-active" id="label-ending-open">
                      <input type="radio" name="asset-ending" value="open-ended" checked />
                      <div class="ending-card__content">
                        <div class="ending-card__header">
                          <span class="ending-card__title">Open-ended</span>
                          <span class="ending-badge">RECOMMENDED</span>
                        </div>
                        <div class="ending-card__desc">Let AI decide how the animation ends naturally</div>
                      </div>
                    </label>
                    <label class="ending-card" id="label-ending-loop">
                      <input type="radio" name="asset-ending" value="seamless" />
                      <div class="ending-card__content">
                        <div class="ending-card__header">
                          <span class="ending-card__title">Seamless loop</span>
                          <span class="ending-badge ending-badge--loop">LOOP</span>
                        </div>
                        <div class="ending-card__desc">Animation returns precisely to starting position</div>
                      </div>
                    </label>
                    <label class="ending-card" id="label-ending-custom">
                      <input type="radio" name="asset-ending" value="custom" />
                      <div class="ending-card__content">
                        <div class="ending-card__header">
                          <span class="ending-card__title">Custom ending</span>
                        </div>
                        <div class="ending-card__desc">Generate a specific ending pose or resting state</div>
                      </div>
                    </label>
                  </div>
                  <div class="wizard-actions">
                    <div></div>
                    <button id="btn-asset-step-1-next" class="btn btn--primary" type="button">Next &rarr;</button>
                  </div>
                </div>

                <!-- Step 2: Animation Action -->
                <div class="wizard-step" id="wizard-step-2" hidden>
                  <h3 style="margin: 0 0 6px; font-size: 15px;">Animation Action</h3>
                  <p style="margin: 0 0 16px; color: var(--text-muted); font-size: 13px;">Describe what happens in the animation</p>
                  <div class="action-flow">
                    <div class="action-flow__node">
                      <span class="action-flow__node-label">FIRST</span>
                      <div class="action-flow__thumb" id="action-flow-first"></div>
                    </div>
                    <div class="action-flow__mid">
                      <div class="action-flow__mid-label">ACTION</div>
                      <div class="action-flow__mid-text" id="action-flow-text">Describe the motion…</div>
                    </div>
                    <div class="action-flow__node">
                      <span class="action-flow__node-label">LAST (AI)</span>
                      <div class="action-flow__thumb" id="action-flow-last"><span>AI</span></div>
                    </div>
                  </div>

                  <div class="quick-add-section">
                    <div class="quick-add-label">
                      <span>⚡ QUICK ADD (Mechanical &amp; Props)</span>
                    </div>
                    <div class="quick-add-chips">
                      <button type="button" class="chip-btn chip-btn--highlight" data-chip="hydraulic crane arm smoothly raises bucket up high into the air and lowers down">🏗 arm raises up and down</button>
                      <button type="button" class="chip-btn" data-chip="hydraulic lift extends upward steadily then folds back">🪜 hydraulic lift extends</button>
                      <button type="button" class="chip-btn" data-chip="spins around smoothly in place 360 degrees">🔄 spins around</button>
                      <button type="button" class="chip-btn" data-chip="bounces gently up and down on shock absorbers">⬆ bounces up and down</button>
                      <button type="button" class="chip-btn" data-chip="wobbles side to side mechanically">↔ wobbles side to side</button>
                      <button type="button" class="chip-btn" data-chip="floats gently hovering above the surface">☁ floats gently</button>
                      <button type="button" class="chip-btn" data-chip="headlights and warning beacon light glow brightly">💡 glows brightly</button>
                      <button type="button" class="chip-btn" data-chip="cabin doors swing open and close">🚪 doors open and close</button>
                    </div>
                  </div>

                  <div class="field">
                    <div class="prompt-shell">
                      <div class="prompt-paper">
                        <textarea
                          id="asset-action-input"
                          class="textarea"
                          rows="3"
                          placeholder="e.g. hydraulic crane arm smoothly raises bucket up high into the air and lowers down…"
                        ></textarea>
                      </div>
                    </div>
                  </div>

                  <div class="wizard-actions">
                    <button id="btn-asset-step-2-back" class="btn btn--secondary" type="button">&larr; Back</button>
                    <button id="btn-asset-step-2-next" class="btn btn--primary" type="button">Next &rarr;</button>
                  </div>
                </div>

                <!-- Step 3: Review & Generate -->
                <div class="wizard-step" id="wizard-step-3" hidden>
                  <h3 style="margin: 0 0 6px; font-size: 15px;">Review</h3>
                  <p style="margin: 0 0 16px; color: var(--text-muted); font-size: 13px;">Confirm your animation details</p>
                  <div class="review-box">
                    <div class="review-item">
                      <span class="review-item__label">Asset</span>
                      <span class="review-item__value" id="review-asset-name">—</span>
                    </div>
                    <div class="review-item">
                      <span class="review-item__label">Action</span>
                      <span class="review-item__value" id="review-action-text">—</span>
                    </div>
                    <div class="review-item">
                      <span class="review-item__label">Ending Mode</span>
                      <span class="review-item__value" id="review-ending-text">Open-ended</span>
                    </div>
                    <div class="review-item">
                      <span class="review-item__label">Rigid Anchoring</span>
                      <span class="review-item__value" style="color: #10b981;">✓ Chassis &amp; Wheels locked</span>
                    </div>
                    <div class="review-item">
                      <span class="review-item__label">Model</span>
                      <select id="asset-video-model" class="select select--sm" style="max-width: 180px;"></select>
                    </div>
                    <div class="review-item">
                      <span class="review-item__label">Duration</span>
                      <select id="asset-duration-select" class="select select--sm" style="max-width: 180px;">
                        <option value="4" selected>4 seconds (Turbo)</option>
                        <option value="8">8 seconds</option>
                        <option value="12">12 seconds</option>
                      </select>
                    </div>
                  </div>

                  <button id="btn-asset-generate" class="btn btn--primary btn--block btn--lg" type="button">
                    ${sparkleIcon} Generate Asset Animation
                  </button>
                  <div id="asset-status" class="status" style="margin-top: 12px;"></div>

                  <div class="wizard-actions">
                    <button id="btn-asset-step-3-back" class="btn btn--secondary" type="button">&larr; Back</button>
                    <div></div>
                  </div>
                </div>
              </section>

              <!-- Right: Asset Reference & Output Preview -->
              <aside class="asset-preview-card frosted-surface">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <h3 style="margin: 0; font-size: 14px; font-weight: 700;">Asset Reference</h3>
                  <span id="asset-active-name" style="font-size: 12px; color: #10b981; font-weight: 600;">—</span>
                </div>
                <div id="asset-reference-box" class="asset-preview-box preview__box--droppable" title="Drop an asset image here or click upload">
                  <div class="empty-state-content">
                    <div class="empty-state-title">No asset image yet</div>
                    <div class="empty-state-subtitle">Drop image here or click Upload</div>
                  </div>
                </div>
                <input type="file" id="asset-file-input" accept="image/*" style="display: none;" />
                <button id="btn-asset-upload" class="btn btn--secondary btn--block" type="button">
                  ${uploadIcon} Upload Asset Image
                </button>
                <div class="asset-preview-meta" id="asset-reference-caption">—</div>

                <!-- Spritesheet / Gif Output when ready -->
                <div id="asset-output-section" hidden style="margin-top: 10px; border-top: 1px solid var(--border); padding-top: 12px;">
                  <h4 style="margin: 0 0 8px; font-size: 13px; font-weight: 600;">Animation Preview</h4>
                  <div id="asset-gif-preview" class="gif-preview" style="min-height: 140px;">
                    <div class="empty-state-content">
                      <div class="empty-state-title">Generating preview…</div>
                      <div class="empty-state-subtitle">Rendering animation preview</div>
                    </div>
                  </div>
                  <div id="asset-sheet-meta" style="font-size: 11px; color: var(--text-muted); margin-top: 6px; text-align: center;">—</div>
                </div>
              </aside>
            </div>
          </div>
        </div>
        <div id="music-workspace" hidden></div>
        </div>
      </main>
    </div>
  `;
}

function createToast(root: HTMLElement) {
  const el = document.createElement("div");
  el.className = "toast";
  root.appendChild(el);
  let timer: number | undefined;
  return (msg: string) => {
    el.textContent = msg;
    el.classList.add("is-visible");
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => el.classList.remove("is-visible"), 2200);
  };
}

function askName(title: string, initial = "", maxLength = 60): Promise<string | null> {
  const dialog = document.createElement("dialog");
  dialog.className = "name-dialog";
  dialog.setAttribute("aria-labelledby", "name-dialog-title");
  dialog.innerHTML = `<form method="dialog">
    <h2 id="name-dialog-title">${escapeHtml(title)}</h2>
    <label class="field__label" for="asset-name">Name</label>
    <input id="asset-name" class="select" name="name" value="${escapeAttr(initial)}"
      required maxlength="${maxLength}" pattern="[a-zA-Z0-9_\\-]+" autofocus autocomplete="off" />
    <p>Use letters, numbers, hyphens or underscores. This name is used for the folder.</p>
    <div class="name-dialog__actions">
      <button class="btn btn--secondary" value="cancel" formnovalidate>Cancel</button>
      <button class="btn btn--primary" value="save">Save name</button>
    </div>
  </form>`;
  document.body.appendChild(dialog);
  return new Promise(resolve => {
    dialog.addEventListener("close", () => {
      const value = dialog.returnValue === "save" ? dialog.querySelector<HTMLInputElement>("input")!.value.trim() : null;
      dialog.remove();
      resolve(value);
    }, { once: true });
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>("input")!.select();
  });
}
