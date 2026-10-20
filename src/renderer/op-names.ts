import type { MessageKey } from "@shared/i18n/catalogues";
import { isOpType, type OpType } from "@shared/op-types";
import type { OpCategory } from "@shared/types/op";

// An op's name is interface text, looked up by its type.
const OP_NAME_LABELS: Readonly<Record<OpType, MessageKey>> = {
  "auto-tone": "opName.autoTone",
  blur: "opName.blur",
  cover: "opName.cover",
  crop: "opName.crop",
  curves: "opName.curves",
  denoise: "opName.denoise",
  flip: "opName.flip",
  hsl: "opName.hsl",
  "inject-metadata": "opName.injectMetadata",
  levels: "opName.levels",
  lut: "opName.lut",
  mosaic: "opName.mosaic",
  resize: "opName.resize",
  rotate: "opName.rotate",
  stamp: "opName.stamp",
  "strip-metadata": "opName.stripMetadata",
  "unsharp-mask": "opName.unsharpMask",
  "watermark-image": "opName.watermarkImage",
  "watermark-text": "opName.watermarkText",
  "white-balance": "opName.whiteBalance"
};

// The shorter names the add-op palette uses where its section heading already says the rest.
const OP_PICKER_LABELS: Readonly<Partial<Record<OpType, MessageKey>>> = {
  "inject-metadata": "opPicker.injectMetadata",
  "strip-metadata": "opPicker.stripMetadata",
  "watermark-image": "opPicker.watermarkImage",
  "watermark-text": "opPicker.watermarkText"
};

const CATEGORY_LABELS: Record<OpCategory, MessageKey> = {
  Geometry: "ops.category.geometry",
  Tone: "ops.category.tone",
  Effects: "ops.category.effects",
  Conceal: "ops.category.conceal",
  Watermark: "ops.category.watermark",
  Metadata: "ops.category.metadata"
};

// A saved recipe can name a type this version does not know; it shows as its id.
export function opNameLabel(type: string): MessageKey | null {
  return isOpType(type) ? OP_NAME_LABELS[type] : null;
}

export function opPickerLabel(type: OpType): MessageKey {
  return OP_PICKER_LABELS[type] ?? OP_NAME_LABELS[type];
}

export function opCategoryLabel(category: OpCategory): MessageKey {
  return CATEGORY_LABELS[category];
}
