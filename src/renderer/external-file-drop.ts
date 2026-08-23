import { IMPORT_FILE_EXTENSIONS } from "@shared/constants";

type PathForFile = (file: File) => string;
type Schedule = (callback: () => void, delayMs: number) => number;
type CancelSchedule = (handle: number) => void;
export type ImportFileDragOffer = "rejected" | "delivery-only" | "accepted";

const allowedExtensions = new Set(IMPORT_FILE_EXTENSIONS.map((extension) => `.${extension}`));

export const DROP_HIGHLIGHT_LEASE_MS = 1_200;

/**
 * Resolves only files that Electron can prove came from the local filesystem and whose extension
 * the import boundary supports. Browser-created Files and remote URL/image drags resolve to no path.
 */
export function localImportPaths(files: Iterable<File> | ArrayLike<File>, pathForFile: PathForFile): string[] {
  const paths = new Set<string>();
  for (const file of Array.from(files)) {
    try {
      const filePath = pathForFile(file);
      if (filePath && allowedExtensions.has(extensionOf(filePath))) paths.add(filePath);
    } catch {
      // A synthetic or inaccessible File has no local provenance and is not an import candidate.
    }
  }
  return [...paths];
}

/**
 * Separates mechanical drop delivery from the accepted affordance. Chromium may protect all item
 * details during a Finder drag, but `preventDefault` is still required before it will deliver drop.
 * Local provenance remains the final authority in localImportPaths.
 */
export function inspectImportFileDragOffer(dataTransfer: DataTransfer | null): ImportFileDragOffer {
  if (!hasFileDragType(dataTransfer)) return "rejected";
  const items = Array.from(dataTransfer.items);
  if (items.length === 0) return "delivery-only";

  let protectedFile = false;
  let sawFileItem = false;
  for (const item of items) {
    if (item.kind !== "file") continue;
    sawFileItem = true;
    try {
      const file = item.getAsFile();
      if (!file) {
        protectedFile = true;
      } else if (allowedExtensions.has(extensionOf(file.name))) {
        return "accepted";
      }
    } catch {
      protectedFile = true;
    }
  }
  if (sawFileItem && protectedFile) return "delivery-only";
  return "rejected";
}

export function hasFileDragType(dataTransfer: DataTransfer | null): dataTransfer is DataTransfer {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes("Files"));
}

function extensionOf(filePath: string): string {
  const separator = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const dot = filePath.lastIndexOf(".");
  return dot > separator ? filePath.slice(dot).toLowerCase() : "";
}

/**
 * Renderer highlight state backed by a renewable lease. External OS drags are not guaranteed to
 * deliver drop, leave, or dragend when cancelled; the missing refresh expires independently.
 */
export class DropHighlightLease {
  private active = false;
  private handle: number | null = null;

  public constructor(
    private readonly onActiveChange: (active: boolean) => void,
    private readonly schedule: Schedule,
    private readonly cancelSchedule: CancelSchedule,
    private readonly leaseMs = DROP_HIGHLIGHT_LEASE_MS
  ) {}

  public renew(): void {
    if (!this.active) {
      this.active = true;
      this.onActiveChange(true);
    }
    if (this.handle !== null) this.cancelSchedule(this.handle);
    this.handle = this.schedule(() => this.clear(), this.leaseMs);
  }

  public clear(): void {
    this.cancelTimer();
    if (this.active) {
      this.active = false;
      this.onActiveChange(false);
    }
  }

  /** Cancels the lease without publishing state during React unmount. */
  public dispose(): void {
    this.cancelTimer();
    this.active = false;
  }

  private cancelTimer(): void {
    if (this.handle !== null) {
      this.cancelSchedule(this.handle);
      this.handle = null;
    }
  }
}
