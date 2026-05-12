export type RenderTemplateInput = {
  slug: string;
  w: number;
  h: number;
  ext: string;
  outputHash: string;
  index: number;
  savedAt: string | Date;
  sourceFileMtime: string | Date;
  now: string | Date;
  takenAt?: string | Date | null;
};

export function renderFilenameTemplate(pattern: string, input: RenderTemplateInput): string {
  return pattern
    .replaceAll("{slug}", input.slug)
    .replaceAll("{w}", input.w.toString())
    .replaceAll("{h}", input.h.toString())
    .replaceAll("{ext}", input.ext)
    .replaceAll("{index}", input.index.toString())
    .replace(/\{index:0(\d+)\}/g, (_, width: string) => input.index.toString().padStart(Number(width), "0"))
    .replace(/\{hash:(\d+)\}/g, (_, chars: string) => input.outputHash.slice(0, Number(chars)))
    .replace(/\{date:([^}|]+)\|([^}|]+)\|([^}]+)\}/g, (_, source: string, timezone: string, format: string) =>
      formatTemplateDate(selectDateSource(source, input), timezone, format)
    );
}

function selectDateSource(source: string, input: RenderTemplateInput): Date {
  const normalized = source.trim().toLowerCase();
  if (normalized === "saved") return toDate(input.savedAt);
  if (normalized === "now") return toDate(input.now);
  if (normalized === "taken") return toDate(input.takenAt ?? input.sourceFileMtime);
  return toDate(input.sourceFileMtime);
}

function toDate(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function formatTemplateDate(date: Date, timezone: string, format: string): string {
  const normalizedFormat = format.trim().toLowerCase();
  if (normalizedFormat === "unix") {
    return Math.floor(date.getTime() / 1000).toString();
  }

  if (normalizedFormat === "iso") {
    return date.toISOString().replaceAll(":", "-");
  }

  const parts = dateParts(date, timezone);
  if (normalizedFormat === "yyyymmdd-hhmmss") {
    return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
  }

  return `${parts.year}${parts.month}${parts.day}`;
}

function dateParts(date: Date, timezone: string): Record<"year" | "month" | "day" | "hour" | "minute" | "second", string> {
  const timeZone = normalizeTimezone(timezone);
  const formatter = createDateFormatter(timeZone);
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value])) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", string>;
}

function createDateFormatter(timeZone: string | null): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    ...(timeZone ? { timeZone } : {}),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  };
  try {
    return new Intl.DateTimeFormat("en-CA", options);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { ...options, timeZone: undefined });
  }
}

function normalizeTimezone(timezone: string): string | null {
  const normalized = timezone.trim().toLowerCase();
  if (normalized === "local") return null;
  if (normalized === "utc") return "UTC";
  if (normalized === "jst") return "Asia/Tokyo";
  return timezone.trim();
}
