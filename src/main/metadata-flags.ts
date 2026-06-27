/**
 * The metadata-generation flag coupling, lifted out of `ProjectSession` so the
 * "slug implies description" rule is testable without a session. The two flags
 * are not independent: generating a slug requires a description to derive it
 * from, so turning slug on forces description on, and description cannot be
 * cleared while slug is still on. Pure: returns the next flag pair, mutating
 * nothing.
 */

export interface MetadataFlags {
  generateDescription: boolean;
  generateSlug: boolean;
}

export type MetadataFlagChange =
  | { field: "generateDescription"; value: boolean }
  | { field: "generateSlug"; value: boolean };

export function nextMetadataFlags(current: MetadataFlags, change: MetadataFlagChange): MetadataFlags {
  if (change.field === "generateSlug") {
    const generateSlug = change.value;
    return {
      generateSlug,
      // Slug needs a description to derive from, so enabling slug forces
      // description on; disabling slug leaves the description choice as it was.
      generateDescription: generateSlug ? true : current.generateDescription
    };
  }
  // A description toggle cannot turn description off while slug is still on —
  // the slug would be left with nothing to derive from.
  return {
    generateSlug: current.generateSlug,
    generateDescription: change.value || current.generateSlug
  };
}
