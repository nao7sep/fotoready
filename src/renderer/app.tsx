import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CopyPlus, Menu, Pause, Play, RotateCcw, Save, Settings, Trash2 } from "lucide-react";
import { api } from "./ipc/client";
import type { GlobalSettings } from "@shared/types/settings";
import type { CacheSizes, LutEntry, OpCatalogItem, ProjectSnapshot, QueueSnapshot, SystemInfo } from "@shared/types/ipc";
import type { Task } from "@shared/types/project";
import { EditorCanvas } from "./components/canvas/editor-canvas";
import { RenameModal } from "./components/modals/rename-modal";
import { AppSettingsModal } from "./components/modals/settings-modal";
import { OpsPanel } from "./components/panels/ops-panel";
import { OriginalsPanel } from "./components/panels/originals-panel";
import { TasksPanel } from "./components/panels/tasks-panel";
import { useWorkspaceLayout } from "./layout/workspace-layout";
import "./styles/app.css";

function App(): React.JSX.Element {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [projectSnapshot, setProjectSnapshot] = useState<ProjectSnapshot | null>(null);
  const [opCatalog, setOpCatalog] = useState<OpCatalogItem[]>([]);
  const [lutEntries, setLutEntries] = useState<LutEntry[]>([]);
  const [preview, setPreview] = useState<{ taskId: string; dataUrl: string; width: number; height: number } | null>(null);
  const [originalThumbnails, setOriginalThumbnails] = useState<Record<string, string>>({});
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "error">("idle");
  const [renameOpen, setRenameOpen] = useState(false);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showOriginals, setShowOriginals] = useState(true);
  const [showTasks, setShowTasks] = useState(true);
  const [showOps, setShowOps] = useState(true);
  const [selectedRenameTaskIds, setSelectedRenameTaskIds] = useState<string[]>([]);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<GlobalSettings | null>(null);
  const [cacheSizes, setCacheSizes] = useState<CacheSizes | null>(null);
  const [queue, setQueue] = useState<QueueSnapshot>({ done: 0, total: 0, processing: 0, errors: 0, paused: false });
  const workspaceLayout = useWorkspaceLayout({ showOps, showOriginals, showTasks });

  const project = projectSnapshot?.project;
  const activeTask = project?.tasks.find((task) => task.id === projectSnapshot?.activeTaskId) ?? null;
  const activeOriginal = activeTask ? project?.originals.find((original) => original.id === activeTask.originalId) ?? null : null;
  const activePreview = preview?.taskId === activeTask?.id ? preview : null;
  const erroredTasks = project?.tasks.filter((task) => task.error) ?? [];

  useEffect(() => {
    void Promise.all([api.system.getInfo(), api.settings.get(), api.project.current(), api.ops.list(), api.queues.snapshot(), api.luts.list()]).then(
      ([info, loadedSettings, loadedProject, loadedOps, snapshot, loadedLuts]) => {
        setSystemInfo(info);
        setSettings(loadedSettings);
        setProjectSnapshot(loadedProject);
        setOpCatalog(loadedOps);
        setQueue(snapshot);
        setLutEntries(loadedLuts);
      }
    );
  }, []);

  useEffect(() => {
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...args: unknown[]) => {
      originalWarn(...args);
      void api.system.log("warn", stringifyLogArgs(args));
    };
    console.error = (...args: unknown[]) => {
      originalError(...args);
      void api.system.log("error", stringifyLogArgs(args));
    };
    const onError = (event: ErrorEvent) => void api.system.log("error", event.message, event.error instanceof Error ? event.error.stack ?? null : null);
    const onRejection = (event: PromiseRejectionEvent) => void api.system.log("error", "Unhandled renderer rejection", stringifyLogArgs([event.reason]));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      console.warn = originalWarn;
      console.error = originalError;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key === "1") {
        event.preventDefault();
        setShowOriginals((value) => !value);
      } else if (mod && event.key === "2") {
        event.preventDefault();
        setShowTasks((value) => !value);
      } else if (mod && event.key === "3") {
        event.preventDefault();
        setShowOps((value) => !value);
      } else if (mod && event.key.toLowerCase() === "s" && event.shiftKey) {
        event.preventDefault();
        void saveAll();
      } else if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (activeTask?.status === "pending") void saveTask(activeTask.id);
      } else if (mod && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        if (activeTask?.status === "pending") void undoTask(activeTask.id);
      } else if (mod && event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (project?.tasks.some((task) => task.status === "done")) setRenameOpen(true);
      } else if (mod && event.key === ",") {
        event.preventDefault();
        void openSettings();
      } else if (event.key === "?" && !mod) {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTask?.id, activeTask?.status, project?.tasks]);

  useEffect(() => {
    const offProject = api.events.onProjectSnapshot((snapshot) => {
      setProjectSnapshot(snapshot);
    });
    const offQueue = api.events.onQueueSnapshot((snapshot) => {
      setQueue(snapshot);
    });
    return () => {
      offProject();
      offQueue();
    };
  }, []);

  useEffect(() => {
    if (!activeTask) {
      setPreview(null);
      setPreviewState("idle");
      return;
    }

    let cancelled = false;
    setPreviewState("loading");
    void api.preview.render(activeTask.id)
      .then((result) => {
        if (!cancelled) {
          setPreview(result);
          setPreviewState("idle");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreview(null);
          setPreviewState("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTask?.id, activeTask?.updatedAt, activeTask?.pipeline.ops.length]);

  useEffect(() => {
    const originals = project?.originals ?? [];
    const missing = originals.filter((original) => !originalThumbnails[original.id]);
    if (missing.length === 0) return;

    let cancelled = false;
    for (const original of missing) {
      void api.preview.originalThumbnail(original.id)
        .then((thumbnail) => {
          if (!cancelled) {
            setOriginalThumbnails((current) => ({ ...current, [thumbnail.originalId]: thumbnail.dataUrl }));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setOriginalThumbnails((current) => ({ ...current, [original.id]: "" }));
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [project?.originals, originalThumbnails]);

  async function addOriginals(): Promise<void> {
    await refreshProject(await api.project.addOriginalsFromDialog());
  }

  async function addOriginalPaths(sourcePaths: string[]): Promise<void> {
    if (sourcePaths.length === 0) return;
    await refreshProject(await api.project.addOriginals(sourcePaths));
  }

  async function openProject(): Promise<void> {
    await refreshProject(await api.project.openFromDialog());
  }

  async function newProject(): Promise<void> {
    await refreshProject(await api.project.newProject());
  }

  async function saveProjectAs(): Promise<void> {
    await refreshProject(await api.project.saveAsFromDialog());
  }

  async function setOutputDir(): Promise<void> {
    await refreshProject(await api.project.setOutputDirFromDialog());
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

  async function deleteTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.delete(taskId));
    setSelectedRenameTaskIds((current) => current.filter((id) => id !== taskId));
  }

  async function retryTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.retry(taskId));
  }

  async function dismissError(taskId: string): Promise<void> {
    await refreshProject(await api.task.dismissError(taskId));
  }

  async function revealSource(): Promise<void> {
    if (activeOriginal) await api.system.revealInFolder(activeOriginal.sourcePath);
  }

  async function revealTaskSource(task: Task): Promise<void> {
    const original = project?.originals.find((item) => item.id === task.originalId);
    if (original) await api.system.revealInFolder(original.sourcePath);
  }

  async function editErroredTask(task: Task): Promise<void> {
    if (task.error) await refreshProject(await api.task.dismissError(task.id));
    await refreshProject(await api.task.select(task.id));
    setErrorsOpen(false);
  }

  async function undoTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.undo(taskId));
  }

  async function saveTask(taskId: string): Promise<void> {
    await refreshProject(await api.task.save(taskId));
  }

  async function saveAll(): Promise<void> {
    await refreshProject(await api.task.saveAll());
  }

  async function addOp(opType: string): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.addOp(activeTask.id, opType));
  }

  async function removeOp(opIndex: number): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.removeOp(activeTask.id, opIndex));
  }

  async function setOpEnabled(opIndex: number, enabled: boolean): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.setOpEnabled(activeTask.id, opIndex, enabled));
  }

  async function updateOpParam(opIndex: number, key: string, value: unknown): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.updateOpParam(activeTask.id, opIndex, key, value));
  }

  async function setAnalyzeContent(analyzeContent: boolean): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.setAnalyzeContent(activeTask.id, analyzeContent));
  }

  async function setCustomSlug(customSlug: string | null): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.setCustomSlug(activeTask.id, customSlug));
  }

  async function runVision(taskId: string): Promise<void> {
    await refreshProject(await api.vision.runForTask(taskId));
  }

  async function saveApiKey(): Promise<void> {
    if (!apiKeyDraft.trim()) return;
    await api.settings.setGeminiApiKey(apiKeyDraft.trim());
    setApiKeyDraft("");
    setApiKeyOpen(false);
  }

  async function openSettings(): Promise<void> {
    setCacheSizes(await api.caches.sizes());
    setSettingsDraft(settings);
    setApiKeyOpen(true);
  }

  async function clearCaches(): Promise<void> {
    setCacheSizes(await api.caches.clear());
  }

  async function saveSettingsDraft(): Promise<void> {
    if (!settingsDraft) return;
    setSettings(await api.settings.update(settingsDraft));
    setLutEntries(await api.luts.list());
    setApiKeyOpen(false);
  }

  async function updateOutput(key: string, value: unknown): Promise<void> {
    if (!activeTask) return;
    await refreshProject(await api.task.updateOutput(activeTask.id, key, value));
  }

  async function refreshProject(snapshot: ProjectSnapshot): Promise<void> {
    setProjectSnapshot(snapshot);
    const doneTaskIds = new Set(snapshot.project.tasks.filter((task) => task.status === "done").map((task) => task.id));
    setSelectedRenameTaskIds((current) => current.filter((taskId) => doneTaskIds.has(taskId)));
    setQueue(await api.queues.snapshot());
  }

  function toggleRenameSelection(taskId: string, selected: boolean): void {
    setSelectedRenameTaskIds((current) => {
      if (selected) return current.includes(taskId) ? current : [...current, taskId];
      return current.filter((id) => id !== taskId);
    });
  }

  async function pauseQueues(): Promise<void> {
    setQueue(await api.queues.pause());
  }

  async function resumeQueues(): Promise<void> {
    setQueue(await api.queues.resume());
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <button className="project-button" type="button">
          {project?.name ?? "Untitled Project"}
        </button>
        <button className="toolbar-button" type="button" onClick={() => void newProject()}>New</button>
        <button className="toolbar-button" type="button" onClick={() => void openProject()}>Open</button>
        <button className="toolbar-button" type="button" onClick={() => void saveProjectAs()}>Save as</button>
        <button className="output-path" type="button" onClick={() => void setOutputDir()}>Output: {project?.outputDir ?? settings?.defaultOutputDirectory ?? "./out"}</button>
        <button className="icon-button" type="button" title="Settings" onClick={() => void openSettings()}>
          <Settings size={18} />
        </button>
        <button className="icon-button" type="button" title="Menu" onClick={() => setMenuOpen((value) => !value)}>
          <Menu size={18} />
        </button>
        {menuOpen ? (
          <div className="app-menu">
            <button type="button" onClick={() => {
              setMenuOpen(false);
              void openSettings();
            }}>Settings</button>
            <button type="button" onClick={() => {
              setMenuOpen(false);
              setShortcutsOpen(true);
            }}>Keyboard shortcuts</button>
            <button type="button" onClick={() => {
              setMenuOpen(false);
              setAboutOpen(true);
            }}>About FotoReady</button>
          </div>
        ) : null}
      </header>

      <section className="workspace" style={{ gridTemplateColumns: workspaceLayout.gridTemplateColumns }}>
        {showOriginals ? (
          <OriginalsPanel
            activeOriginalId={activeOriginal?.id ?? null}
            originals={project?.originals ?? []}
            thumbnails={originalThumbnails}
            onAdd={() => void addOriginals()}
            onDropFiles={(sourcePaths) => void addOriginalPaths(sourcePaths)}
            onSelect={(originalId) => void selectOriginal(originalId)}
          />
        ) : null}
        {showOriginals ? <WorkspaceSplitter label="Resize Originals panel" onPointerDown={workspaceLayout.startResize("originals")} /> : null}

        {showTasks ? (
          <TasksPanel
            activeTaskId={activeTask?.id ?? null}
            originals={project?.originals ?? []}
            selectedRenameTaskIds={selectedRenameTaskIds}
            tasks={project?.tasks ?? []}
            onRename={() => setRenameOpen(true)}
            onSaveAll={() => void saveAll()}
            onSelect={(taskId) => void selectTask(taskId)}
            onToggleRenameSelection={toggleRenameSelection}
          />
        ) : null}
        {showTasks ? <WorkspaceSplitter label="Resize Tasks panel" onPointerDown={workspaceLayout.startResize("tasks")} /> : null}

        <section className="editor-panel">
          <div className="canvas-frame">
            <EditorCanvas
              fallbackLabel={activeOriginal ? basename(activeOriginal.sourcePath) : "Import an original to begin editing"}
              originalDataUrl={activeOriginal ? originalThumbnails[activeOriginal.id] || null : null}
              preview={activePreview}
              previewState={previewState}
              task={activeTask}
            />
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
            {activeTask?.error ? (
              <button className="inline-action" type="button" onClick={() => void retryTask(activeTask.id)}>
                <RotateCcw size={14} /> Retry
              </button>
            ) : null}
            {activeTask ? (
              <button className="inline-action danger" type="button" onClick={() => void deleteTask(activeTask.id)}>
                <Trash2 size={14} /> Delete
              </button>
            ) : null}
            {activeTask?.status === "done" && !activeTask.output?.vision ? (
              <button className="inline-action" type="button" onClick={() => void runVision(activeTask.id)}>
                Generate description
              </button>
            ) : null}
          </div>
          {activeTask?.error ? (
            <div className="error-strip">
              <strong>{activeTask.error.stage}</strong>
              <span>{activeTask.error.message}</span>
              <button className="inline-action" type="button" onClick={() => void retryTask(activeTask.id)}>Retry</button>
              <button className="inline-action" disabled={!activeOriginal} type="button" onClick={() => void revealSource()}>Reveal source</button>
              <button className="inline-action" type="button" onClick={() => void dismissError(activeTask.id)}>Dismiss</button>
            </div>
          ) : null}
          <div className="histogram-placeholder" />
        </section>

        {showOps ? <WorkspaceSplitter label="Resize Ops panel" onPointerDown={workspaceLayout.startResize("ops")} /> : null}

        {showOps ? (
          <OpsPanel
            activeTask={activeTask}
            luts={lutEntries}
            opCatalog={opCatalog}
            onAddOp={(opType) => void addOp(opType)}
            onAnalyzeContentChange={(value) => void setAnalyzeContent(value)}
            onCustomSlugChange={(value) => void setCustomSlug(value)}
            onOpEnabledChange={(index, enabled) => void setOpEnabled(index, enabled)}
            onOpParamChange={(index, key, value) => void updateOpParam(index, key, value)}
            onOutputChange={(key, value) => void updateOutput(key, value)}
            onRemoveOp={(index) => void removeOp(index)}
          />
        ) : null}
      </section>

      {renameOpen && settings ? (
        <RenameModal
          defaultTemplateId={project?.settings.defaultTemplateId ?? settings.defaultTemplateId}
          doneTasks={(project?.tasks ?? []).filter((task) => task.status === "done").map((task) => ({
            id: task.id,
            label: taskLabel(task, project?.originals ?? []),
            selected: selectedRenameTaskIds.includes(task.id)
          }))}
          onClose={() => setRenameOpen(false)}
          onGenerateMissing={async (taskIds, onProgress) => {
            for (const [index, taskId] of taskIds.entries()) {
              await refreshProject(await api.vision.runForTask(taskId));
              onProgress(index + 1, taskIds.length);
            }
          }}
          onPreview={(templateId, taskIds) => api.rename.preview(templateId, taskIds)}
          onRun={async (templateId, taskIds) => {
            await refreshProject(await api.rename.run(templateId, taskIds));
            setRenameOpen(false);
          }}
          onTaskSelected={toggleRenameSelection}
          selectedTaskIds={selectedRenameTaskIds}
          templates={settings.filenameTemplates}
        />
      ) : null}

      {apiKeyOpen ? (
        <AppSettingsModal
          apiKeyDraft={apiKeyDraft}
          cacheSizes={cacheSizes}
          onApiKeyDraftChange={setApiKeyDraft}
          onClearCaches={() => void clearCaches()}
          onClose={() => setApiKeyOpen(false)}
          onSaveApiKey={() => void saveApiKey()}
          onSaveSettings={() => void saveSettingsDraft()}
          settingsDraft={settingsDraft}
          setSettingsDraft={setSettingsDraft}
          systemInfo={systemInfo}
        />
      ) : null}

      {shortcutsOpen ? (
        <div className="modal-backdrop">
          <section className="modal small-modal">
            <header className="modal-header">
              <h2>Keyboard Shortcuts</h2>
              <button className="toolbar-button" type="button" onClick={() => setShortcutsOpen(false)}>Close</button>
            </header>
            <div className="shortcut-list">
              {[
                ["Cmd/Ctrl+1", "Toggle Originals"],
                ["Cmd/Ctrl+2", "Toggle Tasks"],
                ["Cmd/Ctrl+3", "Toggle Ops"],
                ["Cmd/Ctrl+S", "Save current task"],
                ["Cmd/Ctrl+Shift+S", "Save all"],
                ["Cmd/Ctrl+R", "Rename"],
                ["Cmd/Ctrl+,", "Settings"],
                ["?", "Keyboard shortcuts"]
              ].map(([keys, action]) => (
                <div className="shortcut-row" key={keys}>
                  <kbd>{keys}</kbd>
                  <span>{action}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {aboutOpen ? (
        <div className="modal-backdrop">
          <section className="modal small-modal">
            <header className="modal-header">
              <h2>About FotoReady</h2>
              <button className="toolbar-button" type="button" onClick={() => setAboutOpen(false)}>Close</button>
            </header>
            <div className="settings-summary">
              <span>Application</span>
              <code>{systemInfo ? `${systemInfo.appName} ${systemInfo.version}` : "FotoReady"}</code>
            </div>
            <div className="settings-summary">
              <span>Data directory</span>
              <code>{systemInfo?.dataDir ?? "~/.fotoready"}</code>
            </div>
            <div className="settings-summary">
              <span>License</span>
              <code>MIT</code>
            </div>
          </section>
        </div>
      ) : null}

      <footer className="status-bar">
        <span>
          Queue: {queue.done}/{queue.total} done
          {queue.processing > 0 ? ` · ${queue.processing} processing` : ""}
          {queue.errors > 0 ? ` · ${queue.errors} errors` : ""}
          {queue.paused ? " · paused" : ""}
        </span>
        {erroredTasks.length ? (
          <button className="toolbar-button compact-text" type="button" onClick={() => setErrorsOpen(true)}>
            Errors
          </button>
        ) : null}
        <button className="icon-button compact" type="button" title="Pause queues" onClick={() => void pauseQueues()} disabled={queue.paused}>
          <Pause size={15} />
        </button>
        <button className="icon-button compact" type="button" title="Resume queues" onClick={() => void resumeQueues()} disabled={!queue.paused}>
          <Play size={15} />
        </button>
        <span className="version">{systemInfo ? `${systemInfo.appName} ${systemInfo.version}` : "FotoReady"}</span>
      </footer>

      {errorsOpen ? (
        <div className="modal-backdrop">
          <section className="modal">
            <header className="modal-header">
              <h2>Errors</h2>
              <button className="toolbar-button" type="button" onClick={() => setErrorsOpen(false)}>Close</button>
            </header>
            <div className="error-center-list">
              {erroredTasks.length ? erroredTasks.map((task) => (
                <div className="error-center-row" key={task.id}>
                  <div>
                    <strong>{taskLabel(task, project?.originals ?? [])}</strong>
                    <span>{task.error?.stage}: {task.error?.message}</span>
                  </div>
                  <button className="toolbar-button" type="button" onClick={() => void retryTask(task.id)}>Retry</button>
                  <button className="toolbar-button" type="button" onClick={() => void editErroredTask(task)}>Edit task</button>
                  <button className="toolbar-button" type="button" onClick={() => void revealTaskSource(task)}>Reveal source</button>
                  <button className="toolbar-button" type="button" onClick={() => void dismissError(task.id)}>Dismiss</button>
                </div>
              )) : <div className="ops-empty">No current task errors</div>}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function WorkspaceSplitter({
  label,
  onPointerDown
}: {
  label: string;
  onPointerDown(event: React.PointerEvent<HTMLButtonElement>): void;
}): React.JSX.Element {
  return <button aria-label={label} className="workspace-splitter" type="button" onPointerDown={onPointerDown} />;
}

function basename(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).at(-1) ?? sourcePath;
}

function taskLabel(task: Task, originals: { id: string; sourcePath: string }[]): string {
  const original = originals.find((item) => item.id === task.originalId);
  return original ? basename(original.sourcePath) : task.id;
}

function stringifyLogArgs(args: unknown[]): string {
  return args.map((arg) => {
    if (arg instanceof Error) return arg.stack ?? arg.message;
    if (typeof arg === "string") return arg;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }).join(" ");
}

createRoot(document.getElementById("root")!).render(<App />);
