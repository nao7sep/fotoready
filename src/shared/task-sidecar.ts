import type { OutputSettings, Pipeline } from "./types/pipeline";
import type { VisionResult } from "./types/project";

export type TaskSidecar = {
  version: 1;
  original: {
    fileName: string;
    size: number;
    format: string;
    width: number;
    height: number;
  };
  task: {
    generateDescription: boolean;
    generateSlug: boolean;
    customSlug: string | null;
    pipeline: Pipeline;
    vision: VisionResult | null;
  };
};

export function createTaskSidecar(input: {
  original: TaskSidecar["original"];
  generateDescription: boolean;
  generateSlug: boolean;
  customSlug: string | null;
  pipeline: Pipeline;
  vision: VisionResult | null;
}): TaskSidecar {
  return {
    version: 1,
    original: { ...input.original },
    task: {
      generateDescription: input.generateDescription,
      generateSlug: input.generateSlug,
      customSlug: input.customSlug,
      pipeline: clonePipeline(input.pipeline),
      vision: input.vision ? structuredClone(input.vision) : null
    }
  };
}

export function isTaskSidecar(value: unknown): value is TaskSidecar {
  return typeof value === "object"
    && value !== null
    && "version" in value
    && (value as { version?: unknown }).version === 1
    && "original" in value
    && "task" in value;
}

function clonePipeline(pipeline: Pipeline): Pipeline {
  return {
    ops: structuredClone(pipeline.ops),
    output: structuredClone(pipeline.output) as OutputSettings
  };
}
