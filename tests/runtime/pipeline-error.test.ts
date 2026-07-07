import { describe, expect, it } from "vitest";
import {
  PipelineError,
  asPipelineError,
  isRetryableCategory,
  isRetryableIoError,
  type PipelineErrorCategory
} from "@runtime/pipeline-error";

function ioError(code: string): NodeJS.ErrnoException {
  const error = new Error(`syscall failed: ${code}`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

describe("PipelineError", () => {
  it("is an Error subclass carrying its category", () => {
    const error = new PipelineError("decode", "bad source");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(PipelineError);
    expect(error.category).toBe("decode");
    expect(error.message).toBe("bad source");
    expect(error.name).toBe("PipelineError");
  });
});

describe("isRetryableCategory", () => {
  it("treats external/transient and unknown failures as retryable", () => {
    expect(isRetryableCategory("io")).toBe(true);
    expect(isRetryableCategory("metadata")).toBe(true);
    expect(isRetryableCategory("unknown")).toBe(true);
  });

  it("treats deterministic pipeline failures as not retryable", () => {
    expect(isRetryableCategory("decode")).toBe(false);
    expect(isRetryableCategory("process")).toBe(false);
    expect(isRetryableCategory("encode")).toBe(false);
  });

  it("covers every category", () => {
    const categories: PipelineErrorCategory[] = ["decode", "process", "encode", "io", "metadata", "unknown"];
    for (const category of categories) {
      expect(typeof isRetryableCategory(category)).toBe("boolean");
    }
  });
});

describe("isRetryableIoError", () => {
  it("recognizes user-resolvable syscall codes by their structured .code", () => {
    for (const code of ["ENOSPC", "EDQUOT", "EROFS", "EACCES", "EPERM", "EBUSY", "ETXTBSY", "EMFILE", "ENFILE", "EAGAIN", "EIO", "ENOENT"]) {
      expect(isRetryableIoError(ioError(code))).toBe(true);
    }
  });

  it("does not treat structural (non-transient) codes as retryable", () => {
    // EEXIST / EXDEV recur identically on retry — the user must change the output layout.
    for (const code of ["EEXIST", "EXDEV"]) {
      expect(isRetryableIoError(ioError(code))).toBe(false);
    }
  });

  it("does not match unrelated codes or message text", () => {
    expect(isRetryableIoError(ioError("ESOMETHINGELSE"))).toBe(false);
    // A non-IO error whose message merely mentions a code must not be classified as IO.
    expect(isRetryableIoError(new Error("encode failed: ENOSPC mentioned in text"))).toBe(false);
  });

  it("is safe for non-error values", () => {
    expect(isRetryableIoError(null)).toBe(false);
    expect(isRetryableIoError(undefined)).toBe(false);
    expect(isRetryableIoError("ENOSPC")).toBe(false);
    expect(isRetryableIoError({})).toBe(false);
    expect(isRetryableIoError({ code: 42 })).toBe(false);
  });
});

describe("asPipelineError", () => {
  it("returns an existing PipelineError unchanged", () => {
    const original = new PipelineError("encode", "already categorized");
    expect(asPipelineError(original, "decode")).toBe(original);
  });

  it("tags a plain error with the phase it failed in and preserves message + stack", () => {
    const raw = new Error("op blew up");
    const wrapped = asPipelineError(raw, "process");
    expect(wrapped).toBeInstanceOf(PipelineError);
    expect(wrapped.category).toBe("process");
    expect(wrapped.message).toBe("op blew up");
    expect(wrapped.stack).toBe(raw.stack);
  });

  it("overrides to io for a retryable syscall code in a file-access phase (source read / output write)", () => {
    // A locked/missing source during decode, or a disk-full during the output write, is an
    // I/O problem the user can fix and retry — so the structured code wins over the phase.
    expect(asPipelineError(ioError("EBUSY"), "decode").category).toBe("io");
    expect(asPipelineError(ioError("ENOSPC"), "io").category).toBe("io");
  });

  it("keeps the phase for an IO code in process/encode (a broken pipeline asset is deterministic)", () => {
    // e.g. a deleted LUT .cube read by an op throws ENOENT in the "process" phase; retrying
    // the identical pipeline fails identically, so it must NOT be reclassified as retryable io.
    expect(asPipelineError(ioError("ENOENT"), "process").category).toBe("process");
    expect(asPipelineError(ioError("EBUSY"), "encode").category).toBe("encode");
  });

  it("keeps the phase when the syscall code is not retryable", () => {
    expect(asPipelineError(ioError("ESOMETHINGELSE"), "decode").category).toBe("decode");
  });

  it("stringifies non-error throwables", () => {
    const wrapped = asPipelineError("plain string failure", "encode");
    expect(wrapped.category).toBe("encode");
    expect(wrapped.message).toBe("plain string failure");
  });
});
