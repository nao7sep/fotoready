import fs from "node:fs/promises";
import type { AppPaths } from "@main/paths";
import { loadJsonCache, saveJsonCache, type JsonObjectCache } from "@main/persistence/cache-io";
import { detectJpegQuality, type SourceJpegFacts } from "@runtime/jpeg-quality/detect";
import type { Original } from "@shared/types/project";

export class QualityQueue {
  #cache: JsonObjectCache<SourceJpegFacts> | null = null;

  constructor(private readonly paths: AppPaths) {}

  async enqueueOriginal(original: Original): Promise<void> {
    if (original.format !== "jpeg") return;

    const cache = await this.cache();
    if (cache[original.sourceHash]) return;

    const bytes = await fs.readFile(original.sourcePath);
    cache[original.sourceHash] = detectJpegQuality(bytes);
    await saveJsonCache(this.paths.sourceFactsPath, cache);
  }

  private async cache(): Promise<JsonObjectCache<SourceJpegFacts>> {
    this.#cache ??= await loadJsonCache<SourceJpegFacts>(this.paths.sourceFactsPath);
    return this.#cache;
  }
}
