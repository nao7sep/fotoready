// Every edit operation FotoReady offers, in the order the catalog lists them. The core modules,
// the renderer cards and the interface names are keyed by this union, so an operation missing
// from any of them fails to compile.
export const OP_TYPES = [
  "crop",
  "rotate",
  "flip",
  "resize",
  "levels",
  "white-balance",
  "auto-tone",
  "curves",
  "hsl",
  "unsharp-mask",
  "denoise",
  "lut",
  "cover",
  "blur",
  "mosaic",
  "stamp",
  "watermark-text",
  "watermark-image",
  "strip-metadata",
  "inject-metadata"
] as const;

export type OpType = (typeof OP_TYPES)[number];

/** A saved recipe names its operations by string; anything else is not an operation this version knows. */
export function isOpType(value: unknown): value is OpType {
  return typeof value === "string" && (OP_TYPES as readonly string[]).includes(value);
}
