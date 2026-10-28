// libuv's thread pool serves the whole process: the main process's file I/O, sharp's work on the
// main process, and every image worker thread share it. At Node's default of 4, busy image work made
// a plain file stat wait about 200 ms (a scratch check on Electron 44.2.0, macOS), which can hold up
// settings and sidecar saves and use up the quit deadline; at 16 it did not wait. 16 covers 4 for
// file I/O, the default image worker pool of up to 8, and 4 for main-process image work. The size is
// read when the pool first starts, so this module is the main entry's first import. A size the user
// set in the environment is kept.

export const THREADPOOL_SIZE = 16;

/** The size to set, or null when the environment already chose one. */
export function threadpoolSizeToSet(env: NodeJS.ProcessEnv): string | null {
  return env.UV_THREADPOOL_SIZE === undefined || env.UV_THREADPOOL_SIZE === "" ? String(THREADPOOL_SIZE) : null;
}

const size = threadpoolSizeToSet(process.env);
if (size !== null) process.env.UV_THREADPOOL_SIZE = size;
