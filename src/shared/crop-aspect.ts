import { readPositiveNumber } from "./number-text";

/** The custom crop ratio `width:height`, each part any number above 0, as written in a crop's aspect lock. */
export function customAspectLock(width: string, height: string): string {
  return `${width.trim()}:${height.trim()}`;
}

/** The ratio a `width:height` aspect lock names, or null when it is not one. */
export function customAspectRatio(lock: string): number | null {
  const parts = lock.split(":");
  if (parts.length !== 2) return null;
  const width = readPositiveNumber(parts[0]!);
  const height = readPositiveNumber(parts[1]!);
  return width === null || height === null ? null : width / height;
}
