import sharp from "sharp";
import { nowIso } from "@shared/time";
import type { Project, TaskError, VisionResult } from "@shared/types/project";
import type { GlobalSettings } from "@shared/types/settings";
import type { AppPaths } from "@main/paths";
import { loadJsonCache, saveJsonCache, type JsonObjectCache } from "@main/persistence/cache-io";
import { sha256Bytes } from "@runtime/hash";
import { ApiKeyStore } from "@adapters/secure-store/api-keys";
import { GeminiVisionProvider } from "@adapters/vision/gemini";

type VisionCacheItem = VisionResult;

export class VisionQueue {
  #cache: JsonObjectCache<VisionCacheItem> | null = null;
  #apiKeys: ApiKeyStore;

  constructor(
    private readonly paths: AppPaths,
    private readonly settings: GlobalSettings
  ) {
    this.#apiKeys = new ApiKeyStore(paths.apiKeysPath);
  }

  async setGeminiApiKey(value: string): Promise<void> {
    await this.#apiKeys.set("gemini", value);
  }

  async runForTask(project: Project, taskId: string): Promise<void> {
    const task = project.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (!task.output) throw new Error("Task must be saved before vision can run.");

    try {
      const input = await prepareVisionInput(task.output.stagedPath, this.settings.preResizeLongEdge);
      const cache = await this.cache();
      const cached = cache[input.sha256];
      if (cached) {
        task.output.vision = cached;
        task.error = null;
        task.updatedAt = nowIso();
        return;
      }

      const apiKey = await this.#apiKeys.get("gemini");
      if (!apiKey) {
        throw new Error("Gemini API key is not configured.");
      }

      const provider = new GeminiVisionProvider(apiKey);
      const described = await provider.describe(
        { imageBytes: input.bytes, mimeType: "image/jpeg" },
        {
          model: this.settings.model,
          projectContext: project.settings.projectContext ?? null,
          customPromptAddendum: this.settings.customPromptAddendum || null
        }
      );
      const vision: VisionResult = {
        description: described.description,
        slugCandidates: described.slugCandidates,
        model: this.settings.model,
        ranAt: nowIso()
      };

      if (this.settings.cacheResults) {
        cache[input.sha256] = vision;
        await saveJsonCache(this.paths.visionFactsPath, cache);
      }

      task.output.vision = vision;
      task.error = null;
      task.updatedAt = nowIso();
    } catch (error) {
      task.error = visionError(error);
      task.updatedAt = nowIso();
    }
  }

  private async cache(): Promise<JsonObjectCache<VisionCacheItem>> {
    this.#cache ??= await loadJsonCache<VisionCacheItem>(this.paths.visionFactsPath);
    return this.#cache;
  }
}

async function prepareVisionInput(stagedPath: string, longEdge: number): Promise<{ bytes: Buffer; sha256: string }> {
  const bytes = await sharp(stagedPath, { limitInputPixels: false })
    .resize({ width: longEdge, height: longEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  return {
    bytes,
    sha256: sha256Bytes(bytes)
  };
}

function visionError(error: unknown): TaskError {
  const known = error instanceof Error ? error : new Error(String(error));
  return {
    stage: "vision",
    message: known.message,
    detail: known.stack ?? null,
    occurredAt: nowIso(),
    retryable: /429|rate|timeout|network|5\d\d/i.test(known.message)
  };
}
