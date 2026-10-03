import { describe, expect, it } from "vitest";
import { recordSources } from "@main/records-sources";
import type { Project } from "@shared/types/project";

describe("recordSources", () => {
  it("marks this launch and names the tasks still in the workspace", () => {
    const project = {
      originals: [{ id: "o1", sourcePath: "/photos/harbour.jpg" }, { id: "o2", sourcePath: "C:\\photos\\dusk.png" }],
      tasks: [{ id: "task-1", originalId: "o1" }, { id: "task-2", originalId: "o2" }, { id: "task-3", originalId: "gone" }]
    } as unknown as Pick<Project, "tasks" | "originals">;
    expect(recordSources({ sessions: ["s2", "s1"], taskIds: ["task-2", "task-old", "task-1", "task-3"] }, "s2", project)).toEqual({
      currentSession: "s2",
      sessions: ["s2", "s1"],
      tasks: [
        { taskId: "task-2", name: "dusk.png" },
        { taskId: "task-old", name: null },
        { taskId: "task-1", name: "harbour.jpg" },
        { taskId: "task-3", name: null }
      ]
    });
  });
});
