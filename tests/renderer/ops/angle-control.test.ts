// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AngleControl } from "@renderer/ops/_angle-controls";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("shows the angle once, as a slider row ending in its value, below the quarter-turn steps", async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  const onChange = vi.fn();
  await act(async () => root.render(createElement(AngleControl, { value: 90, disabled: false, onChange })));

  const row = document.querySelector("label.slider-row")!;
  expect([...row.children].map((child) => child.textContent)).toEqual(["Angle", "", "+90°"]);
  expect(document.body.textContent).not.toContain("Angle: ");
  await act(async () => [...document.querySelectorAll("button")].find((button) => button.textContent === "-90°")!.click());
  expect(onChange).toHaveBeenCalledWith(0);
  await act(async () => root.unmount());
});
