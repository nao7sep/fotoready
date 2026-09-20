import { describe, expect, it } from "vitest";
import type { TaskStatus } from "@shared/types/project";
import { isTaskEditable } from "@shared/task-editing";

const ALL_STATUSES: TaskStatus[] = ["not-saved", "queued", "processing", "saved", "error"];

describe("isTaskEditable", () => {
  it("opens the pipeline only while the task is not saved", () => {
    expect(ALL_STATUSES.filter(isTaskEditable)).toEqual(["not-saved"]);
  });
});
