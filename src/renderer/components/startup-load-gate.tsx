import React from "react";

const shellStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: "2rem",
  color: "var(--text-strong-color, #1a1a1a)",
  background: "var(--surface-bg, #fff)",
  fontFamily: "var(--font-ui, system-ui, sans-serif)"
};

const panelStyle: React.CSSProperties = {
  width: "min(34rem, 100%)",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "0.75rem"
};

export function StartupLoadGate({ message }: { message: string | null }): React.JSX.Element {
  if (message === null) {
    return (
      <main aria-busy="true" aria-label="Loading FotoReady" style={shellStyle}>
        <p>Loading FotoReady…</p>
      </main>
    );
  }

  return (
    <main role="alert" style={shellStyle}>
      <section style={panelStyle}>
        <h1 style={{ margin: 0, fontSize: "1.25rem" }}>FotoReady could not load its workspace</h1>
        <p style={{ margin: 0 }}>{message}</p>
        <button className="inline-action" type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </section>
    </main>
  );
}
