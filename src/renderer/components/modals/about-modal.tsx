import React, { useState } from "react";
import type { SystemInfo } from "@shared/types/ipc";
import { api } from "@renderer/ipc/client";
import { ModalShell } from "./modal-shell";
import { dismissOwnedFailure, runOwnedAction, type OwnedFailures } from "../../owned-failures";
import { OwnedFailureList } from "../owned-failure-list";

const APP_REPOSITORY_URL = "https://github.com/nao7sep/fotoready";
const APP_ISSUES_URL = `${APP_REPOSITORY_URL}/issues`;

interface Props {
  systemInfo: SystemInfo | null;
  onClose(): void;
}

export function AboutModal({ systemInfo, onClose }: Props): React.JSX.Element {
  const [linkFailures, setLinkFailures] = useState<OwnedFailures>({});

  function openProjectPage(key: "repository" | "issues", url: string): void {
    void runOwnedAction({
      action: () => api.system.openExternal(url),
      fields: { url },
      key,
      operation: "about link open failed",
      setFailures: setLinkFailures,
      userMessage: key === "repository"
        ? "GitHub could not be opened. Check the default browser and try again."
        : "Issues could not be opened. Check the default browser and try again."
    });
  }

  return (
    <ModalShell
      title="About FotoReady"
      size="small"
      onClose={onClose}
      footer={<button className="toolbar-button" type="button" onClick={onClose}>Close</button>}
    >
      <div className="about-dialog">
        <div>
          <h3>FotoReady</h3>
          <p className="about-version">Version {systemInfo?.version ?? "unknown"}</p>
        </div>
        <p>
          A desktop photo editor for blogging and publication workflows, with queued image processing,
          metadata controls, rename previews, and optional Gemini-assisted descriptions and slugs.
        </p>
        <div className="about-links">
          <button className="toolbar-button" type="button" onClick={() => openProjectPage("repository", APP_REPOSITORY_URL)}>
            GitHub
          </button>
          <button className="toolbar-button" type="button" onClick={() => openProjectPage("issues", APP_ISSUES_URL)}>
            Issues
          </button>
        </div>
        <OwnedFailureList
          className="about-link-results"
          failures={linkFailures}
          onDismiss={(key) => dismissOwnedFailure(setLinkFailures, key)}
        />
        <div className="settings-summary">
          <span>Developer</span>
          <code>Yoshinao Inoguchi</code>
        </div>
        <div className="settings-summary">
          <span>Copyright</span>
          <code>© 2026 Yoshinao Inoguchi</code>
        </div>
        <div className="settings-summary">
          <span>License</span>
          <code>MIT</code>
        </div>
      </div>
    </ModalShell>
  );
}
