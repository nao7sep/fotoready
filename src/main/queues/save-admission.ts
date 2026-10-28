import { maximumPipelinePixels } from "@shared/pipeline-geometry";
import type { OpInstance } from "@shared/types/op";

// How many saves run at once (volume-handling-conventions, Concurrency): one per core, and only as
// many as the machine's memory holds at each photo's cost. The machine's total memory is the
// measure, never the free memory of the moment, which on macOS leaves out what the system releases
// when asked; nothing waits or is refused because memory looks short.

/**
 * Eight RGBA frames at the largest recipe stage. Native image work measured about 31 bytes per
 * pixel for a 12 MP rotate/text recipe and 25 for a small source enlarged to 24 MP, which the
 * former four-frame estimate missed.
 * This is admission sizing, not a hard allocation limit or refusal of larger photos.
 */
export function saveCost(width: number, height: number, ops: readonly OpInstance[] = []): number {
  return Math.max(1, maximumPipelinePixels({ width, height }, ops)) * 4 * 8;
}

/**
 * Whether one more save may start beside the running ones: a core is free and their costs together
 * stay within half of total memory, the rest left for the system, the app and its previews. The first
 * save always starts, so a photo larger than that share is still attempted.
 */
export function canStartSave(runningCosts: readonly number[], nextCost: number, cores: number, totalMemory: number): boolean {
  if (runningCosts.length === 0) return true;
  if (runningCosts.length >= Math.max(1, cores)) return false;
  const running = runningCosts.reduce((sum, cost) => sum + cost, 0);
  return running + nextCost <= totalMemory / 2;
}
