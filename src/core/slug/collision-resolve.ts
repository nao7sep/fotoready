import { normalizeSlugCandidate } from "./rules";

export type SlugResolutionInput = {
  taskId: string;
  candidates: string[];
  outputHash: string;
};

export function resolveSlugCollisions(items: SlugResolutionInput[], alreadyTaken: string[] = []): Map<string, string> {
  const used = new Set(alreadyTaken.map(normalizeSlugCandidate).filter(Boolean));
  const resolved = new Map<string, string>();
  const collided: SlugResolutionInput[] = [];

  for (const item of items) {
    const candidate = item.candidates.map(normalizeSlugCandidate).find((slug) => slug.length > 0 && !used.has(slug));
    if (candidate) {
      used.add(candidate);
      resolved.set(item.taskId, candidate);
    } else {
      collided.push(item);
    }
  }

  for (const item of collided) {
    const base = normalizeSlugCandidate(item.candidates[0] ?? "untitled-output") || "untitled-output";
    const fallback = `${base}-${item.outputHash.slice(0, 4).toLowerCase()}`;
    used.add(fallback);
    resolved.set(item.taskId, fallback);
  }

  return resolved;
}
