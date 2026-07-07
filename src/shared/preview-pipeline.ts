import type { Pipeline } from "./types/pipeline";
import type { PreviewRenderOptions } from "./types/ipc";

export function pipelineForPreview(pipeline: Pipeline, options?: PreviewRenderOptions): Pipeline {
  const mode = options?.mode ?? "full";
  const targetOpId = options?.targetOpId ?? null;
  if (mode === "full") {
    return pipeline;
  }

  if (!targetOpId) {
    throw new Error(`Preview mode "${mode}" requires a target op id.`);
  }

  const opIndex = pipeline.ops.findIndex((op) => op.id === targetOpId);
  if (opIndex === -1) {
    throw new Error(`Preview target op not found: ${targetOpId}`);
  }

  return {
    ...pipeline,
    ops: pipeline.ops.slice(0, mode === "input" ? opIndex : opIndex + 1)
  };
}
