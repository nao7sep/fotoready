import { createRoot } from "react-dom/client";
import { api } from "@renderer/ipc/client";
import { ErrorBoundary } from "@renderer/components/error-boundary";
import { denyUnhandledExternalDrop } from "@renderer/external-file-drop";
import { installWindowActivityState } from "@renderer/window-activity";
import { RecordsApp } from "./RecordsWindow";
import "../styles/app.css";

// The Records window's page: the same stylesheet, error boundary and window-activity state as the
// main window, and no file drops.
window.addEventListener("dragover", denyUnhandledExternalDrop);
window.addEventListener("drop", denyUnhandledExternalDrop);
installWindowActivityState(api.lifecycle.onWindowActivityChanged, document.documentElement);

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <RecordsApp />
  </ErrorBoundary>
);
