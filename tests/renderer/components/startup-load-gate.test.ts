// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { StartupLoadGate } from "@renderer/components/startup-load-gate";

let root: Root | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("required startup hydration", () => {
  it("blocks the normal shell with authored recovery copy", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(React.createElement(StartupLoadGate, {
        message: "FotoReady could not read the data needed to open safely."
      }));
    });

    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).toContain("FotoReady could not load its workspace");
    expect(host.textContent).toContain("Reload");
  });
});
