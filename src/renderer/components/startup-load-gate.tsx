import React from "react";
import { useI18n } from "@renderer/i18n/I18nContext";
import type { Message } from "@shared/i18n/translate";

const shellStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: "2rem",
  color: "var(--text-strong-color, #1a1a1a)",
  background: "var(--surface-bg, #fff)",
  fontFamily: 'var(--font-ui, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif)'
};

const panelStyle: React.CSSProperties = {
  width: "min(34rem, 100%)",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "0.75rem"
};

export function StartupLoadGate({ message }: { message: Message | null }): React.JSX.Element {
  const { t, text } = useI18n();
  if (message === null) {
    return (
      <main aria-busy="true" aria-label={t("app.loading")} style={shellStyle}>
        <p>{t("app.loading")}</p>
      </main>
    );
  }

  return (
    <main role="alert" style={shellStyle}>
      <section style={panelStyle}>
        <h1 style={{ margin: 0, fontSize: "1.25rem" }}>{t("app.loadFailed")}</h1>
        <p style={{ margin: 0 }}>{text(message)}</p>
        <button className="primary-action" type="button" onClick={() => window.location.reload()}>
          {t("common.reload")}
        </button>
      </section>
    </main>
  );
}
