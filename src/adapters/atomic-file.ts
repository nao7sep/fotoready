import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";

export type AtomicWriteOptions = {
  encoding?: BufferEncoding;
  /**
   * POSIX file mode for the written file (e.g. 0o600 for a secrets file). The
   * mode is applied to the temp file before the rename so the target never
   * exists, even briefly, with broader permissions. Ignored on Windows, which
   * uses a different permission model.
   */
  mode?: number;
};

export async function atomicWriteFile(
  filePath: string,
  data: string | Buffer,
  options?: AtomicWriteOptions | BufferEncoding
): Promise<void> {
  const opts: AtomicWriteOptions = typeof options === "string" ? { encoding: options } : options ?? {};
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  // <stem>-<nanoid>.tmp, alongside the target (derived-filename grammar): one final extension stating
  // the temp file's current role, never a dot-appended suffix on the full target filename.
  const tmpPath = path.join(dir, `${path.parse(filePath).name}-${nanoid(8)}.tmp`);
  try {
    const writeOptions = opts.mode !== undefined ? { mode: opts.mode } : undefined;
    if (typeof data === "string") {
      await fs.writeFile(tmpPath, data, { encoding: opts.encoding ?? "utf8", ...writeOptions });
    } else {
      await fs.writeFile(tmpPath, data, writeOptions);
    }
    // `writeFile`'s mode is masked by the umask, so set it explicitly on POSIX
    // to guarantee a 0600 secrets file regardless of the inherited umask.
    if (opts.mode !== undefined && process.platform !== "win32") {
      await fs.chmod(tmpPath, opts.mode);
    }
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true });
    throw error;
  }
}
