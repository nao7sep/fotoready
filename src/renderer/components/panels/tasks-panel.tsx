import React from "react";
import { Save } from "lucide-react";
import type { Original, Task } from "@shared/types/project";

export function TasksPanel({
  activeTaskId,
  originals,
  selectedRenameTaskIds,
  tasks,
  onRename,
  onSaveAll,
  onSelect,
  onToggleRenameSelection
}: {
  activeTaskId: string | null;
  originals: Original[];
  selectedRenameTaskIds: string[];
  tasks: Task[];
  onRename(): void;
  onSaveAll(): void;
  onSelect(taskId: string): void;
  onToggleRenameSelection(taskId: string, selected: boolean): void;
}): React.JSX.Element {
  return (
    <aside className="panel tasks-panel">
      <PanelHeader title="Tasks" />
      {tasks.length ? (
        <div className="list">
          {tasks.map((task) => (
            <button
              className={`list-row task-row ${activeTaskId === task.id ? "active" : ""}`}
              key={task.id}
              type="button"
              onClick={() => onSelect(task.id)}
            >
              {task.status === "done" ? (
                <input
                  aria-label="Select for rename"
                  checked={selectedRenameTaskIds.includes(task.id)}
                  className="row-checkbox"
                  type="checkbox"
                  onChange={(event) => onToggleRenameSelection(task.id, event.currentTarget.checked)}
                  onClick={(event) => event.stopPropagation()}
                />
              ) : null}
              <span className={`status-dot ${task.status}`} aria-hidden="true">{statusIndicator(task)}</span>
              <span className="task-copy">
                <span className="row-title">{taskLabel(task, originals)}</span>
                <span className="row-detail">{task.status} · {task.pipeline.ops.length} ops</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state">No tasks yet</div>
      )}
      <div className="panel-actions">
        <button className="primary-action" type="button" onClick={onSaveAll} disabled={!tasks.some((task) => task.status === "pending")}>
          <Save size={16} /> Save all
        </button>
        <button className="toolbar-button" type="button" disabled={!tasks.some((task) => task.status === "done")} onClick={onRename}>
          Rename...
        </button>
      </div>
    </aside>
  );
}

function PanelHeader({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
    </div>
  );
}

function statusIndicator(task: Task): string {
  if (task.status === "processing") return "◐";
  if (task.status === "error") return "x";
  return "●";
}

function taskLabel(task: Task, originals: Array<{ id: string; sourcePath: string }>): string {
  const original = originals.find((item) => item.id === task.originalId);
  return original ? basename(original.sourcePath) : task.id;
}

function basename(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).at(-1) ?? sourcePath;
}
