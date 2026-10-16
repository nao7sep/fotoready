// How many saves run at once (volume-handling-conventions, Concurrency): one per core, and only as
// many as the machine's memory holds at each photo's cost. The machine's total memory is the
// measure, never the free memory of the moment, which on macOS leaves out what the system releases
// when asked; nothing waits or is refused because memory looks short.

/**
 * The memory a save of a photo this size needs at its peak, in full RGBA copies of the photo. Eight
 * 60 MP saves at once with colour adjustments, a rotation, a text watermark and a stamp measured
 * about 3.8 each (the decode, the shared per-pixel buffer, each geometry or overlay render and the
 * encode), so 4 covers a heavy recipe without holding back ordinary photos.
 */
export function saveCost(width: number, height: number): number {
  return Math.max(1, width * height) * 4 * 4;
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
