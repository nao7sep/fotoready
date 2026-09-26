import { message, type Message } from "@shared/i18n/translate";
import type { OriginalImportIssue, OriginalImportResult } from "@shared/types/ipc";

// Feedback is held as messages, rendered when shown, so a language change reaches a result that is
// already on screen.

type FeedbackIssue = {
  filePath: string;
  severity: OriginalImportIssue["severity"];
  detail: Message;
  resolveBy: "path" | "receiver-entry";
};

type FeedbackResolution =
  | { kind: "paths"; issues: FeedbackIssue[]; success: Message | null }
  | { kind: "next-import" }
  | { kind: "queue-refresh" }
  | null;

export type OriginalImportFeedback = {
  severity: OriginalImportIssue["severity"];
  title: Message;
  details: Array<{ severity: OriginalImportIssue["severity"]; text: Message }>;
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
      detail: message("import.detail", { name: basename(issue.filePath), reason: issue.reason }),
      resolveBy: "path" as const,
    })),
    ...inaccessibleNames.map((filePath) => ({
      filePath,
      severity: "error" as const,
      detail: inaccessibleDetail(filePath),
      resolveBy: "receiver-entry" as const,
    })),
  ];
  if (issues.length === 0) return null;

  return feedbackFromIssues(issues, successSummary(result.addedOriginals, result.restoredTasks));
}

export function inaccessibleOriginalImportFeedback(names: string[]): OriginalImportFeedback {
  const issues: FeedbackIssue[] = names.length > 0
    ? names.map((name) => ({
      filePath: name,
      severity: "error",
      detail: inaccessibleDetail(name),
      resolveBy: "receiver-entry",
    }))
    : [{
      filePath: "",
      severity: "error",
      detail: message("import.noLocalPath"),
      resolveBy: "receiver-entry",
    }];
  return {
    severity: "error",
    title: message("import.couldNotAdd"),
    details: issues.map((issue) => ({ severity: issue.severity, text: issue.detail })),
    resolution: { kind: "paths", issues, success: null },
  };
}

export function originalImportFailureFeedback(): OriginalImportFeedback {
  return {
    severity: "error",
    title: message("import.couldNotAdd"),
    details: [{ severity: "error", text: message("import.readFailed") }],
    resolution: { kind: "next-import" },
  };
}

export function queueRefreshFailureFeedback(): OriginalImportFeedback {
  return {
    severity: "error",
    title: message("import.refreshFailed"),
    details: [{ severity: "error", text: message("import.refreshFailedDetail") }],
    resolution: { kind: "queue-refresh" },
  };
}

// A dropped file that arrived without a name is named as such, in the interface language.
function inaccessibleDetail(name: string): Message {
  return message("import.detail", {
    name: name || message("import.droppedFile"),
    reason: message("import.inaccessible"),
  });
}

function feedbackFromIssues(
  issues: FeedbackIssue[],
  success: Message | null,
): OriginalImportFeedback {
  const severity = issues.reduce<OriginalImportIssue["severity"]>(
    (highest, issue) => severityRank[issue.severity] > severityRank[highest] ? issue.severity : highest,
    "info",
  );
  return {
    severity,
    title: success
      ? message("import.withIssues", { success, issues: issueSummary(issues.length, severity) })
      : message(severity === "info" ? "import.nothingNew" : severity === "warning" ? "import.nothingAdded" : "import.couldNotAdd"),
    details: issues.map((issue) => ({ severity: issue.severity, text: issue.detail })),
    resolution: { kind: "paths", issues, success },
  };
}

function successSummary(addedOriginals: number, restoredTasks: number): Message | null {
  if (addedOriginals > 0 && restoredTasks > 0) {
    return message("import.addedAndRestored", {
      added: message("import.added", { count: addedOriginals }),
      restored: message("import.andRestored", { count: restoredTasks }),
    });
  }
  if (addedOriginals > 0) return message("import.added", { count: addedOriginals });
  if (restoredTasks > 0) return message("import.restored", { count: restoredTasks });
  return null;
}

function issueSummary(count: number, severity: OriginalImportIssue["severity"]): Message {
  return message(severity === "info" ? "import.alreadyPresent" : "import.needAttention", { count });
}

function pathIdentity(sourcePath: string): string {
  return sourcePath.replaceAll("\\", "/");
}

function basename(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).at(-1) ?? sourcePath;
}
