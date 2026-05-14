import sharp from "sharp";
import { nowIso } from "@shared/time";
import type { Project, TaskError, VisionResult } from "@shared/types/project";
import type { GlobalSettings } from "@shared/types/settings";
import type { AppPaths } from "@main/paths";
import { ApiKeyStore } from "@adapters/api-keys";
import { GeminiVisionProvider } from "@adapters/gemini";

export class VisionQueue {
  #apiKeys: ApiKeyStore;

  constructor(
    paths: AppPaths,
    private readonly settings: GlobalSettings
  ) {
    this.#apiKeys = new ApiKeyStore(paths.apiKeysPath);
  }

  async setGeminiApiKey(value: string): Promise<void> {
    await this.#apiKeys.set("gemini", value);
  }

  async hasGeminiApiKey(): Promise<boolean> {
    return this.#apiKeys.has("gemini");
  }

  async runForTask(project: Project, taskId: string): Promise<void> {
    const task = project.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (!task.output) throw new Error("Task must be saved before vision can run.");

    try {
      const apiKey = await this.#apiKeys.get("gemini");
      if (!apiKey) {
        throw new Error("Gemini API key is missing. Open Settings and save a key, then retry.");
      }

      const imageBytes = await prepareVisionInput(task.output.stagedPath, this.settings.preResizeLongEdge);
      const provider = new GeminiVisionProvider(apiKey);
      const described = await provider.describe(
        { imageBytes, mimeType: "image/jpeg" },
        {
          model: this.settings.model,
          projectContext: this.settings.visionProjectContext || null,
          customPromptAddendum: this.settings.customPromptAddendum || null
        }
      );
      task.output.vision = {
        description: described.description,
        slugCandidates: described.slugCandidates,
        model: this.settings.model,
        ranAt: nowIso()
      };
      task.error = null;
      task.updatedAt = nowIso();
    } catch (error) {
      task.error = visionError(error);
      task.updatedAt = nowIso();
    }
  }
}

async function prepareVisionInput(stagedPath: string, longEdge: number): Promise<Buffer> {
  return sharp(stagedPath, { limitInputPixels: false })
    .resize({ width: longEdge, height: longEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

function visionError(error: unknown): TaskError {
  const known = error instanceof Error ? error : new Error(String(error));
  const message = classifyVisionMessage(error, known.message);
  return {
    stage: "vision",
    message,
    detail: known.stack ?? null,
    occurredAt: nowIso(),
    retryable: isVisionRetryable(error, known.message)
  };
}

function classifyVisionMessage(error: unknown, fallback: string): string {
  const raw = `${fallback} ${readErrorPayload(error)}`.toLowerCase();
  const status = readErrorStatus(error);

  if (raw.includes("api key is missing")) {
    return "Gemini API key is missing. Open Settings and save a key, then retry.";
  }
  if (status === 401 || status === 403 || /\bunauthori[sz]ed\b|\bforbidden\b|\binvalid api key\b|\bauth/i.test(raw)) {
    return "Gemini authentication failed. Check the saved API key in Settings, then retry.";
  }
  if (status === 429 || /\brate limit\b|\bquota\b|\bresource has been exhausted\b/.test(raw)) {
    return "Gemini rate limit reached. Wait a moment, then retry.";
  }
  if (status !== null && status >= 500) {
    return "Gemini is temporarily unavailable. Retry in a moment.";
  }
  if (/\btimeout\b|\btimed out\b|\bnetwork\b|\bfetch failed\b|\bconnection\b|\bsocket\b|\beconn/i.test(raw)) {
    return "Couldn't reach Gemini. Check your network connection and retry.";
  }
  if (/\bsafety\b|\bcontent policy\b|\bpolicy\b|\bblocked\b|\bprohibited\b|\bdisallow/i.test(raw)) {
    return "Gemini refused this image because of a safety or content policy restriction.";
  }
  if (/\binvalid describe response\b|\binvalid describe\b|\bstrict json\b|\bjson\b/.test(raw)) {
    return "Gemini returned an unexpected response. Retry, or adjust the configured model if the problem persists.";
  }
  return fallback;
}

function isVisionRetryable(error: unknown, message: string): boolean {
  const raw = `${message} ${readErrorPayload(error)}`.toLowerCase();
  const status = readErrorStatus(error);

  if (raw.includes("api key is missing")) return true;
  if (status === 401 || status === 403) return true;
  if (status === 429 || (status !== null && status >= 500)) return true;
  if (/\btimeout\b|\btimed out\b|\bnetwork\b|\bfetch failed\b|\bconnection\b|\bsocket\b|\beconn/i.test(raw)) return true;
  if (/\binvalid describe response\b|\binvalid describe\b|\bjson\b/.test(raw)) return true;
  if (/\bsafety\b|\bcontent policy\b|\bpolicy\b|\bblocked\b|\bprohibited\b|\bdisallow/i.test(raw)) return false;
  return true;
}

function readErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function readErrorPayload(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  try {
    return JSON.stringify((error as { error?: unknown }).error ?? "");
  } catch {
    return "";
  }
}
