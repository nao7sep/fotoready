import fs from "node:fs/promises";
import { GoogleGenAI } from "@google/genai";
import { atomicWriteFile } from "@adapters/atomic-file";
import { SUPPORTED_MODELS } from "@shared/ai-models";
import { isRecord } from "@shared/validation/common";
import type { AppLogger } from "./logger";

const DAY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;

const isSupported = (id: string): boolean => SUPPORTED_MODELS.some((row) => row.id === id);

export type ModelListRequest = { endpoint: string; force?: boolean; apiKey?: string; useStoredKey?: boolean };
type ModelListFact = { fetchedAtUtc: string; ids: string[] };

export async function fetchGeminiModelIds(endpoint: string, key: string, signal: AbortSignal): Promise<string[]> {
  const ai = new GoogleGenAI({ apiKey: key, httpOptions: { baseUrl: endpoint, retryOptions: { attempts: 1 } } });
  const ids: string[] = [];
  for await (const model of await ai.models.list({ config: { pageSize: 1000, abortSignal: signal } })) {
    if (typeof model.name !== "string") throw new Error("Gemini returned an invalid model entry.");
    const id = model.name.replace(/^models\//, "");
    if (isSupported(id) && model.supportedActions?.includes("generateContent")) ids.push(id);
  }
  return [...new Set(ids)];
}

/** Optional picker facts: opened only by Settings, never by startup or generation. */
export class ModelLists {
  #flight: Promise<string[]> | null = null;
  #lastAttemptAt: number | null = null;

  constructor(
    private readonly filePath: string,
    private readonly resolveKey: () => Promise<string | null>,
    private readonly logger?: Pick<AppLogger, "warn">,
    private readonly fetchIds = fetchGeminiModelIds,
    private readonly now = Date.now
  ) {}

  load(request: ModelListRequest): Promise<string[]> {
    if (this.#flight) return this.#flight;
    this.#flight = this.readAndRefresh(request).finally(() => { this.#flight = null; });
    return this.#flight;
  }

  private async readAndRefresh(request: ModelListRequest): Promise<string[]> {
    let fact: ModelListFact | null = null;
    try {
      const data: unknown = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      const row = isRecord(data) ? data.gemini : null;
      if (!isRecord(row) || typeof row.fetchedAtUtc !== "string" || !Number.isFinite(Date.parse(row.fetchedAtUtc)) || !Array.isArray(row.ids) || !row.ids.every((id) => typeof id === "string")) throw new Error("Invalid cached model-list fact.");
      fact = row as ModelListFact;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.logger?.warn("model list cache could not be read", { mod: "models", err: error });
    }
    const cached = fact?.ids.filter(isSupported) ?? [];
    const lastAttempt = Math.max(fact ? Date.parse(fact.fetchedAtUtc) : -Infinity, this.#lastAttemptAt ?? -Infinity);
    if (!request.force && this.now() - lastAttempt < DAY_MS) return cached;
    try {
      const key = request.apiKey?.trim() || (request.useStoredKey === false ? null : await this.resolveKey());
      if (!key) return cached;
      this.#lastAttemptAt = this.now();
      const ids = (await this.fetchIds(request.endpoint, key, AbortSignal.timeout(FETCH_TIMEOUT_MS)))
        .filter(isSupported);
      const next = { gemini: { fetchedAtUtc: new Date(this.now()).toISOString(), ids: [...new Set(ids)] } };
      // Not recorded: this provider list is re-derivable picker data, not user-authored configuration.
      await atomicWriteFile(this.filePath, `${JSON.stringify(next, null, 2)}\n`);
      return next.gemini.ids;
    } catch (error) {
      this.logger?.warn("model list refresh failed", { mod: "models", err: error });
      return cached;
    }
  }
}
