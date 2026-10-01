// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExtraModelIdsEditor, ModelPicker } from "@renderer/components/model-picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
beforeEach(() => { document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.querySelector("#root")!); });
afterEach(async () => { await act(async () => root.unmount()); });

it("keeps a trailing newline while editing extra ids, and persists only non-empty entries", async () => {
  const changed = vi.fn();
  function Editor() {
    const [ids, setIds] = useState(["first"]);
    return createElement(ExtraModelIdsEditor, { ids, onChange: (values) => { changed(values); setIds(values); } });
  }
  await act(async () => root.render(createElement(Editor)));
  const textarea = document.querySelector("textarea")!;
  await change(textarea, "first\n");
  expect(textarea.value).toBe("first\n");
  expect(changed).toHaveBeenLastCalledWith(["first"]);
  await change(textarea, "first\nsecond");
  expect(changed).toHaveBeenLastCalledWith(["first", "second"]);
});

it("does not add an old out-of-list selection merely because its field lost focus", async () => {
  const add = vi.fn();
  await act(async () => root.render(createElement(ModelPicker, {
    label: "Description", kind: "vision", value: "old-id", fetchedIds: [], extraIds: [], onChange: vi.fn(), onAddExtra: add
  })));
  const input = document.querySelector("input")!;
  await act(async () => { input.focus(); input.blur(); });
  expect(add).not.toHaveBeenCalled();
  expect(document.querySelector("select")?.value).toBe("old-id");
});

it("adds a newly typed model to extra ids when the user finishes editing", async () => {
  const add = vi.fn();
  function Picker() {
    const [value, setValue] = useState("gemini-3.8-flash");
    return createElement(ModelPicker, { label: "Description", kind: "vision", value, fetchedIds: [], extraIds: [], onChange: setValue, onAddExtra: add });
  }
  await act(async () => root.render(createElement(Picker)));
  const input = document.querySelector("input")!;
  await act(async () => input.focus());
  await change(input, "new-typed-id");
  await act(async () => input.blur());
  expect(add).toHaveBeenCalledExactlyOnceWith("new-typed-id");
});

async function change(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
