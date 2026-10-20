import { describe, expect, it } from "vitest";

import config from "../../electron.vite.config";
import { DEV_HOST, DEV_PORT } from "../../scripts/dev-server.mjs";

describe("Electron development endpoint", () => {
  // run-dev checks that this endpoint is free and then waits on it, so the server must take
  // exactly it rather than moving to another port.
  it("serves the renderer only where run-dev waits for it", () => {
    expect(config.renderer?.server).toMatchObject({ host: DEV_HOST, port: DEV_PORT, strictPort: true });
  });
});
