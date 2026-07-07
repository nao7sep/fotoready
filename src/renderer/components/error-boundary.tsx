import React from "react";

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

const detailStyle: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  background: "#f4f4f5",
  border: "1px solid #e4e4e7",
  borderRadius: "6px",
  padding: "0.75rem",
  margin: 0,
  maxHeight: "40vh",
  overflow: "auto",
  fontSize: "0.85rem",
  lineHeight: 1.4
};

const buttonStyle: React.CSSProperties = {
  alignSelf: "flex-start",
  padding: "0.5rem 1rem",
  border: "1px solid #c4c4c7",
  borderRadius: "6px",
  background: "#fafafa",
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
    try {
      window.api?.system?.log({
        level: "error",
        message: error.message,
        fields: {
          mod: "renderer.error-boundary",
          stack: error.stack ?? null,
          componentStack: info.componentStack ?? null
        }
      });
    } catch {
      /* logging is best-effort; never let it swallow the original failure */
    }
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
            Something failed while drawing the window. The details below were written to the log. You
            can reload to try again; your saved files on disk are not affected.
          </p>
          <pre style={detailStyle}>{error.message}</pre>
          <button type="button" style={buttonStyle} onClick={this.handleReload}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
