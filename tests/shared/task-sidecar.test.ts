import { describe, expect, it } from "vitest";
import { createTaskSidecar, isTaskSidecar } from "@shared/task-sidecar";
import { defaultPipeline } from "@shared/defaults";
import type { VisionResult } from "@shared/types/project";

const original = {
  fileName: "DSC_0001.jpg",
  sourceHash: "abc123",
  size: 2048,
  format: "jpeg",
  width: 4000,
  height: 3000
};

const vision: VisionResult = {
  description: "A pier at sunset.",
  slugCandidates: ["sunset-pier", "pier"],
  model: "gemini-3-flash-preview",
  ranAt: "2026-06-04T00:00:00.000Z"
};

describe("createTaskSidecar", () => {
  it("produces a version-1 sidecar carrying the task fields", () => {
    const sidecar = createTaskSidecar({
      original,
      generateDescription: true,
      generateSlug: false,
      customSlug: "my-slug",
      pipeline: defaultPipeline(),
      vision
    });

    expect(sidecar.version).toBe(1);
    expect(sidecar.original).toEqual(original);
    expect(sidecar.task.generateDescription).toBe(true);
    expect(sidecar.task.generateSlug).toBe(false);
    expect(sidecar.task.customSlug).toBe("my-slug");
    expect(sidecar.task.vision).toEqual(vision);
  });

  it("deep-clones the pipeline and vision so later source mutations do not leak in", () => {
    const pipeline = defaultPipeline();
    pipeline.ops.push({ id: "op-1", type: "resize", params: { width: 100 }, enabled: true });
    const liveVision: VisionResult = { ...vision, slugCandidates: ["a"] };

    const sidecar = createTaskSidecar({
      original,
      generateDescription: false,
      generateSlug: false,
      customSlug: null,
      pipeline,
      vision: liveVision
    });

    // Mutate the originals after creation.
    pipeline.ops.push({ id: "op-2", type: "blur", params: {}, enabled: true });
    pipeline.output.format = "png";
    liveVision.slugCandidates.push("b");

    expect(sidecar.task.pipeline.ops).toHaveLength(1);
    expect(sidecar.task.pipeline.output.format).toBe(defaultPipeline().output.format);
    expect(sidecar.task.vision?.slugCandidates).toEqual(["a"]);
  });

  it("keeps a null vision as null", () => {
    const sidecar = createTaskSidecar({
      original,
      generateDescription: false,
      generateSlug: false,
      customSlug: null,
      pipeline: defaultPipeline(),
      vision: null
    });
    expect(sidecar.task.vision).toBeNull();
  });
});

describe("isTaskSidecar", () => {
  it("accepts a freshly created sidecar", () => {
    const sidecar = createTaskSidecar({
      original,
      generateDescription: false,
      generateSlug: false,
      customSlug: null,
      pipeline: defaultPipeline(),
      vision: null
    });
    expect(isTaskSidecar(sidecar)).toBe(true);
  });

  it("rejects wrong-version or shapeless values", () => {
    expect(isTaskSidecar(null)).toBe(false);
    expect(isTaskSidecar({})).toBe(false);
    expect(isTaskSidecar({ version: 2, original: {}, task: {} })).toBe(false);
    expect(isTaskSidecar({ version: 1, original: {} })).toBe(false);
  });
});
