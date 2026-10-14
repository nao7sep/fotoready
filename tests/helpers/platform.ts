/**
 * Runs `fn` as if on `platform`, for decisions that read `process.platform` when called, so each
 * platform's branch runs on any host. Only the reported platform changes: the file system and any
 * native call stay the host's.
 */
export async function asPlatform<T>(platform: NodeJS.Platform, fn: () => T | Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...descriptor, value: platform });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
}

/** The prototype of Node's `FileHandle`, which is not exported, so tests can watch its methods. */
export async function fileHandlePrototype(): Promise<import("node:fs/promises").FileHandle> {
  const fs = await import("node:fs/promises");
  const handle = await fs.open(process.execPath, "r");
  try {
    return Object.getPrototypeOf(handle) as import("node:fs/promises").FileHandle;
  } finally {
    await handle.close();
  }
}
