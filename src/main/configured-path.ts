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
 * Expands a leading `~` and every `$VAR`, `${VAR}` and `%VAR%` in `value`, then
 * resolves a relative result against `base`; an absolute result is returned as
 * expanded. A reference to an unset or empty variable throws PathVariableError
 * rather than keeping the reference as typed.
 */
export function resolveConfiguredPath(value: string, base: string): string {
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
