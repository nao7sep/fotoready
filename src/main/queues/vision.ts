import sharp from "sharp";
import PQueue from "p-queue";
import { nowIso } from "@shared/time";
import { MAX_INPUT_PIXELS } from "@runtime/decode";
import type { Project, Task, TaskError } from "@shared/types/project";
import type { VisionRunMode, VisionRunOptions } from "@shared/types/ipc";
import { includesDescriptionGeneration, includesSlugGeneration, resolveVisionRunMode } from "@shared/vision-run-mode";
import type { GlobalSettings } from "@shared/types/settings";
import type { AppPaths } from "@main/paths";
import type { AppLogger } from "@main/logger";
import { ApiKeyStore } from "@adapters/api-keys";
import { GeminiVisionProvider, VisionProviderFailure } from "@adapters/gemini";
import { ApiError } from "@google/genai";

/** The state of one scheduled-but-not-yet-started vision run. Its cancel flag is owned by one job. */
type PendingVisionJob = { cancelled: boolean };

export class VisionQueue {
  #apiKeys: ApiKeyStore;
  #queue: PQueue;
  #currentConcurrency: number;
  // Cancellation is bound to the specific scheduled job, not a shared task-keyed set, so a fresh
  // run for a task whose job is still pending revives it rather than being swallowed then skipped.
  #pending = new Map<string, PendingVisionJob>();

  constructor(
    paths: AppPaths,
    private readonly settings: GlobalSettings,
    private readonly logger?: AppLogger
  ) {
    this.#apiKeys = new ApiKeyStore(paths.apiKeysPath, logger);
    this.#currentConcurrency = Math.max(1, settings.visionConcurrency);
    this.#queue = new PQueue({ concurrency: this.#currentConcurrency });
  }

  async setGeminiApiKey(value: string): Promise<void> {
    await this.#apiKeys.set(["gemini"], value);
  }

  async hasGeminiApiKey(): Promise<boolean> {
    return this.#apiKeys.has(["gemini"]);
  }

  async clearGeminiApiKey(): Promise<void> {
    await this.#apiKeys.clear(["gemini"]);
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

    const existing = this.#pending.get(taskId);
    if (existing) {
      existing.cancelled = false;
      return;
    }
    const job: PendingVisionJob = { cancelled: false };
    this.#pending.set(taskId, job);
    this.#syncConcurrency();
    await this.#queue.add(async () => {
      this.#pending.delete(taskId);
      if (job.cancelled) return;
      await this.#runForTaskInner(task, mode, onProgress);
    });
  }

  cancelTask(taskId: string): boolean {
    const job = this.#pending.get(taskId);
    if (!job) return false;
    job.cancelled = true;
    return true;
  }

  cancelAll(): string[] {
    const ids = Array.from(this.#pending.keys());
    for (const job of this.#pending.values()) job.cancelled = true;
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
      const startedAt = performance.now();
      const apiKey = await this.#apiKeys.resolve(["gemini"]);
      if (!apiKey) {
        throw new VisionProviderFailure("missing-api-key", "Gemini API key is missing.");
      }
      // The saved output can be deleted (or the task retried, which nulls task.output) while the key
      // is fetched or a Gemini call is in flight. Re-validate before each post-await read/write of
      // task.output and bail quietly — the output this result would describe no longer exists.
      if (!task.output) return;
      this.logger?.info("vision started", { mod: "vision", taskId: task.id, mode, model: this.settings.model });

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
          if (!task.output) return;
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
      if (!task.output) return;
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
      this.logger?.info("vision completed", { mod: "vision", taskId: task.id, mode, ms: Math.round(performance.now() - startedAt) });
    } catch (error) {
      task.error = visionError(error);
      task.updatedAt = nowIso();
      this.logger?.error("vision task failed", { mod: "vision", taskId: task.id, mode, err: error });
    }
  }
}

async function prepareVisionInput(stagedPath: string, longEdge: number): Promise<Buffer> {
  return sharp(stagedPath, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize({ width: longEdge, height: longEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

/** Exported for tests — the classification is the interesting part, and a live call is a poor way to reach it. */
export function visionError(error: unknown): TaskError {
  const known = error instanceof Error ? error : new Error(String(error));
  const presentation = classifyVisionFailure(error);
  return {
    stage: "vision",
    message: presentation.message,
    detail: known.stack ?? null,
    occurredAt: nowIso(),
    retryable: presentation.retryable
  };
}

function classifyVisionFailure(error: unknown): { message: string; retryable: boolean } {
  if (error instanceof VisionProviderFailure) {
    switch (error.code) {
      case "missing-api-key":
        return { message: "Gemini API key is missing. Open Settings and save a key, then retry.", retryable: true };
      case "safety-refusal":
        return { message: "Gemini refused this image because of a safety or content policy restriction.", retryable: false };
      case "incomplete-response":
      case "invalid-response":
        return {
          message: "Gemini returned an unexpected response. Retry, or adjust the configured model if the problem persists.",
          retryable: true,
        };
    }
  }
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return { message: "Gemini authentication failed. Check the saved API key in Settings, then retry.", retryable: true };
    }
    if (error.status === 404) {
      return { message: "This Gemini model isn't available. Open Settings and choose one from the list.", retryable: false };
    }
    if (error.status === 429) {
      return { message: "Gemini rate limit reached. Wait a moment, then retry.", retryable: true };
    }
    if (error.status >= 500) {
      return { message: "Gemini is temporarily unavailable. Retry in a moment.", retryable: true };
    }
  }
  return {
    message: "FotoReady could not analyze this image. The current metadata and saved files are unchanged; try again.",
    retryable: true,
  };
}
