import { ANGLE_LIMITS } from "@shared/op-limits";
import type { OpModule } from "./op-module";
import { assertFiniteNumber, assertNonEmptyString, assertParamsShape, materialize } from "./_shared";

type RotateParams = {
  degrees: number;
  fillColor: string;
};

export const rotateModule: OpModule<RotateParams> = {
  type: "rotate",
  category: "Geometry",
  previewBehavior: "show-output",
  defaultParams: { degrees: 0, fillColor: "rgba(0,0,0,0)" },
  validate(value) {
    const record = assertParamsShape(value, ["degrees", "fillColor"], "rotate.params");
    return {
      degrees: assertFiniteNumber(record.degrees, "rotate.params.degrees", ANGLE_LIMITS),
      fillColor: assertNonEmptyString(record.fillColor, "rotate.params.fillColor")
    };
  },
  async apply(image, params) {
    return materialize(image.rotate(params.degrees, { background: params.fillColor }));
  }
};
