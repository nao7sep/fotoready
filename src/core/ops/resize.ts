import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertFiniteNumber, assertNonEmptyString, assertOneOf, assertParamsShape } from "./_shared";

const RESIZE_MODES = ["fit", "fill", "width", "height", "long-edge", "short-edge"] as const;
type ResizeMode = (typeof RESIZE_MODES)[number];

type ResizeParams = {
  mode: ResizeMode;
  value: number;
  interpolation: string;
};

const resizeModule: OpModule<ResizeParams> = {
  type: "resize",
  label: "Resize",
  category: "Geometry",
  previewBehavior: "show-output",
  defaultParams: { mode: "long-edge", value: 1920, interpolation: "lanczos3" },
  validate(value) {
    const record = assertParamsShape(value, ["mode", "value", "interpolation"], "resize.params");
    return {
      mode: assertOneOf(record.mode, "resize.params.mode", RESIZE_MODES),
      value: assertFiniteNumber(record.value, "resize.params.value", { integer: true, min: 1 }),
      interpolation: assertNonEmptyString(record.interpolation, "resize.params.interpolation")
    };
  },
  apply(image, params) {
    const value = Math.max(1, Math.round(params.value));
    switch (params.mode) {
      case "width": return image.resize({ width: value });
      case "height": return image.resize({ height: value });
      case "fill": return image.resize({ width: value, height: value, fit: "cover" });
      case "fit": return image.resize({ width: value, height: value, fit: "inside" });
      case "short-edge": return image.resize({ width: value, height: value, fit: "outside" });
      case "long-edge":
      default:
        return image.resize({ width: value, height: value, fit: "inside", withoutEnlargement: true });
    }
  }
};

registerOp(resizeModule);
