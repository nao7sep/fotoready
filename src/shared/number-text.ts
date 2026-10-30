// Reading what the user typed into a number field. The text is read as it stands: nothing here
// rewrites it, and a text these readers refuse is an error the field shows, not a value to correct.

/** A whole number from `min` to `max`, or null. Spaces around the digits are allowed. */
export function readWholeNumber(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

/** A number above 0, decimals included ("1.5", ".5", "2."), or null. */
export function readPositiveNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
}
