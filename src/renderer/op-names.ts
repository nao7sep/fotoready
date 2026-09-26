import type { MessageKey } from "@shared/i18n/catalogues";
import type { OpCategory } from "@shared/types/op";

// An op's name is interface text, looked up by its type. A type without an entry shows as its id;
// the i18n gate checks that every registered op has a name and every picker label is used.
export const OP_NAME_LABELS: Readonly<Record<string, MessageKey>> = {
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
export const OP_PICKER_LABELS: Readonly<Record<string, MessageKey>> = {
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

export function opNameLabel(type: string): MessageKey | null {
  return OP_NAME_LABELS[type] ?? null;
}

export function opPickerLabel(type: string): MessageKey | null {
  return OP_PICKER_LABELS[type] ?? OP_NAME_LABELS[type] ?? null;
}

export function opCategoryLabel(category: OpCategory): MessageKey {
  return CATEGORY_LABELS[category];
}
