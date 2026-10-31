export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * A UTC filename stamp with second precision (timestamp-conventions): `yyyymmdd-hhmmss-utc`, e.g.
 * `20260610-031542-utc`. It names a file the app creates at runtime (a session's fallback log)
 * without overwriting one that already has the name.
 */
export function utcStamp(date = new Date()): string {
  return date.toISOString().slice(0, 19).replaceAll("-", "").replaceAll(":", "").replace("T", "-") + "-utc";
}
