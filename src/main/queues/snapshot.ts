import type { QueueSnapshot } from "@shared/types/ipc";

export function emptyQueueSnapshot(): QueueSnapshot {
  return {
    done: 0,
    total: 0,
    processing: 0,
    errors: 0
  };
}
