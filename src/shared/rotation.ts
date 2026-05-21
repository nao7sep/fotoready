/**
 * Wrap a rotation in degrees to the canonical (-180, 180] range without rounding.
 * Use for in-flight values (drag previews, geometry math) where sub-degree precision matters.
 */
export function wrapAngle(value: number): number {
  const normalized = value % 360;
  return normalized > 180 ? normalized - 360 : normalized <= -180 ? normalized + 360 : normalized;
}

/**
 * Wrap and round to the nearest integer degree. Use for stored / committed values so the
 * UI display, +90/-90 button arithmetic, and persisted state stay in agreement.
 */
export function normalizeAngle(value: number): number {
  return wrapAngle(Math.round(value));
}

export function formatAngle(value: number): string {
  return `${value > 0 ? "+" : ""}${Math.round(value)}°`;
}
