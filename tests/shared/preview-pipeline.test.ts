import { describe, expect, it } from "vitest";
import { pipelineForPreview } from "@shared/preview-pipeline";
import type { Pipeline, OutputSettings } from "@shared/types/pipeline";
import type { OpInstance } from "@shared/types/op";

const output: OutputSettings = {
  format: "jpeg",
  quality: 80,
  flattenTransparency: false,
  jpegProgressive: false,
  jpegChromaSubsampling: "4:2:0",
  webpMethod: 4,
  avifEffort: 4,
  pngPalette: false,
  backgroundForTransparency: "#ffffff"
};

function op(id: string): OpInstance {
  return { id, type: "resize", params: {}, enabled: true };
}

const pipeline: Pipeline = { ops: [op("a"), op("b"), op("c")], output };

describe("pipelineForPreview", () => {
  it("returns the whole pipeline for full mode (the default)", () => {
    expect(pipelineForPreview(pipeline)).toBe(pipeline);
    expect(pipelineForPreview(pipeline, { mode: "full" })).toBe(pipeline);
  });

  it("slices up to and including the target for 'output' mode", () => {
    const result = pipelineForPreview(pipeline, { mode: "output", targetOpId: "b" });
    expect(result.ops.map((o) => o.id)).toEqual(["a", "b"]);
    expect(result.output).toBe(output);
  });

  it("slices up to but excluding the target for 'input' mode", () => {
    const result = pipelineForPreview(pipeline, { mode: "input", targetOpId: "b" });
    expect(result.ops.map((o) => o.id)).toEqual(["a"]);
  });

  it("requires a target op id for non-full modes", () => {
    expect(() => pipelineForPreview(pipeline, { mode: "output" })).toThrow(/requires a target op id/i);
  });

  it("throws when the target op id is not present", () => {
    expect(() => pipelineForPreview(pipeline, { mode: "output", targetOpId: "missing" })).toThrow(
      /target op not found/i
    );
  });
});
