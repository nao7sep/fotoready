import fs from "node:fs/promises";
import path from "node:path";

export type JsonObjectCache<T> = Record<string, T>;

export async function loadJsonCache<T>(cachePath: string): Promise<JsonObjectCache<T>> {
  try {
    return JSON.parse(await fs.readFile(cachePath, "utf8")) as JsonObjectCache<T>;
  } catch {
    return {};
  }
}

export async function saveJsonCache<T>(cachePath: string, cache: JsonObjectCache<T>): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}
