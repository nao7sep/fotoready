// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const reportRendererLog = vi.hoisted(() => vi.fn());
vi.mock("@renderer/renderer-log", () => ({ reportRendererLog }));

import { ErrorBoundary } from "@renderer/components/error-boundary";

describe("renderer error boundary", () => {
  it("keeps a hostile cause chain diagnostic-only and preserves it in the log event", () => {
    const cause = Object.assign(
      new Error("EACCES /private/tmp/FOTOREADY_BOUNDARY_SENTINEL"),
      { code: "EACCES" },
    );
    const failure = new Error("renderer failed", { cause });
    const boundary = new ErrorBoundary({ children: React.createElement("div") });

    boundary.componentDidCatch(failure, { componentStack: "\n at HostileSurface" });
    boundary.state = { error: failure };
    const html = renderToStaticMarkup(boundary.render());

    expect(reportRendererLog).toHaveBeenCalledWith(expect.objectContaining({
      level: "error",
      fields: expect.objectContaining({
        error: expect.objectContaining({
          message: "renderer failed",
          cause: expect.objectContaining({
            message: expect.stringContaining("FOTOREADY_BOUNDARY_SENTINEL"),
          }),
        }),
      }),
    }));
    expect(html).toContain("FotoReady hit an unexpected error");
    expect(html).not.toMatch(/EACCES|private\/tmp|FOTOREADY_BOUNDARY_SENTINEL/i);
  });
});
