import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CopyPlus, ImagePlus, Menu, Pause, Play, Save, Settings } from "lucide-react";
import { api } from "./ipc/client";
import type { GlobalSettings } from "@shared/types/settings";
import type { ProjectSnapshot, QueueSnapshot, SystemInfo } from "@shared/types/ipc";
import type { Task } from "@shared/types/project";
import "./styles/app.css";

function App(): React.JSX.Element {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [projectSnapshot, setProjectSnapshot] = useState<ProjectSnapshot | null>(null);
  const [queue, setQueue] = useState<QueueSnapshot>({ done: 0, total: 0, processing: 0, errors: 0 });

  useEffect(() => {
    void Promise.all([api.system.getInfo(), api.settings.get(), api.project.current(), api.queues.snapshot()]).then(
      ([info, loadedSettings, loadedProject, snapshot]) => {
        setSystemInfo(info);
        setSettings(loadedSettings);
        setProjectSnapshot(loadedProject);
        setQueue(snapshot);
      }
    );
  }, []);

  const project = projectSnapshot?.project;
  const activeTask = project?.tasks.find((task) => task.id === projectSnapshot?.activeTaskId) ?? null;
  const activeOriginal = activeTask ? project?.originals.find((original) => original.id === activeTask.originalId) ?? null : null;

  async function addOriginals(): Promise<void> {
    await refreshProject(await api.project.addOriginalsFromDialog());
  }

  async function selectOriginal(originalId: string): Promise<void> {
    await refreshProject(await api.project.selectOriginal(originalId));
  }

  async function selectTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.select(taskId));
  }

  async function forkTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.fork(taskId));
  }

  async function saveTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.save(taskId));
  }

  async function saveAll(): Promise<void> {
    await refreshProject(await api.task.saveAll());
  }

  async function refreshProject(snapshot: ProjectSnapshot): Promise<void> {
    setProjectSnapshot(snapshot);
    setQueue(await api.queues.snapshot());
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <button className="project-button" type="button">
          {project?.name ?? "Untitled Project"}
        </button>
        <button className="toolbar-button" type="button">Open</button>
        <button className="toolbar-button" type="button">Save as</button>
        <div className="output-path">Output: {settings?.defaultOutputDirectory ?? "./out"}</div>
        <button className="icon-button" type="button" title="Settings">
          <Settings size={18} />
        </button>
        <button className="icon-button" type="button" title="Menu">
          <Menu size={18} />
        </button>
      </header>

      <section className="workspace">
        <aside className="panel originals-panel">
          <PanelHeader title="Originals" />
          <button className="drop-target" type="button" onClick={addOriginals}>
            <ImagePlus size={18} />
            Add originals
          </button>
          <div className="list">
            {project?.originals.map((original) => (
              <button
                className={`list-row ${activeOriginal?.id === original.id ? "active" : ""}`}
                key={original.id}
                type="button"
                onClick={() => void selectOriginal(original.id)}
              >
                <span className="row-title">{basename(original.sourcePath)}</span>
                <span className="row-detail">{original.width}x{original.height} · {original.format}</span>
              </button>
            ))}
          </div>
        </aside>

        <aside className="panel tasks-panel">
          <PanelHeader title="Tasks" />
          {project?.tasks.length ? (
            <div className="list">
              {project.tasks.map((task) => (
                <button
                  className={`list-row task-row ${activeTask?.id === task.id ? "active" : ""}`}
                  key={task.id}
                  type="button"
                  onClick={() => void selectTask(task.id)}
                >
                  <span className={`status-dot ${task.status}`} aria-hidden="true">{statusIndicator(task)}</span>
                  <span className="task-copy">
                    <span className="row-title">{taskLabel(task, projectSnapshot?.project.originals ?? [])}</span>
                    <span className="row-detail">{task.status} · {task.pipeline.ops.length} ops</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">No tasks yet</div>
          )}
          <div className="panel-actions">
            <button className="primary-action" type="button" onClick={() => void saveAll()} disabled={!project?.tasks.some((task) => task.status === "pending")}>
              <Save size={16} /> Save all
            </button>
            <button className="toolbar-button" type="button" disabled>
              Rename...
            </button>
          </div>
        </aside>

        <section className="editor-panel">
          <div className="canvas-frame">
            <div className="canvas-placeholder">
              {activeOriginal ? basename(activeOriginal.sourcePath) : "Import an original to begin editing"}
            </div>
          </div>
          <div className="pipeline-strip">
            Pipeline: {activeTask?.pipeline.ops.length ? `${activeTask.pipeline.ops.length} ops` : "empty"}
            {activeTask?.status === "pending" ? (
              <button className="inline-action" type="button" onClick={() => void saveTask(activeTask.id)}>
                <Save size={14} /> Save task
              </button>
            ) : null}
            {activeTask && activeTask.status !== "pending" ? (
              <button className="inline-action" type="button" onClick={() => void forkTask(activeTask.id)}>
                <CopyPlus size={14} /> Fork as new task
              </button>
            ) : null}
          </div>
          <div className="histogram-placeholder" />
        </section>

        <aside className="panel ops-panel">
          <PanelHeader title="Ops" />
          {["Geometry", "Tone", "Effects", "Redaction", "Metadata", "Output"].map((section) => (
            <section className="op-section" key={section}>
              <h3>{section}</h3>
              {section === "Output" ? (
                <label className="toggle-row" title="When this task is saved, use AI to generate a description of the image. Used for alt text, slugs, and notes.">
                  <input type="checkbox" defaultChecked={settings?.defaultAnalyzeContent ?? true} />
                  Describe contents
                </label>
              ) : (
                <button className="toolbar-button full-width" type="button">Add {section.toLowerCase()} op</button>
              )}
            </section>
          ))}
        </aside>
      </section>

      <footer className="status-bar">
        <span>
          Queue: {queue.done}/{queue.total} done
          {queue.processing > 0 ? ` · ${queue.processing} processing` : ""}
          {queue.errors > 0 ? ` · ${queue.errors} errors` : ""}
        </span>
        <button className="icon-button compact" type="button" title="Pause queues">
          <Pause size={15} />
        </button>
        <button className="icon-button compact" type="button" title="Resume queues">
          <Play size={15} />
        </button>
        <span className="version">{systemInfo ? `${systemInfo.appName} ${systemInfo.version}` : "FotoReady"}</span>
      </footer>
    </main>
  );
}

function PanelHeader({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
    </div>
  );
}

function basename(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).at(-1) ?? sourcePath;
}

function statusIndicator(task: Task): string {
  if (task.status === "processing") return "◐";
  if (task.status === "error") return "x";
  return "●";
}

function taskLabel(task: Task, originals: { id: string; sourcePath: string }[]): string {
  const original = originals.find((item) => item.id === task.originalId);
  return original ? basename(original.sourcePath) : task.id;
}

createRoot(document.getElementById("root")!).render(<App />);
