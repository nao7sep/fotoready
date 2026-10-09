import fs from "node:fs/promises";
import path from "node:path";
import { temporaryPathFor } from "@adapters/atomic-file";
import type { Logger } from "@shared/types/log";

export type MoveCleanupFailure = { path: string; kind: "source" | "staging"; error: unknown };

function cannotLink(error: unknown): boolean {
  return ["EXDEV", "EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EINVAL"].includes((error as NodeJS.ErrnoException).code ?? "");
}

/** Output publication follows storage-path and content-lifecycle conventions. */
export async function moveOutputFile(from: string, to: string, logger?: Logger): Promise<MoveCleanupFailure[]> {
  const failures: MoveCleanupFailure[] = [];
  try {
    await fs.link(from, to);
  } catch (error) {
    if (!cannotLink(error)) throw error;
    // The target's one fixed staging folder; one left by an interrupted move is replaced, so the new
    // folder is always created with restrictive access.
    const staging = temporaryPathFor(to);
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { mode: 0o700 });
    const temp = path.join(staging, path.basename(to));
    try {
      const source = await fs.stat(from);
      await fs.copyFile(from, temp, fs.constants.COPYFILE_EXCL);
      if (process.platform !== "win32") await fs.chmod(temp, source.mode & 0o7777);
      await fs.utimes(temp, source.atime, source.mtime);
      try {
        await fs.link(temp, to);
      } catch (publishError) {
        if (!cannotLink(publishError)) throw publishError;
        // Volumes without hard links use an exclusively owned final descriptor.
        const destination = await fs.open(to, "wx", source.mode & 0o7777);
        try {
          const input = await fs.open(temp, "r");
          try {
            const buffer = Buffer.alloc(64 * 1024);
            for (;;) {
              const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
              if (bytesRead === 0) break;
              await destination.writeFile(buffer.subarray(0, bytesRead));
            }
          } finally {
            await input.close().catch((error) => failures.push({ path: temp, kind: "staging", error }));
          }
          if (process.platform !== "win32") await destination.chmod(source.mode & 0o7777);
          await destination.utimes(source.atime, source.mtime);
        } catch (copyError) {
          await destination.close().catch((error) => logger?.warn("could not close unpublished output", { mod: "rename", filePath: to, err: error }));
          await fs.rm(to, { force: true }).catch((error) => logger?.warn("could not remove unpublished output", { mod: "rename", filePath: to, err: error }));
          throw copyError;
        }
        await destination.close().catch((error) => failures.push({ path: to, kind: "staging", error }));
      }
    } catch (copyError) {
      await fs.rm(staging, { recursive: true, force: true }).catch((error) => logger?.warn("could not remove output staging after a failed move", { mod: "rename", staging, err: error }));
      throw copyError;
    }
    try {
      await fs.rm(staging, { recursive: true, force: true });
    } catch (error) {
      failures.push({ path: staging, kind: "staging", error });
    }
  }
  try {
    await fs.rm(from, { force: true });
  } catch (error) {
    failures.push({ path: from, kind: "source", error });
  }
  return failures;
}
