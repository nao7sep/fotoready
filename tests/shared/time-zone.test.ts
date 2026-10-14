import { describe, expect, it } from "vitest";
import { defaultGlobalSettings } from "@shared/defaults";
import { normalizeGlobalSettings } from "@shared/validation/settings";
import { isTimeZone, resolveDisplayTimeZone, timeZoneChoices } from "@shared/time-zone";

describe("the display zone", () => {
  it("defaults to System, which shows times in the computer's zone", () => {
    expect(defaultGlobalSettings().displayTimeZone).toBe("system");
    expect(resolveDisplayTimeZone("system", "Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(resolveDisplayTimeZone("Europe/Berlin", "Asia/Tokyo")).toBe("Europe/Berlin");
  });

  it("is chosen from the platform's IANA zones, keeping a saved zone the list names differently", () => {
    const zones = timeZoneChoices("system");
    expect(zones).toContain("Asia/Tokyo");
    expect(zones).not.toContain("system");
    expect(timeZoneChoices("Asia/Tokyo")).toEqual(zones);
    // The platform accepts "UTC" but does not list it.
    expect(isTimeZone("UTC") && !zones.includes("UTC")).toBe(true);
    expect(timeZoneChoices("UTC")).toEqual(["UTC", ...zones]);
  });

  it("keeps a stored zone the platform knows, and falls back to System for anything else", () => {
    const fallback = defaultGlobalSettings();
    expect(normalizeGlobalSettings({ displayTimeZone: "America/New_York" }, fallback).settings.displayTimeZone).toBe("America/New_York");
    const invalid = normalizeGlobalSettings({ displayTimeZone: "Mars/Olympus" }, fallback);
    expect(invalid.settings.displayTimeZone).toBe("system");
    expect(invalid.issues).toEqual(['settings.displayTimeZone must be "system" or an IANA time zone.']);
  });
});
