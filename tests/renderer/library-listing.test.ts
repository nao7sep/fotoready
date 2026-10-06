import { describe, expect, it, vi } from "vitest";
import { message } from "@shared/i18n/translate";
import { ipcFailure } from "@shared/ipc-failure";

vi.mock("@renderer/renderer-log", () => ({ reportRendererLog: vi.fn() }));

import { listLibrary } from "@renderer/library-listing";

// The main window lists a library it cannot load as empty with a notice, but only for a failure
// the main process authored for the user; anything else still fails the caller.

describe("listLibrary", () => {
  const notice = message("failure.lutLibraryUnavailable");

  it("returns the entries and no notice when the library lists", async () => {
    await expect(listLibrary(async () => ["a.cube"], notice, "LUT library listing failed")).resolves.toEqual({ entries: ["a.cube"], notice: null });
  });

  it("lists the library as empty with the notice and the main-authored reason beneath it", async () => {
    const reason = message("failure.pathVariable", { variable: "FOTOREADY_UNSET" });
    const listing = await listLibrary(async () => {
      throw ipcFailure(reason);
    }, notice, "LUT library listing failed");
    expect(listing).toEqual({ entries: [], notice: message("failure.withReason", { failure: notice, reason }) });
  });

  it("lets any other failure propagate", async () => {
    const defect = new Error("Built-in stamp asset is missing");
    await expect(listLibrary(async () => {
      throw defect;
    }, notice, "stamp library listing failed")).rejects.toBe(defect);
  });
});
