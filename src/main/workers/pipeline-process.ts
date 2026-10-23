import { spawn } from "node:child_process";
import sharp from "sharp";
import { NO_PIXEL_LIMIT } from "@runtime/decode";
import pipelineWorker from "./pipeline-worker";
import { buildOriginal } from "./source-preparation";
import { loadTaskSidecars } from "@main/task-sidecar";
import { configureTextBitmapCacheBudget } from "@core/ops/watermark-text";
import type { NativeJob } from "./pipeline-pool";

configureTextBitmapCacheBudget(Number(process.env.FOTOREADY_TEXT_CACHE_BYTES));
process.on("message", (job: NativeJob) => {
  void (async () => {
    try {
      const result = job.kind === "original"
        ? { kind: "original", original: await buildOriginal(job.sourcePath, job.estimateQuality) }
        : job.kind === "thumbnail"
          ? { kind: "thumbnail", thumbnail: await renderOriginalThumbnail(job) }
          : job.kind === "sidecar"
            ? { kind: "sidecar", result: await loadTaskSidecars([job.sourcePath], job.bundledStampsDir, undefined, job.folders) }
            : await pipelineWorker(job);
      process.send?.({ ...result, residentBytes: process.memoryUsage().rss });
    } catch (error) {
      const value = error instanceof Error ? error : new Error(String(error));
      process.send?.({ residentBytes: process.memoryUsage().rss, kind: "error", category: "io", message: value.message, stack: value.stack, code: (error as NodeJS.ErrnoException).code });
    }
  })();
});

async function renderOriginalThumbnail(job: Extract<NativeJob, { kind: "thumbnail" }>) {
  const image = sharp(job.sourcePath, NO_PIXEL_LIMIT).rotate();
  const metadata = await image.metadata();
  const bytes = await image.resize({ width: job.longEdge, height: job.longEdge, fit: "cover" }).jpeg({ quality: 72 }).toBuffer();
  return {
    originalId: job.originalId,
    dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
    width: metadata.width ?? job.width,
    height: metadata.height ?? job.height
  };
}
// A forced main-process exit closes IPC. Only this helper's recorded process tree is stopped.
process.once("disconnect", () => {
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(process.pid), "/T", "/F"], { windowsHide: true });
  else process.kill(-process.pid, "SIGKILL");
});
