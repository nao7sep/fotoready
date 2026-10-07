import fs from "node:fs/promises";
import { FORMAT_VERSIONS, NewerFormatError, parseVersionedJson } from "@shared/format-versions";
import { message, type Message } from "@shared/i18n/translate";

export class OutputSidecarFormatError extends Error {
  readonly reason: Message;

  constructor(filePath: string, cause: unknown, newer: boolean) {
    super("The output sidecar cannot be changed by this FotoReady.", { cause });
    this.name = "OutputSidecarFormatError";
    this.reason = message(newer ? "failure.outputSidecarNewer" : "failure.outputSidecarUnreadable", { path: filePath });
  }
}

/** Missing optional sidecars remain optional (store-recovery-conventions). */
export async function assertOutputSidecarFormat(filePath: string): Promise<void> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new OutputSidecarFormatError(filePath, error, false);
  }
  const read = parseVersionedJson(text, FORMAT_VERSIONS.taskSidecar);
  if (read.kind === "newer") {
    throw new OutputSidecarFormatError(filePath, new NewerFormatError(filePath, read.found, FORMAT_VERSIONS.taskSidecar), true);
  }
  if (read.kind === "invalid") throw new OutputSidecarFormatError(filePath, read.error, false);
}
