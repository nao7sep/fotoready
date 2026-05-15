import type { EncodedOutputFormat, OutputFormat } from "./types/pipeline";

const encodedFormats = ["jpeg", "png", "webp", "avif"] as const satisfies readonly EncodedOutputFormat[];

export function formatLabel(format: OutputFormat | EncodedOutputFormat | string): string {
  if (format === "original") return "Same as original";
  if (format === "jpeg") return "JPEG";
  if (format === "png") return "PNG";
  if (format === "webp") return "WebP";
  if (format === "avif") return "AVIF";
  return format.toUpperCase();
}

export function encodedFormatLabel(format: EncodedOutputFormat): string {
  return formatLabel(format);
}

export function resolveOutputFormat(format: OutputFormat, sourceFormat: string): EncodedOutputFormat {
  if (format !== "original") {
    return format;
  }
  return normalizeSourceOutputFormat(sourceFormat) ?? "png";
}

export function normalizeSourceOutputFormat(sourceFormat: string): EncodedOutputFormat | null {
  return encodedFormats.find((format) => format === sourceFormat) ?? null;
}

export function outputFormatExtension(format: EncodedOutputFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

export function availableOutputFormats(): OutputFormat[] {
  return ["original", ...encodedFormats];
}
