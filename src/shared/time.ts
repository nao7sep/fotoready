export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * A machine-paced UTC filename stamp with millisecond precision (timestamp-conventions):
 * `yyyymmdd-hhmmss-fff-utc`, e.g. `20260610-031542-123-utc`. Every caller of this stamp names a file the
 * app assigns at runtime as part of its own operation (a session log, a backup archive, a quarantine
 * name) — never a human-authored document, which would stay at second precision instead.
 */
export function utcStamp(date = new Date()): string {
  return date.toISOString().slice(0, 23).replaceAll("-", "").replaceAll(":", "").replace(".", "-").replace("T", "-") + "-utc";
}
