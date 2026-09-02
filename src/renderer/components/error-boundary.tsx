import React from "react";
import { reportRendererLog } from "@renderer/renderer-log";

// A render-phase throw anywhere in the tree unmounts the whole React root, leaving the window
// silently blank with no on-screen clue and (for a throw before the app installs its console hook)
// nothing in the log either. This boundary is the backstop: it keeps a visible, readable panel on
// screen instead of a white void, and forwards the crash to the main log so the cause is always
// recoverable. Styles are inline on purpose — the fallback must render even when app.css or the
// preload bridge is the very thing that failed.

type Props = { children: React.ReactNode };
type State = { error: Error | null };

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "2rem",
  background: "#ffffff",
  color: "#1a1a1a",
  fontFamily: "system-ui, -apple-system, sans-serif",
  zIndex: 2147483647
};

const cardStyle: React.CSSProperties = {
  maxWidth: "640px",
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem"
};

const buttonStyle: React.CSSProperties = {
  alignSelf: "flex-start",
  padding: "0.5rem 1rem",
  border: "1px solid #2f7d6f",
  borderRadius: "6px",
  color: "#ffffff",
  background: "#2f7d6f",
  cursor: "pointer",
  fontSize: "0.9rem"
};

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Best-effort forward to the main log. Guarded because the boundary must never throw while
    // reporting — if the preload bridge is what failed, window.api is gone and this would mask
    // the real error behind a "cannot read properties of undefined".
    reportRendererLog({
      level: "error",
      message: "Renderer error boundary caught an exception",
      fields: {
        mod: "renderer.error-boundary",
        error: { name: error.name, message: error.message, stack: error.stack ?? null },
        componentStack: info.componentStack ?? null
      }
    });
  }

  private readonly handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" style={overlayStyle}>
        <div style={cardStyle}>
          <h1 style={{ margin: 0, fontSize: "1.25rem" }}>FotoReady hit an unexpected error</h1>
          <p style={{ margin: 0 }}>
            The window could not be drawn. Reload to try again; your saved files on disk are not
            affected. Complete details were written to the log.
          </p>
          <button type="button" style={buttonStyle} onClick={this.handleReload}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
