import type { Task, VisionRunMode } from "./types/project";

export function resolveVisionRunMode(task: Pick<Task, "generateDescription" | "generateSlug">, options?: { mode?: VisionRunMode }): VisionRunMode | null {
  if (options?.mode) return options.mode;
  if (task.generateSlug) return "description-and-slug";
  if (task.generateDescription) return "description";
  return null;
}

export function includesDescriptionGeneration(mode: VisionRunMode): boolean {
  return mode === "description" || mode === "description-and-slug";
}

export function includesSlugGeneration(mode: VisionRunMode): boolean {
  return mode === "description-and-slug" || mode === "slug";
}
