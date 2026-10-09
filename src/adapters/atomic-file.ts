import fs from "node:fs/promises";
import path from "node:path";

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

/**
 * The one temporary name a target is staged under: `<stem>-<extension>.tmp` beside it (derived-filename
 * grammar), e.g. `config-json.tmp`. It is fixed rather than random (developer decision): each target has
 * one writer at a time (settings, keys and state each serialize their writes, sidecars and outputs go
 * through the output lane, and the single-instance lock excludes a second FotoReady), so a name left
 * by an interrupted write is replaced by the next write instead of accumulating. The extension is the
 * discriminator because an output image and its sidecar share a stem.
 */
export function temporaryPathFor(target: string): string {
  const { dir, name, ext } = path.parse(target);
  return path.join(dir, ext ? `${name}-${ext.slice(1)}.tmp` : `${name}.tmp`);
}

export async function atomicWriteFile(
  filePath: string,
  data: string | Buffer,
  options?: AtomicWriteOptions | BufferEncoding
): Promise<void> {
  const opts: AtomicWriteOptions = typeof options === "string" ? { encoding: options } : options ?? {};
  // The exact bytes that land on disk, held in memory so the after-write hook records what THIS call wrote
  // — never a re-read of the file (which could capture a concurrent writer's content). For a string, the
  // buffer uses the same encoding as the write below.
  const bytes = typeof data === "string" ? Buffer.from(data, opts.encoding ?? "utf8") : data;
  // A write that changes nothing is skipped (content-lifecycle conventions, Files): no replace and no
  // after-write record. An explicit mode still applies to the file as it is.
  if (await skipUnchanged(filePath, bytes, opts)) return;
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = temporaryPathFor(filePath);
  try {
    // A temp left by an interrupted write is removed first, so the exclusive create below always makes
    // a new file with restrictive access instead of inheriting the leftover's.
    await fs.rm(tmpPath, { force: true });
    await fs.writeFile(tmpPath, bytes, { flag: "wx", mode: 0o600 });
    // A replace keeps the file's permissions (content-lifecycle conventions, Files); an explicit mode
    // wins. `writeFile`'s mode is masked by the umask, so it is set explicitly on POSIX either way.
    const mode = opts.mode ?? (await existingMode(filePath)) ?? (0o666 & ~process.umask());
    if (mode !== undefined && process.platform !== "win32") {
      await fs.chmod(tmpPath, mode);
    }
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch((cleanupError) => console.warn("[atomic-write] could not remove temporary file", { filePath: tmpPath, err: cleanupError }));
    throw error;
  }
  // After the rename: the file is exactly where it belongs, so hand the just-written bytes to the caller's
  // after-write hook (only the managed-text choke point supplies one). Recording before the rename would
  // risk a "backup of a save that never happened" (data-backup conventions).
  opts.afterWrite?.(bytes);
}

/** Equality and an explicit access repair belong to the inspected file descriptor. */
async function skipUnchanged(filePath: string, bytes: Buffer, opts: AtomicWriteOptions): Promise<boolean> {
  let file: Awaited<ReturnType<typeof fs.open>>;
  try { file = await fs.open(filePath, "r"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  let failed = false;
  try {
    if (!(await file.readFile()).equals(bytes)) return false;
    if (opts.mode !== undefined && process.platform !== "win32") await file.chmod(opts.mode);
    return true;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try { await file.close(); } catch (error) {
      if (!failed) throw error;
      console.warn("[atomic-write] could not close inspected file", { filePath, err: error });
    }
  }
}

/** The permission bits of the file a write replaces, or undefined when there is none yet. */
async function existingMode(filePath: string): Promise<number | undefined> {
  try {
    return (await fs.stat(filePath)).mode & 0o7777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
