function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function utcStamp(date = new Date()): string {
  return [
    date.getUTCFullYear().toString(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "-",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    "-utc"
  ].join("");
}
