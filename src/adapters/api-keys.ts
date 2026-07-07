import fs from "node:fs/promises";
import path from "node:path";
import { utcStamp } from "@shared/time";
import { atomicWriteFile } from "@adapters/atomic-file";
import type { Logger } from "@shared/types/log";

/**
 * API key storage and resolution — the secret store at ~/.fotoready/api-keys.json,
 * separate from settings. This is the fleet api-key-storage-conventions realized
 * for fotoready.
 *
 * fotoready uses a single key today (`["gemini"]` → GEMINI_API_KEY), but the
 * store is the generic, segment-addressed form so its contract matches every
 * other app in the fleet.
 *
 * Contract (api-key-storage-conventions):
 *   - A key id is its segments joined by ".", lowercase; its environment variable
 *     is the segments uppercased, joined by "_", suffixed "_API_KEY". Stored ids
 *     are matched case-insensitively; non-conforming ids are ignored.
 *   - Resolution is source-first: every environment candidate (most→least
 *     specific) then every stored candidate. Environment wins; the more specific
 *     key wins within each source. `fallback: false` consults only the exact key.
 *     Every value is trimmed; blank counts as absent; an environment value is
 *     never written back.
 *   - The stored value is `obf:` + base64 of the reversed UTF-8 bytes; an untagged
 *     value is treated as plaintext. This is NOT encryption — the 0600 mode is the
 *     real protection.
 *   - On read: a group/world-readable file is warned about once and tightened to
 *     0600 (POSIX only); a corrupt/unreadable file is moved aside to a timestamped
 *     neighbour, warned, and treated as empty rather than throwing.
 */

const MARKER = "obf:";
const SECRETS_FILE_MODE = 0o600;
const ENFORCE_FILE_MODE = process.platform !== "win32";

const SEGMENT_RE = /^[a-z0-9]+$/;
const KEY_ID_RE = /^[a-z0-9]+(\.[a-z0-9]+)*$/;

interface ResolveOptions {
  fallback?: boolean;
}

interface ApiKeysFile {
  keys: Record<string, string>;
}

function assertSegments(segments: string[]): void {
  if (segments.length === 0 || !segments.every((s) => SEGMENT_RE.test(s))) {
    throw new Error(`Invalid api-key segments [${segments.join(", ")}]: each must match [a-z0-9]+`);
  }
}

// The prefixes of a segment list, most specific first: [a,b,c] → [[a,b,c],[a,b],[a]].
function prefixes(segments: string[]): string[][] {
  const out: string[][] = [];
  for (let n = segments.length; n >= 1; n--) out.push(segments.slice(0, n));
  return out;
}

function keyId(segments: string[]): string {
  return segments.join(".");
}

export function apiKeyEnvVar(segments: string[]): string {
  return `${segments.map((s) => s.toUpperCase()).join("_")}_API_KEY`;
}

function envValue(segments: string[]): string | null {
  const value = process.env[apiKeyEnvVar(segments)]?.trim();
  return value ? value : null;
}

// Obfuscation (NOT encryption): `obf:` + base64 of the reversed UTF-8 bytes.
function encodeApiKey(plain: string): string {
  return MARKER + Buffer.from(Buffer.from(plain, "utf8")).reverse().toString("base64");
}

// RFC 4648 base64 alphabet with optional padding — used to validate a marked
// payload canonically rather than trusting Buffer.from(..., "base64"), which
// silently ignores invalid characters and never throws on malformed input.
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

// An untagged value is plaintext, used as-is; a tagged value is decoded and
// validated canonically (charset + length%4 + decode-reencode equality) so a
// malformed payload can never silently turn into byte-garbage sent to the
// provider. Returns null when a marked value is malformed — the caller treats
// that as absent (never throws). An empty payload decodes to "", which the
// caller's non-empty check already treats as absent.
function decodeApiKey(stored: string): string | null {
  if (!stored.startsWith(MARKER)) return stored;
  const payload = stored.slice(MARKER.length);
  if (payload.length % 4 !== 0 || !BASE64_RE.test(payload)) return null;
  const decoded = Buffer.from(payload, "base64");
  if (decoded.toString("base64") !== payload) return null;
  return decoded.reverse().toString("utf8");
}

// Canonicalize the on-disk shape `{ keys: { id: value } }`: ids lowercased and
// matched against the id grammar, values kept only when strings.
function normalize(raw: unknown): ApiKeysFile {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { keys: {} };
  const rawKeys = (raw as { keys?: unknown }).keys;
  if (!rawKeys || typeof rawKeys !== "object" || Array.isArray(rawKeys)) return { keys: {} };
  const keys: Record<string, string> = {};
  for (const [id, value] of Object.entries(rawKeys as Record<string, unknown>)) {
    const canonical = id.toLowerCase();
    if (typeof value === "string" && KEY_ID_RE.test(canonical)) keys[canonical] = value;
  }
  return { keys };
}

export class ApiKeyStore {
  #chain: Promise<unknown> = Promise.resolve();
  #modeWarned = false;

  constructor(
    private readonly filePath: string,
    private readonly logger?: Logger,
  ) {}

  /** Whether a key resolves from either the environment or the stored file. */
  async has(segments: string[], options: ResolveOptions = {}): Promise<boolean> {
    return (await this.resolve(segments, options)) !== null;
  }

  /**
   * Resolve a key's plaintext value, source-first (environment then stored,
   * most→least specific), or null. `fallback: false` consults only the exact key.
   */
  async resolve(segments: string[], options: ResolveOptions = {}): Promise<string | null> {
    assertSegments(segments);
    const levels = options.fallback === false ? [segments] : prefixes(segments);

    for (const level of levels) {
      const fromEnv = envValue(level);
      if (fromEnv) return fromEnv;
    }
    return this.serialize(async () => {
      const all = await this.readFile();
      for (const level of levels) {
        const stored = all.keys[keyId(level)];
        if (typeof stored === "string") {
          const decoded = decodeApiKey(stored);
          if (decoded === null) {
            this.logger?.warn("stored api key value is malformed; treating as absent", {
              mod: "api-keys",
              keyId: keyId(level),
            });
            continue;
          }
          const key = decoded.trim();
          if (key) return key;
        }
      }
      return null;
    });
  }

  /** Persist a key (trimmed, obfuscated). A blank key clears it instead. */
  set(segments: string[], value: string): Promise<void> {
    assertSegments(segments);
    const trimmed = value.trim();
    return this.serialize(async () => {
      const all = await this.readFile();
      if (trimmed.length === 0) delete all.keys[keyId(segments)];
      else all.keys[keyId(segments)] = encodeApiKey(trimmed);
      await this.write(all);
    });
  }

  /** Remove the stored key. Any environment value is unaffected. */
  clear(segments: string[]): Promise<void> {
    assertSegments(segments);
    return this.serialize(async () => {
      const all = await this.readFile();
      if (keyId(segments) in all.keys) {
        delete all.keys[keyId(segments)];
        await this.write(all);
      }
    });
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#chain.then(fn, fn);
    this.#chain = next.catch(() => {});
    return next;
  }

  private async write(data: ApiKeysFile): Promise<void> {
    // not recorded: api-keys.json is a SECRET. It is never written through the managed-text choke point, so
    // no `afterWrite` hook is supplied here — a backup history that contained a credential would become
    // sensitive-at-rest in its entirety. Keeping secrets out is what keeps backups.sqlite3 no more sensitive
    // than ordinary user text; the 0600 mode below is where this file's protection lives (data-backup
    // conventions: "Secrets are never recorded").
    await atomicWriteFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: SECRETS_FILE_MODE });
  }

  // POSIX-only: runs on every read, per the api-key-storage-conventions — a
  // file widened mid-session must be re-tightened on the very next access, not
  // just once at startup. Only the WARNING is once-per-session; the chmod
  // itself is unconditional whenever the file is found group/world-readable,
  // so a file re-widened after the first warning still gets tightened back.
  private async warnIfInsecureMode(): Promise<void> {
    if (!ENFORCE_FILE_MODE) return;
    try {
      const stat = await fs.stat(this.filePath);
      if ((stat.mode & 0o077) !== 0) {
        if (!this.#modeWarned) {
          this.#modeWarned = true;
          const octal = (stat.mode & 0o777).toString(8).padStart(3, "0");
          this.logger?.warn("api key file is readable beyond the owner; tightening to 0600", {
            mod: "api-keys",
            apiKeysPath: this.filePath,
            mode: octal,
          });
        }
        await fs.chmod(this.filePath, SECRETS_FILE_MODE).catch(() => {});
      }
    } catch {
      // No file yet, or stat failed — nothing to warn about.
    }
  }

  private async readFile(): Promise<ApiKeysFile> {
    await this.warnIfInsecureMode();
    let text: string;
    try {
      text = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { keys: {} };
      const movedTo = await this.moveAsideInvalid();
      this.logger?.warn("api key file was unreadable; set aside and treating as empty", {
        mod: "api-keys",
        apiKeysPath: this.filePath,
        movedTo,
        err: error,
      });
      return { keys: {} };
    }
    try {
      return normalize(JSON.parse(text));
    } catch (error) {
      const movedTo = await this.moveAsideInvalid();
      this.logger?.warn("api key file was not valid JSON; set aside and treating as empty", {
        mod: "api-keys",
        apiKeysPath: this.filePath,
        movedTo,
        err: error,
      });
      return { keys: {} };
    }
  }

  // Move the unreadable file aside to a timestamped neighbour (handled once, not
  // re-flagged on every read), returning the new path or null if it could not be
  // moved. Best-effort: a failed move never blocks resolution.
  private async moveAsideInvalid(): Promise<string | null> {
    // <stem>-<timestamp>.invalid, alongside the source file (derived-filename grammar).
    const movedTo = path.join(path.dirname(this.filePath), `${path.parse(this.filePath).name}-${utcStamp()}.invalid`);
    try {
      await fs.rename(this.filePath, movedTo);
      return movedTo;
    } catch {
      return null;
    }
  }
}
