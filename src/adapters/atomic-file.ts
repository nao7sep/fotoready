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
  /**
   * Called with the exact bytes just written, strictly AFTER the rename lands and only when the write
   * succeeded. This is the seam the managed-text choke point (`@main/write-managed-file`) uses to hand the
   * on-disk bytes to the data-backup layer without this low-level, layer-neutral writer having to know
   * about the store. It is invoked only on the success path — never after a failed write — and any throw
   * from it propagates like any other post-rename error (the managed-text hook is itself best-effort, so it
   * never throws). Left undefined by every non-recorded caller (secrets, output sidecars, binaries).
   */
  afterWrite?: (bytes: Buffer) => void;
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
  // The exact bytes that land on disk, held in memory so the after-write hook records what THIS call wrote
  // — never a re-read of the file (which could capture a concurrent writer's content). For a string, the
  // buffer uses the same encoding as the write below.
  const bytes = typeof data === "string" ? Buffer.from(data, opts.encoding ?? "utf8") : data;
  try {
    const writeOptions = opts.mode !== undefined ? { mode: opts.mode } : undefined;
    await fs.writeFile(tmpPath, bytes, writeOptions);
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
  // After the rename: the file is exactly where it belongs, so hand the just-written bytes to the caller's
  // after-write hook (only the managed-text choke point supplies one). Recording before the rename would
  // risk a "backup of a save that never happened" (data-backup conventions).
  opts.afterWrite?.(bytes);
}
