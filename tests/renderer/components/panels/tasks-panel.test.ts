// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { TasksPanel } from "@renderer/components/panels/tasks-panel";
import { defaultPipeline } from "@shared/defaults";
import type { Task } from "@shared/types/project";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function task(id: string, overrides: Partial<Task>): Task {
  return {
    id, originalId: "original-1", generateDescription: false, generateSlug: false, customSlug: null, visionRunning: false,
    visionRunMode: null, pipeline: defaultPipeline(), status: "not-saved", output: null, error: null, everEdited: false,
    createdAt: "2026-10-06T00:00:00.000Z", updatedAt: "2026-10-06T00:00:00.000Z", ...overrides
  };
}

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
    onDismissFailure: noop, onRename: noop, onSaveAll: noop, onCancelAll: noop, onSelect: noop
  })));

  const rows = [...document.querySelectorAll(".task-row")];
  expect(rows.map((row) => row.querySelector(".row-detail")?.textContent)).toEqual(["0 ops · Not saved", "0 ops · Needs attention"]);
  expect(rows.map((row) => row.querySelector(".task-state")?.className)).toEqual(["task-state state-not-saved", "task-state state-error"]);
  expect(document.querySelector(".task-row svg")).toBeNull();
  await act(async () => root.unmount());
});
