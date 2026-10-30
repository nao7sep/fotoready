// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { expect, it } from "vitest";
import { TasksPanel } from "@renderer/components/panels/tasks-panel";
import { defaultPipeline } from "@shared/defaults";
import type { Original, Task } from "@shared/types/project";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function task(id: string, overrides: Partial<Task>): Task {
  return {
    id, originalId: "original-1", generateDescription: false, generateSlug: false, customSlug: null, visionRunning: false,
    visionRunMode: null, pipeline: defaultPipeline(), status: "not-saved", output: null, error: null, everEdited: false,
    createdAt: "2026-10-06T00:00:00.000Z", updatedAt: "2026-10-06T00:00:00.000Z", ...overrides
  };
}

function original(id: string, sourcePath: string): Original {
  return {
    id, sourcePath, sourceHash: `hash-${id}`, size: 64, format: "jpeg", jpegQualityEstimate: null,
    metadataSummary: { editorial: {}, dates: {}, gps: {} }, width: 4, height: 4, addedAt: "2026-10-06T00:00:00.000Z"
  };
}

async function render(root: Root, originals: Original[], tasks: Task[], saveBlockedTaskIds: ReadonlySet<string> = new Set()): Promise<void> {
  const noop = (): void => undefined;
  await act(async () => root.render(createElement(TasksPanel, {
    activeTaskId: null, originals, tasks,
    queue: { saved: 0, total: tasks.length, notSaved: tasks.length, queued: 0, processing: 0, errors: 0, activeTaskId: null, activeTaskLabel: null },
    privacyWarnings: {}, failures: {}, saveBlockedTaskIds,
    onDismissFailure: noop, onRename: noop, onSaveAll: noop, onCancelAll: noop, onSelect: noop
  })));
}

it("refreshes original labels on collection replacement and falls back to task identity after removal", async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  const tasks = [task("task-a", {}), task("task-b", { originalId: "missing-original" })];
  const labels = () => [...document.querySelectorAll(".task-row .row-title")].map((row) => row.textContent);
  try {
    await render(root, [original("original-1", "/photos/harbor.jpg")], tasks);
    expect(labels()).toEqual(["harbor.jpg", "task-b"]);

    await render(root, [original("original-1", "/photos/replaced.jpg")], tasks);
    expect(labels()).toEqual(["replaced.jpg", "task-b"]);

    await render(root, [], tasks);
    expect(labels()).toEqual(["task-a", "task-b"]);
  } finally { await act(async () => root.unmount()); }
});

it("disables Save all while a task has a number to fix, naming its photo beside the button", async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  const saveAll = () => [...document.querySelectorAll<HTMLButtonElement>(".panel-footer button")].find((button) => button.textContent?.trim() === "Save all")!;
  const reason = () => document.querySelector(".panel-footer .blocked-reason")?.textContent ?? null;
  try {
    const tasks = [task("task-a", {})];
    await render(root, [original("original-1", "/photos/harbor.jpg")], tasks, new Set(["task-a"]));
    expect(saveAll().disabled).toBe(true);
    expect(reason()).toBe("Fix the numbers marked in harbor.jpg to save all.");

    await render(root, [original("original-1", "/photos/harbor.jpg")], tasks);
    expect(saveAll().disabled).toBe(false);
    expect(reason()).toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it("reads original identities in proportion to the collection, rather than scanning it for every task", async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  let idReads = 0;
  const originals = Array.from({ length: 32 }, (_, index) => {
    const id = `original-${index}`;
    const image = original(id, `/photos/photo-${index}.jpg`);
    Object.defineProperty(image, "id", { enumerable: true, get: () => { idReads += 1; return id; } });
    return image;
  });
  const tasks = Array.from({ length: 64 }, (_, index) => task(`task-${index}`, { originalId: "original-31" }));
  try {
    await render(root, originals, tasks);
    expect(document.querySelectorAll(".task-row")).toHaveLength(tasks.length);
    expect([...document.querySelectorAll(".row-title")].every((row) => row.textContent === "photo-31.jpg")).toBe(true);
    expect(idReads).toBeLessThanOrEqual(originals.length * 2);

    idReads = 0;
    await render(root, originals, [...tasks, task("extra-task", { originalId: "original-31" })]);
    expect(document.querySelectorAll(".task-row")).toHaveLength(tasks.length + 1);
    expect(idReads).toBe(0);
  } finally { await act(async () => root.unmount()); }
});

it("tells each task's state in a coloured word, with no icon repeating it", async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  const noop = (): void => undefined;
  await act(async () => root.render(createElement(TasksPanel, {
    activeTaskId: null,
    originals: [{ id: "original-1", sourcePath: "/photos/harbor.jpg" } as never],
    queue: { saved: 0, total: 2, notSaved: 1, queued: 0, processing: 0, errors: 1, activeTaskId: null, activeTaskLabel: null },
    tasks: [task("a", {}), task("b", { error: { stage: "save", message: { key: "failure.saveTask" }, retryable: true } as never })],
    privacyWarnings: {},
    failures: {},
    saveBlockedTaskIds: new Set<string>(),
    onDismissFailure: noop, onRename: noop, onSaveAll: noop, onCancelAll: noop, onSelect: noop
  })));

  const rows = [...document.querySelectorAll(".task-row")];
  expect(rows.map((row) => row.querySelector(".row-detail")?.textContent)).toEqual(["0 ops · Not saved", "0 ops · Needs attention"]);
  expect(rows.map((row) => row.querySelector(".task-state")?.className)).toEqual(["task-state state-not-saved", "task-state state-error"]);
  expect(document.querySelector(".task-row svg")).toBeNull();
  await act(async () => root.unmount());
});
