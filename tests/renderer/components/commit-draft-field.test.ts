// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useCommitDraftField } from "@renderer/components/useDraftField";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function Harness({ external, commit }: { external: string; commit(value: string): void }) {
  const field = useCommitDraftField<HTMLInputElement>(external, commit, "task-1:customSlug");
  return createElement("input", { ...field, type: "text" });
}

async function renderHarness(commit: (value: string) => void): Promise<HTMLInputElement> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(createElement(Harness, { external: "", commit })));
  return container.querySelector("input")!;
}

async function type(input: HTMLInputElement, text: string): Promise<void> {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  for (let length = 1; length <= text.length; length += 1) {
    await act(async () => {
      setValue.call(input, text.slice(0, length));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
}

describe("useCommitDraftField", () => {
  it("commits once on blur, not on each keystroke", async () => {
    const commits: string[] = [];
    const input = await renderHarness((value) => commits.push(value));
    input.focus();

    await type(input, "harbor-sunset");
    expect(commits).toEqual([]);
    expect(input.value).toBe("harbor-sunset");

    await act(async () => input.blur());
    expect(commits).toEqual(["harbor-sunset"]);
  });

  it("commits on Enter, and commits nothing for an unchanged draft", async () => {
    const commits: string[] = [];
    const input = await renderHarness((value) => commits.push(value));
    input.focus();

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(commits).toEqual([]);

    await type(input, "pier");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(commits).toEqual(["pier"]);
  });
});
