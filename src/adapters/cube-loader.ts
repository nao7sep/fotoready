import fs from "node:fs/promises";
import { parseCubeLut, type CubeLut } from "@runtime/lut-cube";

/**
 * Lattice entries kept parsed per process (each pipeline worker has its own cache). A common 33³ LUT
 * is about 36k entries and a 65³ one about 275k, so this holds a picker's worth of small LUTs or a
 * few large ones; the least recently used go first.
 */
const CACHE_BUDGET_ENTRIES = 1_500_000;

type CachedLut = { version: string; lut: CubeLut };

// Least recently used first: a hit moves its entry to the end.
const cache = new Map<string, CachedLut>();

/** Reuses a parsed lattice while its filesystem identity and change timestamps are unchanged. */
export async function loadCubeLut(cubePath: string): Promise<CubeLut> {
  const stats = await fs.stat(cubePath, { bigint: true });
  // Import preserves source mtime; recreated files still have their own identity/change time.
  const version = `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`;
  const cached = cache.get(cubePath);
  cache.delete(cubePath);
  if (cached?.version === version) {
    cache.set(cubePath, cached);
    return cached.lut;
  }

  const lut = parseCubeLut(await fs.readFile(cubePath, "utf8"));
  cache.set(cubePath, { version, lut });
  let total = 0;
  for (const entry of cache.values()) total += entry.lut.data.length;
  for (const [key, entry] of cache) {
    if (total <= CACHE_BUDGET_ENTRIES || key === cubePath) break;
    cache.delete(key);
    total -= entry.lut.data.length;
  }
  return lut;
}
