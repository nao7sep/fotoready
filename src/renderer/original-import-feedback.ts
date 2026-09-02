import type { OriginalImportIssue, OriginalImportResult } from "@shared/types/ipc";

type FeedbackIssue = {
  filePath: string;
  severity: OriginalImportIssue["severity"];
  detail: string;
  resolveBy: "path" | "receiver-entry";
};

type FeedbackResolution =
  | { kind: "paths"; issues: FeedbackIssue[]; success: string }
  | { kind: "next-import" }
  | { kind: "queue-refresh" }
  | null;

export type OriginalImportFeedback = {
  severity: OriginalImportIssue["severity"];
  title: string;
  details: Array<{ severity: OriginalImportIssue["severity"]; text: string }>;
  resolution: FeedbackResolution;
};

const severityRank: Record<OriginalImportIssue["severity"], number> = {
  info: 0,
  warning: 1,
  error: 2,
};

export function settleOriginalImportFeedback(
  current: OriginalImportFeedback | null,
  result: OriginalImportResult,
  inaccessibleNames: string[] = [],
): OriginalImportFeedback | null {
  const next = buildOriginalImportFeedback(result, inaccessibleNames);
  if (next) return next;

  if (current?.resolution?.kind === "queue-refresh") return null;
  if (result.canceled) return current;
  if (current?.resolution?.kind === "next-import") return null;
  if (current?.resolution?.kind !== "paths") return current;

  const succeeded = new Set(result.succeededPaths.map(pathIdentity));
  const unresolved = current.resolution.issues.filter(
    (issue) => issue.resolveBy === "path"
      ? !succeeded.has(pathIdentity(issue.filePath))
      : result.succeededPaths.length === 0,
  );
  if (unresolved.length === 0) return null;
  if (unresolved.length === current.resolution.issues.length) return current;
  return feedbackFromIssues(unresolved, current.resolution.success);
}

export function buildOriginalImportFeedback(
  result: OriginalImportResult,
  inaccessibleNames: string[] = [],
): OriginalImportFeedback | null {
  if (result.canceled) return null;

  const issues: FeedbackIssue[] = [
    ...result.issues.map((issue) => ({
      filePath: issue.filePath,
      severity: issue.severity,
      detail: `${basename(issue.filePath)}: ${issue.reason}`,
      resolveBy: "path" as const,
    })),
    ...inaccessibleNames.map((filePath) => ({
      filePath,
      severity: "error" as const,
      detail: `${filePath}: FotoReady could not access this local file.`,
      resolveBy: "receiver-entry" as const,
    })),
  ];
  if (issues.length === 0) return null;

  return feedbackFromIssues(issues, successSummary(result.addedOriginals, result.restoredTasks));
}

export function inaccessibleOriginalImportFeedback(names: string[]): OriginalImportFeedback {
  const issues: FeedbackIssue[] = (names.length > 0 ? names : ["Dropped file"]).map((name) => ({
    filePath: name,
    severity: "error",
    detail: names.length > 0
      ? `${name}: FotoReady could not access this local file.`
      : "FotoReady did not receive a local file path.",
    resolveBy: "receiver-entry",
  }));
  return {
    severity: "error",
    title: "Originals could not be added.",
    details: issues.map((issue) => ({ severity: issue.severity, text: issue.detail })),
    resolution: { kind: "paths", issues, success: "" },
  };
}

export function originalImportFailureFeedback(): OriginalImportFeedback {
  return {
    severity: "error",
    title: "Originals could not be added.",
    details: [{ severity: "error", text: "The selected files could not be read. Check that they are still available and try again." }],
    resolution: { kind: "next-import" },
  };
}

export function queueRefreshFailureFeedback(): OriginalImportFeedback {
  return {
    severity: "error",
    title: "Originals changed, but status could not be refreshed.",
    details: [{ severity: "error", text: "Reopen FotoReady to refresh the workspace status." }],
    resolution: { kind: "queue-refresh" },
  };
}

function feedbackFromIssues(
  issues: FeedbackIssue[],
  success: string,
): OriginalImportFeedback {
  const severity = issues.reduce<OriginalImportIssue["severity"]>(
    (highest, issue) => severityRank[issue.severity] > severityRank[highest] ? issue.severity : highest,
    "info",
  );
  const issueCount = issues.length;
  return {
    severity,
    title: success
      ? `${success}; ${issueSummary(issueCount, severity)}.`
      : severity === "info" ? "Nothing new was added."
        : severity === "warning" ? "Nothing was added."
          : "Originals could not be added.",
    details: issues.map((issue) => ({ severity: issue.severity, text: issue.detail })),
    resolution: { kind: "paths", issues, success },
  };
}

function successSummary(addedOriginals: number, restoredTasks: number): string {
  const originals = `${addedOriginals} ${addedOriginals === 1 ? "original" : "originals"}`;
  const tasks = `${restoredTasks} ${restoredTasks === 1 ? "task" : "tasks"}`;
  if (addedOriginals > 0 && restoredTasks > 0) return `Added ${originals} and restored ${tasks}`;
  if (addedOriginals > 0) return `Added ${originals}`;
  if (restoredTasks > 0) return `Restored ${tasks}`;
  return "";
}

function issueSummary(count: number, severity: OriginalImportIssue["severity"]): string {
  const items = `${count} ${count === 1 ? "item" : "items"}`;
  if (severity === "info") return `${items} ${count === 1 ? "was" : "were"} already present`;
  return `${items} ${count === 1 ? "needs" : "need"} attention`;
}

function pathIdentity(sourcePath: string): string {
  return sourcePath.replaceAll("\\", "/");
}

function basename(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).at(-1) ?? sourcePath;
}
