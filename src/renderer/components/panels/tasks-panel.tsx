import React from "react";
import { Pencil, Save, X } from "lucide-react";
import type { PrivacyWarning, QueueSnapshot } from "@shared/types/ipc";
import type { Original, Task } from "@shared/types/project";
import { taskStateLabel, taskVisualState } from "@renderer/task-visual-state";

export function TasksPanel({
  activeTaskId,
  originals,
  queue,
  tasks,
  privacyWarnings,
  onRename,
  onSaveAll,
  onCancelAll,
  onSelect
}: {
  activeTaskId: string | null;
  originals: Original[];
  queue: QueueSnapshot;
  tasks: Task[];
  privacyWarnings: Record<string, PrivacyWarning>;
  onRename(): void;
  onSaveAll(): void;
  onCancelAll(): void;
  onSelect(taskId: string): void;
}): React.JSX.Element {
  const hasPending = tasks.some((task) => task.status === "not-saved");
  const hasQueued = queue.queued > 0;

  return (
    <aside className="panel tasks-panel">
      <PanelHeader title="Tasks" />
      <div className="list">
        {tasks.length === 0 ? (
          <div className="empty-state">No tasks yet</div>
        ) : tasks.map((task) => (
          <button
            className={`list-row task-row state-${taskVisualState(task)} ${activeTaskId === task.id ? "active" : ""}`}
            key={task.id}
            type="button"
            onClick={() => onSelect(task.id)}
          >
            <span className={`status-dot state-${taskVisualState(task)}`} aria-hidden="true">{statusIndicator(task)}</span>
            <span className="task-copy">
              <span className="row-title">{taskLabel(task, originals)}</span>
              <span className="row-detail">{task.pipeline.ops.length} ops · {taskQueueDetail(task, queue)}</span>
            </span>
            {privacyWarnings[task.id] ? <PrivacyPill warning={privacyWarnings[task.id]} /> : null}
          </button>
        ))}
      </div>
      <div className="panel-footer">
        <button className="toolbar-button" type="button" onClick={onSaveAll} disabled={!hasPending}>
          <Save size={14} /> Save all
        </button>
        <button className="toolbar-button" type="button" onClick={onCancelAll} disabled={!hasQueued}>
          <X size={14} /> Cancel all
        </button>
        <button className="toolbar-button" type="button" disabled={tasks.length === 0} onClick={onRename}>
          <Pencil size={14} /> Rename all
        </button>
      </div>
    </aside>
  );
}

const PRIVACY_GROUP_LETTER: Record<PrivacyWarning["kept"][number], string> = {
  editorial: "E",
  dates: "T",
  gps: "G"
};

const PRIVACY_GROUP_LABEL: Record<PrivacyWarning["kept"][number], string> = {
  editorial: "editorial (E)",
  dates: "time (T)",
  gps: "GPS (G)"
};

function PrivacyPill({ warning }: { warning: PrivacyWarning }): React.JSX.Element {
  const letters = warning.kept.map((group) => PRIVACY_GROUP_LETTER[group]).join("·");
  const tooltip = `Will remain in output: ${warning.kept.map((group) => PRIVACY_GROUP_LABEL[group]).join(", ")}`;
  return (
    <span className="task-privacy-pill" title={tooltip}>
      {letters}
    </span>
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
  if (task.error) return "x";
  if (task.visionRunning) return "◐";
  if (task.status === "processing") return "◐";
  if (task.status === "queued") return "◔";
  return "●";
}

function taskLabel(task: Task, originals: Array<{ id: string; sourcePath: string }>): string {
  const original = originals.find((item) => item.id === task.originalId);
  return original ? basename(original.sourcePath) : task.id;
}

function taskQueueDetail(task: Task, queue: QueueSnapshot): string {
  return taskStateLabel(task, queue);
}

function basename(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).at(-1) ?? sourcePath;
}
