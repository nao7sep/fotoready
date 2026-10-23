// The main process's file I/O and remaining small image conversions share libuv's pool.
// Native image jobs now run in separate processes with their own pools; their host-derived
// concurrency is owned by NativeProcessPool. A historical local measurement found file stat
// contention at Node's default of 4 and none at 16. Retain 16 as that measured baseline, not
// a guarantee for every host or a statement about the current number of image processes.
// This first entry import runs before the pool starts and preserves an explicit environment value.

export const THREADPOOL_SIZE = 16;

/** The size to set, or null when the environment already chose one. */
export function threadpoolSizeToSet(env: NodeJS.ProcessEnv): string | null {
  return env.UV_THREADPOOL_SIZE === undefined || env.UV_THREADPOOL_SIZE === "" ? String(THREADPOOL_SIZE) : null;
}

const size = threadpoolSizeToSet(process.env);
if (size !== null) process.env.UV_THREADPOOL_SIZE = size;
