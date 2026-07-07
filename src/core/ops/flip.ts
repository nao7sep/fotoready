import { assertBoolean } from "@shared/validation/common";
import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertParamsShape, materialize } from "./_shared";

type FlipParams = {
  horizontal: boolean;
  vertical: boolean;
};

const flipModule: OpModule<FlipParams> = {
  type: "flip",
  label: "Flip",
  category: "Geometry",
  previewBehavior: "show-output",
  defaultParams: { horizontal: false, vertical: false },
  validate(value) {
    const record = assertParamsShape(value, ["horizontal", "vertical"], "flip.params");
    return {
      horizontal: assertBoolean(record.horizontal, "flip.params.horizontal"),
      vertical: assertBoolean(record.vertical, "flip.params.vertical")
    };
  },
  async apply(image, params) {
    let next = image;
    if (params.horizontal) next = next.flop();
    if (params.vertical) next = next.flip();
    return materialize(next);
  }
};

registerOp(flipModule);
