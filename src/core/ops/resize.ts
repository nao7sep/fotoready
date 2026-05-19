import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { MAX_RESIZE_DIMENSION, MAX_RESIZE_PIXELS } from "@shared/constants";
import { assertFiniteNumber, assertNonEmptyString, assertOneOf, assertRecord, materialize } from "./_shared";

const RESIZE_MODES = ["fit", "exact"] as const;
type ResizeMode = (typeof RESIZE_MODES)[number];

type ResizeParams = {
  mode: ResizeMode;
  width: number;
  height: number;
  interpolation: string;
};

const resizeModule: OpModule<ResizeParams> = {
  type: "resize",
  label: "Resize",
  category: "Geometry",
  previewBehavior: "show-output",
  defaultParams: { mode: "fit", width: 1024, height: 1024, interpolation: "lanczos3" },
  validate(value) {
    const record = assertRecord(value, "resize.params");
    assertAllowedResizeKeys(record);
    const mode = assertOneOf(record.mode, "resize.params.mode", RESIZE_MODES);
    const interpolation = assertNonEmptyString(record.interpolation, "resize.params.interpolation");
    const width = assertFiniteNumber(record.width, "resize.params.width", { integer: true, min: 1, max: MAX_RESIZE_DIMENSION });
    const height = assertFiniteNumber(record.height, "resize.params.height", { integer: true, min: 1, max: MAX_RESIZE_DIMENSION });
    assertResizePixels(width, height);
    return {
      mode,
      width,
      height,
      interpolation
    };
  },
  async apply(image, params) {
    const width = Math.max(1, Math.round(params.width));
    const height = Math.max(1, Math.round(params.height));
    switch (params.mode) {
      case "exact": return materialize(image.resize({ width, height, fit: "fill" }));
      case "fit":
      default:
        return materialize(image.resize({ width, height, fit: "inside" }));
    }
  }
};

registerOp(resizeModule);

function assertAllowedResizeKeys(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    if (!["mode", "width", "height", "interpolation"].includes(key)) {
      throw new Error(`resize.params.${key} is not a recognized param.`);
    }
  }
}

function assertResizePixels(width: number, height: number): void {
  if (width * height > MAX_RESIZE_PIXELS) {
    throw new Error(`resize.params width × height must stay at or below ${MAX_RESIZE_PIXELS.toLocaleString()} pixels.`);
  }
}
