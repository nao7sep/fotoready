import sharp from "sharp";
import type { Project, Task } from "@shared/types/project";
import { runPipeline } from "@runtime/pipeline-runner";

export type PreviewResult = {
  taskId: string;
  dataUrl: string;
  width: number;
  height: number;
};

export async function renderTaskPreview(project: Project, taskId: string, previewLongEdge: number): Promise<PreviewResult> {
  const task = project.tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const original = project.originals.find((item) => item.id === task.originalId);
  if (!original) {
    throw new Error(`Original not found for task: ${taskId}`);
  }

  const result = await runPipeline(task.pipeline, {
    sourcePath: original.sourcePath,
    sourceHash: original.sourceHash,
    previewLongEdge
  });

  if (result.kind !== "buffer") {
    throw new Error("Preview render did not produce a buffer.");
  }

  const png = await sharp(result.bytes, {
    raw: {
      width: result.width,
      height: result.height,
      channels: 4
    }
  }).png().toBuffer();

  return {
    taskId,
    dataUrl: `data:image/png;base64,${png.toString("base64")}`,
    width: result.width,
    height: result.height
  };
}
