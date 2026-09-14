// Pluggable Model Provider Interface
// Supports OpenAI, OpenRouter, and local model services (Ollama, ComfyUI, vLLM, local diffusers).

export type ModelProviderType = "openai" | "openrouter" | "local";

export interface ProviderConfig {
  type: ModelProviderType;
  baseUrl?: string;
  apiKey?: string;
}

export interface ImageGenerationOptions {
  prompt: string;
  model?: string;
  width?: number;
  height?: number;
  style?: string;
}

export interface VideoGenerationOptions {
  imageUrl: string;
  prompt: string;
  model?: string;
  duration?: number;
  perspective?: "isometric" | "sidescroller";
  motionConstraints?: "biped_treadmill" | "machine_rigid_chassis" | "default";
}

export interface ModelProvider {
  readonly type: ModelProviderType;
  readonly isConfigured: boolean;
  generateImage(options: ImageGenerationOptions): Promise<{ dataUrl: string; base64: string }>;
  generateVideo(options: VideoGenerationOptions): Promise<{ videoUrl: string; downloadHeaders?: Record<string, string> }>;
}

export function detectActiveProvider(): ModelProviderType {
  const explicit = process.env.MODEL_PROVIDER?.toLowerCase().trim();
  if (explicit === "openai" || explicit === "openrouter" || explicit === "local") {
    return explicit;
  }
  if (process.env.LOCAL_MODEL_ENDPOINT) {
    return "local";
  }
  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }
  return "openrouter";
}

/** Local model service provider stub - extensible for ComfyUI / Ollama / local diffusers */
export class LocalModelProvider implements ModelProvider {
  readonly type: ModelProviderType = "local";
  private baseUrl: string;

  constructor(endpoint?: string) {
    this.baseUrl = endpoint || process.env.LOCAL_MODEL_ENDPOINT || "http://127.0.0.1:11434";
  }

  get isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  async generateImage(options: ImageGenerationOptions): Promise<{ dataUrl: string; base64: string }> {
    const res = await fetch(`${this.baseUrl}/api/generate-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: options.prompt,
        model: options.model ?? "local-diffusion",
        width: options.width ?? 1024,
        height: options.height ?? 1024,
      }),
    });
    if (!res.ok) {
      throw new Error(`Local model service returned HTTP ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { base64?: string; dataUrl?: string };
    const b64 = json.base64 || (json.dataUrl?.split(",")[1] ?? "");
    return {
      base64: b64,
      dataUrl: json.dataUrl || `data:image/png;base64,${b64}`,
    };
  }

  async generateVideo(options: VideoGenerationOptions): Promise<{ videoUrl: string; downloadHeaders?: Record<string, string> }> {
    const res = await fetch(`${this.baseUrl}/api/generate-video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: options.imageUrl,
        prompt: options.prompt,
        model: options.model ?? "local-video",
        duration: options.duration ?? 4,
        constraints: options.motionConstraints,
      }),
    });
    if (!res.ok) {
      throw new Error(`Local video service returned HTTP ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { url: string; headers?: Record<string, string> };
    return { videoUrl: json.url, downloadHeaders: json.headers };
  }
}
