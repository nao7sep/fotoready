/** The display zone setting's value that follows the computer (timestamp-conventions, Time zones). */
export const SYSTEM_TIME_ZONE = "system";

/** The broadcast that tells every window the display zone changed on Save. */
export const DISPLAY_TIME_ZONE_CHANGED_CHANNEL = "settings.display-time-zone-changed";

/** Whether the platform knows `zone` as an IANA time zone. */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The computer's zone now, or UTC when the platform cannot say. */
export function computerTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone && isTimeZone(zone) ? zone : "UTC";
}

/** The zone user-facing times are shown in: the chosen zone, or the computer's for System. */
export function resolveDisplayTimeZone(setting: string, systemZone: string = computerTimeZone()): string {
  return setting === SYSTEM_TIME_ZONE ? systemZone : setting;
}

/** The zones offered in Settings: the platform's IANA zones, with a saved zone it lists under another name kept. */
export function timeZoneChoices(saved: string): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return saved !== SYSTEM_TIME_ZONE && !zones.includes(saved) ? [saved, ...zones] : zones;
}
