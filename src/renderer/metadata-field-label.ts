import type { MessageKey } from "@shared/i18n/catalogues";
import type { MetadataFields } from "@shared/types/settings";

const LABELS: Record<keyof MetadataFields, MessageKey> = {
  source: "metadataField.source",
  description: "metadataField.description",
  author: "metadataField.author",
  contactEmail: "metadataField.contactEmail",
  contactUrl: "metadataField.contactUrl",
  credit: "metadataField.credit",
  copyright: "metadataField.copyright",
  webStatement: "metadataField.webStatement",
  usageTerms: "metadataField.usageTerms"
};

/** The catalogue key naming a metadata field. */
export function metadataFieldLabel(field: keyof MetadataFields): MessageKey {
  return LABELS[field];
}
