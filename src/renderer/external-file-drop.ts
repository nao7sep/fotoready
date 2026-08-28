import { isTextEditingTarget } from "./utils/editing-target";

type PathForFile = (file: File) => string;
export type ImportFileDragOffer = "rejected" | "delivery-only";

/** Refuse every external drop that did not reach an owned product target. The
 * app-shell handlers prevent and stop supported file offers first; native
 * non-file text/link editing remains available. */
export function denyUnhandledExternalDrop(event: DragEvent): void {
  if (event.defaultPrevented) return;
  const hasFiles = Array.from(event.dataTransfer?.types ?? []).includes("Files") ||
    Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === "file");
  if (!hasFiles && isTextEditingTarget(event.target)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
}

/**
 * Resolves only files that Electron can prove came from the local filesystem. Product admission
 * remains in the main process, shared by the picker and drop paths.
 */
export function localDropFiles(
  files: Iterable<File> | ArrayLike<File>,
  pathForFile: PathForFile
): { paths: string[]; inaccessibleNames: string[] } {
  const paths = new Set<string>();
  const inaccessibleNames: string[] = [];
  for (const file of Array.from(files)) {
    try {
      const filePath = pathForFile(file);
      if (filePath) paths.add(filePath);
      else inaccessibleNames.push(file.name || "Dropped file");
    } catch {
      inaccessibleNames.push(file.name || "Dropped file");
    }
  }
  return { paths: [...paths], inaccessibleNames };
}

/**
 * Separates mechanical drop delivery from the accepted affordance. Chromium may protect all item
 * details during a Finder drag, but `preventDefault` is still required before it will deliver drop.
 * Local provenance remains the final authority in localImportPaths.
 */
export function inspectImportFileDragOffer(dataTransfer: DataTransfer | null): ImportFileDragOffer {
  if (!hasFileDragType(dataTransfer)) return "rejected";
  const items = Array.from(dataTransfer.items);
  if (items.length > 0 && !items.some((item) => item.kind === "file")) return "rejected";
  return "delivery-only";
}

export function hasFileDragType(dataTransfer: DataTransfer | null): dataTransfer is DataTransfer {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes("Files"));
}
