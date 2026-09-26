import React, { useState } from "react";
import type { SystemInfo } from "@shared/types/ipc";
import { api } from "@renderer/ipc/client";
import { ModalShell } from "./modal-shell";
import { dismissOwnedFailure, runOwnedAction, type OwnedFailures } from "../../owned-failures";
import { OwnedFailureList } from "../owned-failure-list";
import { useI18n } from "@renderer/i18n/I18nContext";
import { message } from "@shared/i18n/translate";

const APP_REPOSITORY_URL = "https://github.com/nao7sep/fotoready";
const APP_ISSUES_URL = `${APP_REPOSITORY_URL}/issues`;

interface Props {
  systemInfo: SystemInfo | null;
  onClose(): void;
}

export function AboutModal({ systemInfo, onClose }: Props): React.JSX.Element {
  const { t } = useI18n();
  const [linkFailures, setLinkFailures] = useState<OwnedFailures>({});

  function openProjectPage(key: "repository" | "issues", url: string): void {
    void runOwnedAction({
      action: () => api.system.openExternal(url),
      fields: { url },
      key,
      operation: "about link open failed",
      setFailures: setLinkFailures,
      userMessage: message(key === "repository" ? "failure.openRepository" : "failure.openIssues")
    });
  }

  return (
    <ModalShell
      title={t("menu.about")}
      titleHidden
      size="small"
      onClose={onClose}
      footer={<button className="toolbar-button" type="button" onClick={onClose}>{t("common.close")}</button>}
    >
      <div className="about-dialog">
        <div>
          <h3>FotoReady</h3>
          <p className="about-version">{systemInfo?.version ? t("about.version", { version: systemInfo.version }) : t("about.versionUnknown")}</p>
        </div>
        <p>{t("about.description")}</p>
        <div className="about-links">
          <button className="toolbar-button" type="button" onClick={() => openProjectPage("repository", APP_REPOSITORY_URL)}>
            GitHub
          </button>
          <button className="toolbar-button" type="button" onClick={() => openProjectPage("issues", APP_ISSUES_URL)}>
            {t("about.issues")}
          </button>
        </div>
        <OwnedFailureList
          className="about-link-results"
          failures={linkFailures}
          onDismiss={(key) => dismissOwnedFailure(setLinkFailures, key)}
        />
        <div className="settings-summary">
          <span>{t("about.developer")}</span>
          <code>Yoshinao Inoguchi</code>
        </div>
        <div className="settings-summary">
          <span>{t("about.copyright")}</span>
          <code>© 2026 Yoshinao Inoguchi</code>
        </div>
        <div className="settings-summary">
          <span>{t("about.license")}</span>
          <code>GPL-3.0-or-later</code>
        </div>
      </div>
    </ModalShell>
  );
}
