import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertFiniteNumber, assertNonEmptyString, assertParamsShape, materialize } from "./_shared";

type RotateParams = {
  degrees: number;
  fillColor: string;
};

const rotateModule: OpModule<RotateParams> = {
  type: "rotate",
  label: "Rotate",
  category: "Geometry",
  previewBehavior: "show-output",
  defaultParams: { degrees: 0, fillColor: "#ffffff" },
  validate(value) {
    const record = assertParamsShape(value, ["degrees", "fillColor"], "rotate.params");
    return {
      degrees: assertFiniteNumber(record.degrees, "rotate.params.degrees", { min: -180, max: 180 }),
      fillColor: assertNonEmptyString(record.fillColor, "rotate.params.fillColor")
    };
  },
  async apply(image, params) {
    return materialize(image.rotate(params.degrees, { background: params.fillColor }));
  }
};

registerOp(rotateModule);
