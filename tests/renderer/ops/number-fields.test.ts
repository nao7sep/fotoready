// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cropRenderer } from "@renderer/ops/crop";
import { resizeRenderer } from "@renderer/ops/resize";
import type { OpCardContext, OpRenderer } from "@renderer/ops/op-renderer";
import { taskHasInvalidOpField, useEditorStore } from "@renderer/state/editor-store";
import { cropModule } from "@core/ops/crop";
import type { Task } from "@shared/types/project";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
  useEditorStore.setState({ invalidOpFields: {} });
});
afterEach(async () => { await act(async () => root.unmount()); });

const ctx = (taskId: string): OpCardContext => ({
  activeTaskId: taskId, assetPickerPreviewLongEdge: 180, luts: [], opId: "op", stamps: [],
  originalMetadataSummary: null, originalSize: { width: 300, height: 200 }, inputSize: null
});
const task = (id: string): Task => ({ id, status: "not-saved", pipeline: { ops: [{ id: "op" }] } }) as unknown as Task;
const blocked = (id: string): boolean => taskHasInvalidOpField(useEditorStore.getState().invalidOpFields, task(id));

/** Renders a card over params that each committed change replaces, as the session does; returns them. */
async function renderCard<P extends Record<string, unknown>>(renderer: OpRenderer<P>, initial: P, taskId = "task") {
  const commits: P[] = [];
  let current = initial;
  let setFromOutside: (params: P) => void = () => undefined;
  function Card(): React.JSX.Element {
    const [params, setParams] = useState(initial);
    setFromOutside = setParams;
    const apply = (patch: Partial<P>): void => {
      current = { ...current, ...patch };
      commits.push(current);
      setParams(current);
    };
    return createElement(renderer.Card, {
      params, disabled: false, ctx: ctx(taskId),
      onParamChange: (key, value) => apply({ [key]: value } as unknown as Partial<P>),
      onParamsChange: apply
    });
  }
  await act(async () => root.render(createElement(Card)));
  return {
    commits,
    params: () => current,
    async set(params: P) {
      current = params;
      await act(async () => setFromOutside(params));
    }
  };
}

function field(label: string): { input: HTMLInputElement; error: string | null } {
  const element = [...document.querySelectorAll(".geometry-number-field")].find((candidate) => candidate.firstChild?.textContent === label)!;
  return { input: element.querySelector("input")!, error: element.querySelector(".field-error")?.textContent ?? null };
}

async function type(label: string, value: string): Promise<void> {
  const input = field(label).input;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("resize width and height", () => {
  const params = { mode: "fit", width: 1000, height: 5000, interpolation: "lanczos3" } as const;

  it("keeps an invalid text, names the current maximum and blocks the task's Save while the op keeps its value", async () => {
    const card = await renderCard(resizeRenderer, { ...params });
    await type("Width", "9000");
    expect(field("Width").input.value).toBe("9000");
    // 40,000,000 pixels over a height of 5,000.
    expect(field("Width").error).toBe("Enter a whole number from 1 to 8,000.");
    expect(card.params().width).toBe(1000);
    expect(blocked("task")).toBe(true);

    for (const text of ["", "0", "12.5", "1e3"]) {
      await type("Width", text);
      expect(field("Width").error).toBe("Enter a whole number from 1 to 8,000.");
    }
    expect(card.commits).toEqual([]);

    await type("Width", "0800");
    expect(field("Width").input.value).toBe("0800");
    expect(field("Width").error).toBeNull();
    expect(card.params().width).toBe(800);
    expect(blocked("task")).toBe(false);
  });

  it("commits a typed width once the other dimension makes room for it", async () => {
    const card = await renderCard(resizeRenderer, { ...params });
    await type("Width", "8100");
    expect(field("Width").error).not.toBeNull();
    await type("Height", "4000");
    expect(card.params()).toMatchObject({ width: 8100, height: 4000 });
    expect(field("Width").error).toBeNull();
    expect(blocked("task")).toBe(false);
  });

  it("shows a value set elsewhere instead of the typed text", async () => {
    const card = await renderCard(resizeRenderer, { ...params });
    await type("Width", "abc");
    await card.set({ ...params, width: 1024, height: 1024 });
    expect(field("Width").input.value).toBe("1024");
    expect(blocked("task")).toBe(false);
  });

  it("brings an invalid text back when the user returns to the task", async () => {
    await renderCard(resizeRenderer, { ...params });
    await type("Width", "abc");
    await act(async () => root.unmount());
    root = createRoot(document.querySelector("#root")!);
    await renderCard(resizeRenderer, { ...params });
    expect(field("Width").input.value).toBe("abc");
    expect(blocked("task")).toBe(true);
  });
});

describe("crop custom aspect parts", () => {
  const params = { x: 0, y: 0, w: 1, h: 1, aspectLock: null };

  it("accepts any number above 0, decimals included, and the core accepts the ratio it writes", async () => {
    const card = await renderCard(cropRenderer, { ...params });
    await type("Ratio width", "1.5");
    expect(field("Ratio height").error).toBe("Enter a number above 0.");
    expect(card.commits).toEqual([]);
    expect(blocked("task")).toBe(true);

    await type("Ratio height", "1");
    expect(card.params().aspectLock).toBe("1.5:1");
    expect(card.params().w / card.params().h).toBeCloseTo(1.5);
    expect(cropModule.validate(card.params()).aspectLock).toBe("1.5:1");
    expect(blocked("task")).toBe(false);

    await type("Ratio width", ".5");
    expect(card.params().aspectLock).toBe(".5:1");
    expect(field("Ratio width").input.value).toBe(".5");
  });

  it("keeps the last ratio while a part is 0 or not a number", async () => {
    const card = await renderCard(cropRenderer, { ...params, aspectLock: "4:3" });
    for (const text of ["0", "-1", "abc", "1.2.3"]) {
      await type("Ratio width", text);
      expect(field("Ratio width").input.value).toBe(text);
      expect(field("Ratio width").error).toBe("Enter a number above 0.");
    }
    expect(card.commits).toEqual([]);
    expect(blocked("task")).toBe(true);
  });

  it("treats both parts empty as no custom ratio while the crop has none", async () => {
    await renderCard(cropRenderer, { ...params });
    expect(field("Ratio width").error).toBeNull();
    expect(field("Ratio height").error).toBeNull();
    expect(blocked("task")).toBe(false);
  });

  it("shows clearing both parts of a ratio in force as an error and blocks Save, keeping the ratio", async () => {
    const card = await renderCard(cropRenderer, { ...params, aspectLock: "3:2" });
    await type("Ratio width", "");
    await type("Ratio height", "");
    expect(field("Ratio width").error).toBe("Enter a number above 0.");
    expect(field("Ratio height").error).toBe("Enter a number above 0.");
    expect(card.commits).toEqual([]);
    expect(card.params().aspectLock).toBe("3:2");
    expect(blocked("task")).toBe(true);
  });

  it("refuses an aspect lock the field would not write", () => {
    for (const aspectLock of ["0:1", "1:", "a:b", "wide"]) {
      expect(() => cropModule.validate({ ...params, aspectLock })).toThrow(/aspectLock/);
    }
  });
});
