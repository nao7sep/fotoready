// Whitespace cleanup for stored and displayed text — the per-app realization of
// the fleet text-cleanup conventions. There is no shared package; these are the
// canonical algorithms copied verbatim, with their behavior pinned by
// tests/shared/text-cleanup.test.ts.
//
// Cleanup runs at commit/blur/display time, NEVER mid-edit (per the text-input
// IME conventions): formatting a field while the user types — or composes with
// an IME — tears the value out from under them. Callers apply these on blur or
// at the point a raw value is written into output, not in a keystroke handler.
//
// "Whitespace" and "blank" lean on the language built-ins, which already cover
// the full-width space U+3000 (heavy in Japanese text) and NBSP: `\s`, `trim()`,
// and `line.trim() === ""` are the definitions used throughout — no hand-rolled
// character table. Line separators are `\r\n | \r | \n` only; splitting on them
// and rejoining with `\n` normalizes newlines as an intended side effect.

import type { MetadataFields } from "./types/settings";

/**
 * Single-line cleanup for scalar values — names, labels, single fields, and any
 * value written verbatim onto one line (e.g. an EXIF/IPTC/XMP scalar).
 *
 * Always trims both ends. Interior behavior is two independent decisions:
 *
 * - `flattenLineBreaks` (default true): every whitespace run that contains a
 *   line break collapses, whole, into a single ASCII space — a value pasted
 *   across lines becomes one line, while pure horizontal spacing typed within a
 *   line is preserved. Switch off to trim only and leave line breaks intact.
 * - `minify` (default false): every run of one or more whitespace characters —
 *   including a lone full-width U+3000 — collapses to a single ASCII space. It
 *   collapses horizontal whitespace too, so it dominates `flattenLineBreaks`.
 *
 * Cleanup normalizes; it does not validate. Identity/strict-format fields (ids,
 * keys, slugs) must be validated and rejected elsewhere, never silently
 * normalized here.
 */
export function singleLine(
  text: string,
  opts: { flattenLineBreaks?: boolean; minify?: boolean } = {},
): string {
  const { flattenLineBreaks = true, minify = false } = opts;
  if (minify) return text.replace(/\s+/g, " ").trim();
  if (flattenLineBreaks) return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
  return text.trim();
}

/**
 * Multiline cleanup for bodies where line structure matters — descriptions,
 * notes, usage terms. Indentation is always preserved (de-indenting is a
 * separate transform). Three decisions:
 *
 * - `trimLineEnds` (default true): drop each line's trailing whitespace. Switch
 *   off for Markdown bodies relying on two trailing spaces as a hard break.
 * - `dropEdgeBlankLines` (default true): drop blank lines before the first and
 *   after the last visible line.
 * - `collapseBlankLines` (default false): reduce interior runs of blank lines to
 *   one. Off by default because an interior blank run is often a deliberate
 *   section break.
 *
 * A line is blank when its trimmed form is empty, so whitespace-only lines (a
 * lone U+3000 included) count as blank.
 */
export function multiline(
  text: string,
  opts: { trimLineEnds?: boolean; dropEdgeBlankLines?: boolean; collapseBlankLines?: boolean } = {},
): string {
  const { trimLineEnds = true, dropEdgeBlankLines = true, collapseBlankLines = false } = opts;
  const isBlank = (l: string) => l.trim() === "";
  let lines = text.split(/\r\n|\r|\n/);
  if (trimLineEnds) lines = lines.map((l) => l.replace(/\s+$/, ""));

  let start = 0;
  let end = lines.length;
  if (dropEdgeBlankLines) {
    while (start < end && isBlank(lines[start])) start++;
    while (end > start && isBlank(lines[end - 1])) end--;
  }

  const out: string[] = [];
  let prevBlank = false;
  for (const line of lines.slice(start, end)) {
    const blank = isBlank(line);
    if (collapseBlankLines && blank && prevBlank) continue;
    out.push(line);
    prevBlank = blank;
  }
  return out.join("\n");
}

// Description and usageTerms are the only genuinely multi-line editorial fields;
// every other editable metadata field is a scalar written verbatim onto one
// EXIF/IPTC/XMP line, where a stray pasted newline must not leak through.
const MULTILINE_METADATA_FIELDS: ReadonlySet<keyof MetadataFields> = new Set([
  "description",
  "usageTerms",
]);

/**
 * Commit-time cleanup for one editable metadata field. Scalar fields collapse to
 * a single line (default `singleLine`, closing the newline-into-metadata leak);
 * the two multi-line fields keep their line structure via `multiline`. The one
 * place both the Inject-metadata op card and the settings-modal defaults agree on
 * which field gets which pattern — call it on blur, never on each keystroke.
 */
export function cleanMetadataField(field: keyof MetadataFields, value: string): string {
  return MULTILINE_METADATA_FIELDS.has(field) ? multiline(value) : singleLine(value);
}
