import type { OpModule } from "./op-module";
import { registerOp } from "./registry";
import { assertNonEmptyString, assertParamsShape, regionFromRect, validateRectList } from "./_shared";

type RedactFillParams = {
  rects: Array<{ x: number; y: number; w: number; h: number }>;
  color: string;
};

const redactFillModule: OpModule<RedactFillParams> = {
  type: "redact-fill",
  label: "Fill Redaction",
  category: "Redaction",
  previewBehavior: "show-output",
  defaultParams: { rects: [], color: "#000000" },
  validate(value) {
    const record = assertParamsShape(value, ["rects", "color"], "redact-fill.params");
    return {
      rects: validateRectList(record.rects, "redact-fill.params.rects"),
      color: assertNonEmptyString(record.color, "redact-fill.params.color")
    };
  },
  apply(image, params, ctx) {
    if (params.rects.length === 0) return image;
    return image.composite(params.rects.map((rect) => {
      const region = regionFromRect(rect, ctx.sourceWidth, ctx.sourceHeight);
      return {
        input: {
          create: {
            width: region.width,
            height: region.height,
            channels: 4 as const,
            background: params.color
          }
        },
        left: region.left,
        top: region.top
      };
    }));
  }
};

registerOp(redactFillModule);
