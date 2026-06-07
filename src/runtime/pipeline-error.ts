// Structured failure for the image pipeline. The category is the single signal used to
// decide whether re-running the identical pipeline on the identical source can succeed
// without the user changing anything first — so retryability is derived from a real
// field, never from matching the human-readable error text.

export type PipelineErrorCategory =
  | "decode"   // the source image could not be read or parsed (corrupt / unsupported)
  | "process"  // an editing op failed while transforming the image
  | "encode"   // producing the output image bytes failed
  | "io"       // a filesystem / syscall error (disk full, locked file, permissions)
  | "metadata" // writing metadata to the saved file failed
  | "unknown"; // uncategorized

export class PipelineError extends Error {
  readonly category: PipelineErrorCategory;

  constructor(category: PipelineErrorCategory, message: string) {
    super(message);
    this.name = "PipelineError";
    this.category = category;
  }
}

// Node syscall error codes a user can resolve (free disk space, close a lock, fix
// permissions, restore a moved file) and then succeed by retrying. Identified by the
// error's structured `.code`, never by message text. Structural codes that recur
// identically on retry (EEXIST, EXDEV) are deliberately excluded — they are not
// transient and the user must change the output layout, not retry.
const RETRYABLE_IO_CODES = new Set([
  "ENOSPC", "EDQUOT", "EROFS",  // no space / over quota / read-only target
  "EACCES", "EPERM",            // permission denied
  "EBUSY", "ETXTBSY",           // file in use / locked
  "EMFILE", "ENFILE", "EAGAIN", // resource exhaustion (transient)
  "EIO",                        // transient device I/O failure
  "ENOENT"                      // a user-supplied file (source/output) moved or was removed
]);

// Phases whose work is accessing a user-supplied file: reading the source image (decode)
// or writing the output image (io). A retryable Node IO code here is an external condition
// the user can fix and retry. In the process/encode phases an IO code instead means a
// pipeline-referenced asset is missing or misconfigured (e.g. a deleted LUT .cube) — a
// deterministic error retrying won't fix — so the phase category is kept.
const FILE_ACCESS_PHASES = new Set<PipelineErrorCategory>(["decode", "io"]);

export function isRetryableIoError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
  return typeof code === "string" && RETRYABLE_IO_CODES.has(code);
}

// Whether re-running the identical pipeline on the identical source has any chance of
// succeeding without the user changing something first. Decode / process / encode are
// deterministic for a given input, so a failure there will recur; I/O and metadata
// failures are typically external and transient, and unknown stays optimistic.
export function isRetryableCategory(category: PipelineErrorCategory): boolean {
  switch (category) {
    case "io":
    case "metadata":
    case "unknown":
      return true;
    case "decode":
    case "process":
    case "encode":
      return false;
  }
}

// Wrap a raw failure from a pipeline phase into a categorized PipelineError. The phase
// where the failure happened is the primary signal; a structured Node I/O code overrides
// it only in the file-access phases (see FILE_ACCESS_PHASES), because a locked or missing
// source/output file is an I/O problem the user can fix and retry — whereas an I/O code in
// the process/encode phases means a referenced asset is broken, which retrying won't fix.
export function asPipelineError(error: unknown, phase: PipelineErrorCategory): PipelineError {
  if (error instanceof PipelineError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const category: PipelineErrorCategory =
    FILE_ACCESS_PHASES.has(phase) && isRetryableIoError(error) ? "io" : phase;
  const pipelineError = new PipelineError(category, message);
  if (error instanceof Error && error.stack) pipelineError.stack = error.stack;
  return pipelineError;
}
