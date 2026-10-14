import { useEffect, useState } from "react";
import { api } from "@renderer/ipc/client";
import { computerTimeZone, resolveDisplayTimeZone } from "@shared/time-zone";

/**
 * The zone this window shows times in: the saved display zone, or the computer's for System, kept
 * current when a Save changes it (timestamp-conventions, Time zones). Until the setting is read it
 * is the computer's zone, which System, the default, resolves to anyway.
 */
export function useDisplayTimeZone(): string {
  const [zone, setZone] = useState(computerTimeZone);
  useEffect(() => {
    let current = true;
    api.settings.get().then((settings) => { if (current) setZone(resolveDisplayTimeZone(settings.displayTimeZone)); }, () => undefined);
    const off = api.settings.onDisplayTimeZoneChanged((setting) => { if (current) setZone(resolveDisplayTimeZone(setting)); });
    return () => {
      current = false;
      off();
    };
  }, []);
  return zone;
}
