import sharp from "sharp";
import PQueue from "p-queue";
import { nowIso } from "@shared/time";
import { MAX_INPUT_PIXELS } from "@runtime/decode";
import type { Project, Task, TaskError, VisionResult } from "@shared/types/project";
import type { VisionRunMode, VisionRunOptions } from "@shared/types/ipc";
import { includesDescriptionGeneration, includesSlugGeneration, resolveVisionRunMode } from "@shared/vision-run-mode";
import type { GlobalSettings } from "@shared/types/settings";
import type { AppPaths } from "@main/paths";
import type { AppLogger } from "@main/logger";
import type { RecordsStore } from "@main/records-store";
import { ApiKeyStore } from "@adapters/api-keys";
import { GeminiVisionProvider, VisionProviderFailure, type GeminiCall } from "@adapters/gemini";
import { ApiError } from "@google/genai";
import { message, type Message } from "@shared/i18n/translate";
import { isRecord } from "@shared/validation/common";

/** What a vision request was computed from: the saved output it describes and the slug the user had. */
type VisionBasis = { outputKey: string; customSlug: string | null };

/**
 * One scheduled vision run. Until it starts, a newer request for the same task updates it in place
 * (mode, basis, cancel flag) instead of scheduling a second run.
 */
type VisionJob = { mode: VisionRunMode; basis: VisionBasis; cancelled: boolean; done: Promise<void> };

/** The provider calls a vision run makes. Injectable so scheduling and commit rules are testable without Gemini. */
export type VisionProvider = Pick<GeminiVisionProvider, "describeImage" | "suggestSlugs">;

export type VisionQueueDeps = {
  createProvider(apiKey: string, endpoint: string, recordCall: (call: GeminiCall) => void): VisionProvider;
  prepareInput(stagedPath: string, longEdge: number): Promise<{ bytes: Buffer; width: number; height: number }>;
};

/**
 * Applies a vision result to its task and persists it. `apply` re-checks that the result is still
 * current and returns false to decline; the commit then changes nothing and resolves false.
 */
export type VisionCommit = (task: Task, apply: () => boolean) => Promise<boolean>;

const defaultDeps: VisionQueueDeps = {
  createProvider: (apiKey, endpoint, recordCall) => new GeminiVisionProvider(apiKey, endpoint, recordCall),
  prepareInput: prepareVisionInput
};

/**
 * Runs paid vision calls through a bounded queue, at most one run per task at a time.
 *
 * The queue owns `task.visionRunning` and `task.visionRunMode`: they turn on when a run is scheduled
 * and off only when the task's last run settles. A run commits a result only while the saved output it
 * was requested for is still the task's output, and replaces the custom slug only if the user left it
 * as it was when the run was requested.
 */
export class VisionQueue {
  #apiKeys: ApiKeyStore;
  #queue: PQueue;
  #currentConcurrency: number;
  #deps: VisionQueueDeps;
  // Scheduled runs that have not started. Cancellation is bound to the specific job, so a fresh request
  // for a task whose job is still pending revives it rather than being swallowed and then skipped.
  #pending = new Map<string, VisionJob>();
  // The settle promise of each task's latest run; a new run for the task starts only after it.
  #tails = new Map<string, Promise<void>>();
  // Runs per task that have not settled (at most one running plus one pending).
  #outstanding = new Map<string, number>();
  #closing = false;

  constructor(
    paths: AppPaths,
    private readonly settings: GlobalSettings,
    private readonly logger?: AppLogger,
    private readonly records?: Pick<RecordsStore, "writeProviderCall">,
    deps: VisionQueueDeps = defaultDeps
  ) {
    this.#apiKeys = new ApiKeyStore(paths.apiKeysPath, logger);
    this.#currentConcurrency = Math.max(1, settings.visionConcurrency);
    this.#queue = new PQueue({ concurrency: this.#currentConcurrency });
    this.#deps = deps;
  }

  async setGeminiApiKey(value: string): Promise<void> {
    await this.#apiKeys.set("gemini", value);
  }

  async hasGeminiApiKey(): Promise<boolean> {
    return this.#apiKeys.has("gemini");
  }

  async clearGeminiApiKey(): Promise<void> {
    await this.#apiKeys.clear("gemini");
  }

  /**
   * Schedules a vision run and resolves when it settles. The task's running flags are set before the
   * first await, so a caller may publish them right after calling.
   */
  runForTask(project: Project, taskId: string, options: VisionRunOptions | undefined, commit: VisionCommit): Promise<void> {
    if (this.#closing) return Promise.resolve();
    const task = project.tasks.find((item) => item.id === taskId);
    if (!task) return Promise.reject(new Error(`Task not found: ${taskId}`));
    if (!task.output) return Promise.reject(new Error("Task must be saved before vision can run."));
    const mode = resolveVisionRunMode(task, options);
    if (!mode) return Promise.resolve();

    const basis: VisionBasis = { outputKey: outputKey(task.output), customSlug: task.customSlug };
    if (task.error?.stage === "vision") task.error = null;
    task.visionRunning = true;
    task.visionRunMode = mode;

    const existing = this.#pending.get(taskId);
    if (existing) {
      // The newest request supersedes the one still waiting, including a prior cancel of it.
      existing.mode = mode;
      existing.basis = basis;
      existing.cancelled = false;
      return existing.done;
    }

    const job: VisionJob = { mode, basis, cancelled: false, done: Promise.resolve() };
    this.#pending.set(taskId, job);
    this.#outstanding.set(taskId, (this.#outstanding.get(taskId) ?? 0) + 1);
    this.#syncConcurrency();
    const previous = this.#tails.get(taskId) ?? Promise.resolve();
    job.done = previous
      .then(() => this.#queue.add(async () => {
        this.#pending.delete(taskId);
        if (job.cancelled) return;
        task.visionRunMode = job.mode;
        await this.#run(task, job, commit);
      }))
      .finally(() => this.#settle(task));
    this.#tails.set(taskId, job.done);
    return job.done;
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

  /** Cancellation only skips pending jobs; active native reads remain owned until they settle. */
  async shutdown(): Promise<void> {
    this.#closing = true;
    this.cancelAll();
    await Promise.allSettled([...this.#tails.values()]);
  }

  #settle(task: Task): void {
    const remaining = (this.#outstanding.get(task.id) ?? 1) - 1;
    if (remaining > 0) {
      this.#outstanding.set(task.id, remaining);
      task.visionRunMode = this.#pending.get(task.id)?.mode ?? task.visionRunMode;
    } else {
      this.#outstanding.delete(task.id);
      this.#tails.delete(task.id);
      task.visionRunning = false;
      task.visionRunMode = null;
    }
  }

  #syncConcurrency(): void {
    const desired = Math.max(1, this.settings.visionConcurrency);
    if (desired !== this.#currentConcurrency) {
      this.#queue.concurrency = desired;
      this.#currentConcurrency = desired;
    }
  }

  async #run(task: Task, job: VisionJob, commit: VisionCommit): Promise<void> {
    const { mode, basis } = job;
    const settings = structuredClone(this.settings);
    // The saved output can be deleted, re-saved or renamed while the key is fetched or a Gemini call is
    // in flight. A result belongs only to the output it was requested for.
    const isCurrent = (): boolean => task.output !== null && outputKey(task.output) === basis.outputKey;
    // The step a retry resumes from: once the description is committed, only the slug remains.
    let remaining: VisionRunMode = mode;
    try {
      if (!isCurrent()) return;
      const startedAt = performance.now();
      const apiKey = await this.#apiKeys.resolve("gemini");
      if (!apiKey) {
        throw new VisionProviderFailure("missing-api-key", "Gemini API key is missing.");
      }
      if (!task.output || !isCurrent()) return;
      this.logger?.info("vision started", { mod: "vision", taskId: task.id, mode, descriptionModel: settings["gemini.description"], slugModel: settings["gemini.slug"] });

      const callOptions = {
        timeoutMs: settings.visionTimeoutMs,
        maxRetries: settings.visionMaxRetries,
        initialBackoffMs: settings.visionInitialBackoffMs
      };
      const provider = this.#deps.createProvider(apiKey, settings["gemini.endpoint"], (call) =>
        this.records?.writeProviderCall({ ...call, taskId: task.id, provider: "gemini" }));
      // Each step records its own result, model and finish time; a step this run skips keeps the last one's.
      let described: Pick<VisionResult, "description" | "model" | "ranAt"> | null = null;
      if (includesDescriptionGeneration(mode)) {
        const sourcePath = task.output.finalPath ?? task.output.stagedPath;
        const input = await this.#deps.prepareInput(sourcePath, settings.preResizeLongEdge);
        const description = await provider.describeImage(
          { imageBytes: input.bytes, mimeType: "image/jpeg", width: input.width, height: input.height, sourcePath },
          {
            model: settings["gemini.description"],
            thinking: settings["gemini.thinking.description"],
            mediaResolution: settings["gemini.mediaResolution.description"],
            descriptionPrompt: settings.visionDescriptionPrompt,
            ...callOptions
          }
        );
        described = { description, model: settings["gemini.description"], ranAt: nowIso() };
        if (includesSlugGeneration(mode)) {
          const descriptionOnly = described;
          const committed = await commit(task, () => {
            if (!task.output || !isCurrent()) return false;
            task.output.vision = { ...descriptionOnly, slugCandidates: [] };
            task.error = null;
            task.updatedAt = descriptionOnly.ranAt;
            return true;
          });
          if (!committed) return;
          remaining = "slug";
        }
      }
      const description = described?.description ?? task.output.vision?.description ?? "";
      let slugged: Pick<VisionResult, "slugCandidates" | "slugModel" | "slugRanAt"> | null = null;
      if (includesSlugGeneration(mode)) {
        if (!described && !description.trim()) throw new Error("Generate description first, then regenerate the slug.");
        const slugCandidates = await provider.suggestSlugs(description, {
          model: settings["gemini.slug"],
          thinking: settings["gemini.thinking.slug"],
          slugPrompt: settings.visionSlugPrompt,
          ...callOptions
        });
        slugged = { slugCandidates, slugModel: settings["gemini.slug"], slugRanAt: nowIso() };
      }
      const committed = await commit(task, () => {
        if (!task.output || !isCurrent()) return false;
        const previous = task.output.vision;
        const descriptionStep = described ?? previous;
        if (!descriptionStep) return false;
        task.output.vision = { slugCandidates: [], ...previous, ...descriptionStep, ...slugged };
        // A slug the user typed while the run was in flight is theirs; only an untouched one is replaced.
        const generatedSlug = slugged?.slugCandidates[0];
        if (generatedSlug && task.customSlug === basis.customSlug) {
          task.customSlug = generatedSlug;
        }
        task.error = null;
        task.updatedAt = slugged?.slugRanAt ?? descriptionStep.ranAt;
        return true;
      });
      if (!committed) return;
      this.logger?.info("vision completed", { mod: "vision", taskId: task.id, mode, ms: Math.round(performance.now() - startedAt) });
    } catch (error) {
      if (!isCurrent()) {
        this.logger?.warn("vision failed for an output that is no longer current", { mod: "vision", taskId: task.id, mode, err: error });
        return;
      }
      task.error = visionError(error, remaining);
      this.logger?.error("vision task failed", { mod: "vision", taskId: task.id, mode, err: error });
    }
  }
}

/** Identifies one saved output; a re-save produces a new key even when it lands at the same path. */
function outputKey(output: NonNullable<Task["output"]>): string {
  return `${output.stagedAt}:${output.outputHash}`;
}

async function prepareVisionInput(stagedPath: string, longEdge: number): Promise<{ bytes: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(stagedPath, { limitInputPixels: MAX_INPUT_PIXELS })
    .resize({ width: longEdge, height: longEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  return { bytes: data, width: info.width, height: info.height };
}

/**
 * Exported for tests — the classification is the interesting part, and a live call is a poor way to reach it.
 * `retryMode` is the step a Retry resumes from, so a failed slug step never pays for the description again.
 */
export function visionError(error: unknown, retryMode: VisionRunMode): TaskError {
  const known = error instanceof Error ? error : new Error(String(error));
  const presentation = classifyVisionFailure(error);
  return {
    stage: "vision",
    message: presentation.message,
    detail: known.stack ?? null,
    occurredAt: nowIso(),
    retryable: presentation.retryable,
    retryMode
  };
}

function classifyVisionFailure(error: unknown): { message: Message; retryable: boolean } {
  if (error instanceof VisionProviderFailure) {
    switch (error.code) {
      case "missing-api-key":
        return { message: message("visionError.missingApiKey"), retryable: true };
      case "safety-refusal":
        return { message: message("visionError.safetyRefusal"), retryable: false };
      case "incomplete-response":
      case "invalid-response":
        return { message: message("visionError.unexpectedResponse"), retryable: true };
    }
  }
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return { message: message("visionError.authentication"), retryable: true };
    }
    if (error.status === 429) {
      return { message: message("visionError.rateLimit"), retryable: true };
    }
    if (error.status >= 500) {
      return { message: message("visionError.serviceUnavailable"), retryable: true };
    }
    if (error.status === 400 || error.status === 404) {
      // The provider answers an unknown model id with 400 or 404; its own message says why.
      const reason = providerMessage(error);
      if (reason) return { message: message("visionError.providerReason", { reason }), retryable: false };
      if (error.status === 404) return { message: message("visionError.modelUnavailable"), retryable: false };
      return { message: message("visionError.generic"), retryable: false };
    }
  }
  return { message: message("visionError.generic"), retryable: true };
}

/**
 * The provider's own `error.message` from the JSON body the SDK puts in `ApiError.message`.
 * Accepted only beside a Google canonical status name, so raw response text the SDK wraps
 * from a non-JSON body (status set to the HTTP reason phrase) is never shown.
 */
function providerMessage(error: ApiError): string | null {
  let body: unknown;
  try { body = JSON.parse(error.message); }
  catch { return null; }
  const detail = isRecord(body) && isRecord(body.error) ? body.error : null;
  if (!detail || typeof detail.status !== "string" || !/^[A-Z_]+$/.test(detail.status)) return null;
  return typeof detail.message === "string" && detail.message.trim() ? detail.message.trim() : null;
}
