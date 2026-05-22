import sharp from "sharp";
import PQueue from "p-queue";
import { nowIso } from "@shared/time";
import type { Project, Task, TaskError } from "@shared/types/project";
import type { VisionRunMode, VisionRunOptions } from "@shared/types/ipc";
import { includesDescriptionGeneration, includesSlugGeneration, resolveVisionRunMode } from "@shared/vision-run-mode";
import type { GlobalSettings } from "@shared/types/settings";
import type { AppPaths } from "@main/paths";
import { ApiKeyStore } from "@adapters/api-keys";
import { GeminiVisionProvider } from "@adapters/gemini";

export class VisionQueue {
  #apiKeys: ApiKeyStore;
  #queue: PQueue;
  #currentConcurrency: number;
  #pendingTaskIds: Set<string> = new Set();
  #cancelledTaskIds: Set<string> = new Set();

  constructor(
    paths: AppPaths,
    private readonly settings: GlobalSettings
  ) {
    this.#apiKeys = new ApiKeyStore(paths.apiKeysPath);
    this.#currentConcurrency = Math.max(1, settings.visionConcurrency);
    this.#queue = new PQueue({ concurrency: this.#currentConcurrency });
  }

  async setGeminiApiKey(value: string): Promise<void> {
    await this.#apiKeys.set("gemini", value);
  }

  async hasGeminiApiKey(): Promise<boolean> {
    return this.#apiKeys.has("gemini");
  }

  async clearGeminiApiKey(): Promise<void> {
    await this.#apiKeys.delete("gemini");
  }

  async runForTask(
    project: Project,
    taskId: string,
    options?: VisionRunOptions,
    onProgress?: () => void | Promise<void>
  ): Promise<void> {
    const task = project.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (!task.output) throw new Error("Task must be saved before vision can run.");
    const mode = resolveVisionRunMode(task, options);
    if (!mode) return;

    if (this.#pendingTaskIds.has(taskId)) return;
    this.#pendingTaskIds.add(taskId);
    this.#syncConcurrency();
    await this.#queue.add(async () => {
      this.#pendingTaskIds.delete(taskId);
      if (this.#cancelledTaskIds.delete(taskId)) return;
      await this.#runForTaskInner(task, mode, onProgress);
    });
  }

  cancelTask(taskId: string): boolean {
    if (!this.#pendingTaskIds.has(taskId)) return false;
    this.#cancelledTaskIds.add(taskId);
    return true;
  }

  cancelAll(): string[] {
    const ids = Array.from(this.#pendingTaskIds);
    for (const id of ids) this.#cancelledTaskIds.add(id);
    return ids;
  }

  #syncConcurrency(): void {
    const desired = Math.max(1, this.settings.visionConcurrency);
    if (desired !== this.#currentConcurrency) {
      this.#queue.concurrency = desired;
      this.#currentConcurrency = desired;
    }
  }

  async #runForTaskInner(
    task: Task,
    mode: VisionRunMode,
    onProgress?: () => void | Promise<void>
  ): Promise<void> {
    if (!task.output) return;
    try {
      const apiKey = await this.#apiKeys.get("gemini");
      if (!apiKey) {
        throw new Error("Gemini API key is missing. Open Settings and save a key, then retry.");
      }

      const callOptions = {
        timeoutMs: this.settings.visionTimeoutMs,
        maxRetries: this.settings.visionMaxRetries,
        initialBackoffMs: this.settings.visionInitialBackoffMs
      };
      const previousVision = task.output.vision;
      const previousSlugCandidates = previousVision?.slugCandidates ?? [];
      const provider = new GeminiVisionProvider(apiKey);
      let description = previousVision?.description ?? "";
      if (includesDescriptionGeneration(mode)) {
        const imageBytes = await prepareVisionInput(task.output.stagedPath, this.settings.preResizeLongEdge);
        description = await provider.describeImage(
          { imageBytes, mimeType: "image/jpeg" },
          {
            model: this.settings.model,
            descriptionPrompt: this.settings.visionDescriptionPrompt,
            ...callOptions
          }
        );
        if (includesSlugGeneration(mode)) {
          task.output.vision = {
            description,
            slugCandidates: [],
            model: this.settings.model,
            ranAt: nowIso()
          };
          task.error = null;
          task.updatedAt = nowIso();
          await onProgress?.();
        }
      } else if (!description.trim()) {
        throw new Error("Generate description first, then regenerate the slug.");
      }
      const slugCandidates = includesSlugGeneration(mode)
        ? await provider.suggestSlugs(description, {
          model: this.settings.model,
          slugPrompt: this.settings.visionSlugPrompt,
          ...callOptions
        })
        : previousSlugCandidates;
      task.output.vision = {
        description,
        slugCandidates,
        model: this.settings.model,
        ranAt: nowIso()
      };
      if (includesSlugGeneration(mode) && slugCandidates[0]) {
        task.customSlug = slugCandidates[0];
      }
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
