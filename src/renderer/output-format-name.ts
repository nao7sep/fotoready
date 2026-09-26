import { formatLabel } from "@shared/output-format";
import type { Translator } from "@shared/i18n/translate";

/** A format as the interface names it: "Same as original" in the interface language, else the format's own name. */
export function outputFormatName(t: Translator["t"], format: string): string {
  return format === "original" ? t("format.sameAsOriginal") : formatLabel(format);
}
