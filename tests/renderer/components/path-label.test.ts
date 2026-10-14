// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { PathLabel, splitPathTail } from "@renderer/components/path-label";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("a path shortened from its middle", () => {
  it("keeps the final segment apart from the folders before it, on macOS and Windows paths", () => {
    expect(splitPathTail("/Users/me/Exports/Harbor at dusk")).toEqual({ head: "/Users/me/Exports/", tail: "Harbor at dusk" });
    expect(splitPathTail("C:\\Users\\me\\Exports\\Harbor")).toEqual({ head: "C:\\Users\\me\\Exports\\", tail: "Harbor" });
    expect(splitPathTail("/Users/me/Exports/")).toEqual({ head: "/Users/me/", tail: "Exports/" });
    expect(splitPathTail("Exports")).toEqual({ head: "", tail: "Exports" });
  });

  it("places the path inside its translated sentence, which is never shortened", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.querySelector("#root")!);
    await act(async () => root.render(createElement(PathLabel, { path: "/Users/me/Exports", template: (folder: string) => `出力先: ${folder} (既定)` })));
    expect([...document.querySelectorAll("#root span > span")].map((part) => [part.className, part.textContent])).toEqual([
      ["path-fixed", "出力先: "], ["path-head", "/Users/me/"], ["path-tail", "Exports"], ["path-fixed", " (既定)"]
    ]);
    await act(async () => root.unmount());
  });
});
