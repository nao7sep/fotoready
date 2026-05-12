import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Menu, Pause, Play, Save, Settings } from "lucide-react";
import { api } from "./ipc/client";
import type { GlobalSettings } from "@shared/types/settings";
import type { QueueSnapshot, SystemInfo } from "@shared/types/ipc";
import "./styles/app.css";

function App(): React.JSX.Element {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [queue, setQueue] = useState<QueueSnapshot>({ done: 0, total: 0, processing: 0, errors: 0 });

  useEffect(() => {
    void Promise.all([api.system.getInfo(), api.settings.get(), api.queues.snapshot()]).then(
      ([info, loadedSettings, snapshot]) => {
        setSystemInfo(info);
        setSettings(loadedSettings);
        setQueue(snapshot);
      }
    );
  }, []);

  return (
    <main className="app-shell">
      <header className="top-bar">
        <button className="project-button" type="button">
          Untitled Project
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
          <div className="drop-target">Drop photos here</div>
        </aside>

        <aside className="panel tasks-panel">
          <PanelHeader title="Tasks" />
          <div className="empty-state">No tasks yet</div>
          <div className="panel-actions">
            <button className="primary-action" type="button">
              <Save size={16} /> Save all
            </button>
            <button className="toolbar-button" type="button" disabled>
              Rename...
            </button>
          </div>
        </aside>

        <section className="editor-panel">
          <div className="canvas-frame">
            <div className="canvas-placeholder">Import an original to begin editing</div>
          </div>
          <div className="pipeline-strip">Pipeline: empty</div>
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

createRoot(document.getElementById("root")!).render(<App />);
