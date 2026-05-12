export function normalizeSlugCandidate(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function isValidSlugCandidate(value: string, minWords = 4, maxWords = 7): boolean {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) return false;
  const words = value.split("-");
  return words.length >= minWords && words.length <= maxWords;
}
