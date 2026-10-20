/** What the user picks before a step is added: its LUT, its stamp, or its image file. */
export type AddOpSource = "lut" | "stamp" | "image-file";

/**
 * A LUT, stamp or image watermark does nothing until it has its file, so adding one goes straight to
 * choosing it, and the step is added only once something is chosen; cancelling adds nothing. An image watermark with a default image in Settings starts from that image.
 */
export function sourceToChooseFirst(opType: string, defaultWatermarkImage: string): AddOpSource | null {
  if (opType === "lut") return "lut";
  if (opType === "stamp") return "stamp";
  if (opType === "watermark-image" && !defaultWatermarkImage.trim()) return "image-file";
  return null;
}
