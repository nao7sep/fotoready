import type { MetadataFields } from "@shared/types/settings";

export function metadataFieldLabel(field: keyof MetadataFields): string {
  if (field === "webStatement") return "Rights URL";
  if (field === "usageTerms") return "Usage terms";
  if (field === "contactEmail") return "Contact email";
  if (field === "contactUrl") return "Contact URL";
  return field.replace(/^./, (letter) => letter.toUpperCase());
}
