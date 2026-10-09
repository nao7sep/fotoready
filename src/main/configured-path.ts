import os from "node:os";
import path from "node:path";
import { message, type Message } from "@shared/i18n/translate";

// The one place a path the user configured (a settings field, FOTOREADY_DATA_DIR)
// is expanded and made absolute, per the storage-path-conventions.

/** A configured path names an environment variable that is not set or is empty. */
export class PathVariableError extends Error {
  readonly variable: string;
  readonly value: string;

  constructor(variable: string, value: string) {
    super(`The path "${value}" refers to the environment variable "${variable}", which is not set or is empty.`);
    this.name = "PathVariableError";
    this.variable = variable;
    this.value = value;
  }
}

const ENV_REFERENCE = /\$(\w+)|\$\{(\w+)\}|%(\w+)%/g;

/**
 * Resolves a configured path. A value that is already absolute is used exactly as given: it is what a
 * folder picker returns, and a folder may be named `$HOME` or `100%`, which expanding would reject
 * or redirect. Any other value is an authored expression: a leading `~` and every `$VAR`, `${VAR}`
 * and `%VAR%` are expanded, and a relative result is resolved against `base`. A reference to an
 * unset or empty variable throws PathVariableError rather than keeping the reference as typed. An
 * expression therefore starts with `~` or a variable, never with a folder root (AI decision: a typed
 * absolute path with a variable in its middle, such as `/Volumes/$DRIVE/out`, is taken literally).
 */
export function resolveConfiguredPath(value: string, base: string): string {
  if (path.isAbsolute(value)) return value;
  const homeDir = os.homedir();
  let expanded = value;
  if (expanded === "~") {
    expanded = homeDir;
  } else if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
    expanded = path.join(homeDir, expanded.slice(2));
  }
  expanded = expanded.replace(ENV_REFERENCE, (_match, plain: string | undefined, braced: string | undefined, percent: string | undefined) => {
    const name = (plain ?? braced ?? percent) as string;
    const env = process.env[name];
    if (!env) throw new PathVariableError(name, value);
    return env;
  });
  return path.isAbsolute(expanded) ? expanded : path.resolve(base, expanded);
}

/** The user-facing reason for a PathVariableError, shown beneath the failed operation's own copy. */
export function pathVariableReason(error: PathVariableError): Message {
  return message("failure.pathVariable", { variable: error.variable });
}
