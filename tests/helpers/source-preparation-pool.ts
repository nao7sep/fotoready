import { buildOriginal } from "@main/workers/source-preparation";
import { loadTaskSidecars } from "@main/task-sidecar";
import type { PipelineWorkerPool } from "@main/workers/pipeline-pool";
import type { AppLogger } from "@main/logger";

/** Runs the real preparation adapters locally when a session test does not exercise process isolation. */
export function sourcePreparationPool(logger?: AppLogger): PipelineWorkerPool {
  const pool: Pick<PipelineWorkerPool, "prepareOriginal" | "prepareSidecar"> = {
    prepareOriginal: (sourcePath, estimateQuality) => buildOriginal(sourcePath, estimateQuality, logger),
    prepareSidecar: (sourcePath, bundledStampsDir, folders) => loadTaskSidecars([sourcePath], bundledStampsDir, logger, folders)
  };
  return pool as PipelineWorkerPool;
}
