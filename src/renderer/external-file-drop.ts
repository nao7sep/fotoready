type PathForFile = (file: File) => string;
type Schedule = (callback: () => void, delayMs: number) => number;
type CancelSchedule = (handle: number) => void;
export type ImportFileDragOffer = "rejected" | "delivery-only";

export const DROP_HIGHLIGHT_LEASE_MS = 1_200;

function isEditableTarget(target: EventTarget | null): boolean {
  return Boolean((target as Element | null)?.closest?.(
    "textarea, [contenteditable='true'], input:not([type]), input[type='text'], input[type='search'], input[type='url'], input[type='email'], input[type='number'], input[type='password'], input[type='tel']",
  ));
}

/** Refuse every external drop that did not reach an owned product target. The
 * app-shell handlers prevent and stop supported file offers first; native
 * non-file text/link editing remains available. */
export function denyUnhandledExternalDrop(event: DragEvent): void {
  if (event.defaultPrevented) return;
  const hasFiles = Array.from(event.dataTransfer?.types ?? []).includes("Files") ||
    Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === "file");
  if (!hasFiles && isEditableTarget(event.target)) return;
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
