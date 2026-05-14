import React from "react";
import { Save, X } from "lucide-react";
import type { QueueSnapshot } from "@shared/types/ipc";
import type { Original, Task } from "@shared/types/project";

export function TasksPanel({
  activeTaskId,
  originals,
  queue,
  selectedRenameTaskIds,
  tasks,
  onRename,
  onSaveAll,
  onCancelAll,
  onSelect,
  onToggleRenameSelection
}: {
  activeTaskId: string | null;
  originals: Original[];
  queue: QueueSnapshot;
  selectedRenameTaskIds: string[];
  tasks: Task[];
  onRename(): void;
  onSaveAll(): void;
  onCancelAll(): void;
  onSelect(taskId: string): void;
  onToggleRenameSelection(taskId: string, selected: boolean): void;
}): React.JSX.Element {
  const hasPending = tasks.some((task) => task.status === "pending");
  const hasQueued = queue.queued > 0;

  return (
    <aside className="panel tasks-panel">
      <PanelHeader title="Tasks" />
      <div className="list">
        {tasks.length === 0 ? (
          <div className="empty-state">No tasks yet</div>
        ) : tasks.map((task) => (
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
              <span className="row-detail">{taskQueueDetail(task, queue)} · {task.pipeline.ops.length} ops</span>
            </span>
          </button>
        ))}
      </div>
      <div className="panel-footer">
        <button className="primary-action" type="button" onClick={onSaveAll} disabled={!hasPending}>
          <Save size={14} /> Save all
        </button>
        <button className="toolbar-button" type="button" onClick={onCancelAll} disabled={!hasQueued}>
          <X size={14} /> Cancel all
        </button>
        <button className="toolbar-button" type="button" disabled={!tasks.some((task) => task.status === "done")} onClick={onRename}>
          Rename…
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
  if (task.status === "queued") return "◔";
  if (task.status === "error") return "x";
  return "●";
}

function taskLabel(task: Task, originals: Array<{ id: string; sourcePath: string }>): string {
  const original = originals.find((item) => item.id === task.originalId);
  return original ? basename(original.sourcePath) : task.id;
}

function taskQueueDetail(task: Task, queue: QueueSnapshot): string {
  if (queue.activeTaskId === task.id) return "processing now";
  if (task.status === "queued") return "queued";
  return task.status;
}

function basename(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).at(-1) ?? sourcePath;
}
