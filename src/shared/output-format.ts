import type { EncodedOutputFormat, OutputFormat } from "./types/pipeline";

// The one list. Order is the order the UI offers them in.
export const encodedFormats = ["jpeg", "png", "webp", "avif", "tiff"] as const satisfies readonly EncodedOutputFormat[];

// `satisfies` only proves every entry is a real format — a SUBSET satisfies it just as
// happily, so adding a format to EncodedOutputFormat would leave it silently missing
// from the UI and rejected by validation. This fails to compile if any member of the
// union is not in the list above.
type MissingFromEncodedFormats = Exclude<EncodedOutputFormat, (typeof encodedFormats)[number]>;
const _everyFormatIsOffered: MissingFromEncodedFormats extends never ? true : never = true;
void _everyFormatIsOffered;

export function formatLabel(format: OutputFormat | EncodedOutputFormat | string): string {
  if (format === "original") return "Same as original";
  if (format === "jpeg") return "JPEG";
  if (format === "png") return "PNG";
  if (format === "webp") return "WebP";
  if (format === "avif") return "AVIF";
  if (format === "tiff") return "TIFF";
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

// Extensions are normalized, not echoed from the source: a .jpeg input already saves
// as .jpg. .tif follows that — it is the shorter, more widely produced spelling (every
// scanner writes it), and both spellings are accepted on the way in either way.
export function outputFormatExtension(format: EncodedOutputFormat): string {
  if (format === "jpeg") return "jpg";
  if (format === "tiff") return "tif";
  return format;
}

export function availableOutputFormats(): OutputFormat[] {
  return ["original", ...encodedFormats];
}
