import fs, { type FileHandle } from "node:fs/promises";
import { FORMAT_VERSIONS, parseVersionedJson, UNMARKED_EARLIER_FORM, versionedJson, type VersionedJsonRead } from "@shared/format-versions";
import { atomicWriteFile } from "@adapters/atomic-file";
import { setAsideStore, StoreNotWritableError, type StoreLeftReason } from "./json-store";
import type { Logger } from "@shared/types/log";

/**
 * API key storage and resolution — the secret store at ~/.fotoready/api-keys.json,
 * separate from settings. This is the fleet api-key-storage-conventions realized
 * for fotoready.
 *
 * fotoready uses a single key today (`"gemini"` → GEMINI_API_KEY), but the
 * store is the generic, id-addressed form so its contract matches every other
 * app in the fleet.
 *
 * Contract (api-key-storage-conventions):
 *   - A key id is one flat lowercase string (`gemini`, or `provider.purpose` such
 *     as `gemini.vision`); its environment variable is the id uppercased, dots to
 *     underscores, suffixed "_API_KEY". Stored ids are matched case-insensitively;
 *     non-conforming ids are ignored.
 *   - Resolution consults exactly two places for the exact id: the environment
 *     variable, then the stored value. There is no fallback from a longer id to a
 *     shorter one (`gemini.vision` never resolves to `gemini`). Every value is
 *     trimmed; blank counts as absent; an environment value is never written back.
 *   - The stored value is `obf:` + base64 of the reversed UTF-8 bytes; an untagged
 *     value is treated as plaintext. This is NOT encryption — the 0600 mode is the
 *     real protection.
 *   - On read: a group/world-readable file is warned about once and tightened to
 *     0600 (POSIX only).
 *   - Whether the session may write the file is decided once, by its first read
 *     (store-recovery-conventions; developer decisions): malformed content is moved
 *     aside to a timestamped neighbour and treated as empty; a file that cannot be
 *     read, cannot be moved aside, or was written by a newer build reads as empty, is
 *     warned about once and left exactly as it is, and storing a key throws
 *     {@link StoreNotWritableError}. v0.1.0's unmarked file is read as it is.
 */

const MARKER = "obf:";
const SECRETS_FILE_MODE = 0o600;
const ENFORCE_FILE_MODE = process.platform !== "win32";

const KEY_ID_RE = /^[a-z0-9]+(\.[a-z0-9]+)*$/;

interface ApiKeysFile {
  keys: Record<string, string>;
}

function assertKeyId(id: string): void {
  if (!KEY_ID_RE.test(id)) {
    throw new Error(`Invalid api-key id "${id}": must match [a-z0-9]+(.[a-z0-9]+)*`);
  }
}

export function apiKeyEnvVar(id: string): string {
  return `${id.toUpperCase().replaceAll(".", "_")}_API_KEY`;
}

function envValue(id: string): string | null {
  const value = process.env[apiKeyEnvVar(id)]?.trim();
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
function normalize(raw: unknown): ApiKeysFile | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rawKeys = (raw as { keys?: unknown }).keys;
  if (!rawKeys || typeof rawKeys !== "object" || Array.isArray(rawKeys)) return null;
  const keys: Record<string, string> = {};
  for (const [id, value] of Object.entries(rawKeys as Record<string, unknown>)) {
    const canonical = id.toLowerCase();
    if (typeof value === "string" && KEY_ID_RE.test(canonical)) keys[canonical] = value;
  }
  return { keys };
}

export class ApiKeyStore {
  #chain: Promise<unknown> = Promise.resolve();
  #modeInspectionWarned = false;
  #modeRepairWarned = false;
  #modeWarned = false;
  /** Undefined until the first read; then null while writable, or why the file is left as it is. */
  #left: StoreLeftReason | null | undefined = undefined;

  constructor(
    private readonly filePath: string,
    private readonly logger?: Logger,
  ) {}

  /** Whether a key resolves from either the environment or the stored file. */
  async has(id: string): Promise<boolean> {
    return (await this.resolve(id)) !== null;
  }

  /**
   * Resolve a key's plaintext value for the exact id: the environment variable,
   * then the stored value, or null. There is no fallback to any other id.
   */
  async resolve(id: string): Promise<string | null> {
    assertKeyId(id);
    const fromEnv = envValue(id);
    if (fromEnv) return fromEnv;
    return this.peek(id);
  }

  /** Return the stored plaintext value for the exact id, ignoring the environment. */
  peek(id: string): Promise<string | null> {
    assertKeyId(id);
    return this.serialize(async () => {
      const all = await this.readFile();
      const stored = all.keys[id];
      if (typeof stored !== "string") return null;
      const decoded = decodeApiKey(stored);
      if (decoded === null) {
        this.logger?.warn("stored api key value is malformed; treating as absent", {
          mod: "api-keys",
          keyId: id,
        });
        return null;
      }
      const key = decoded.trim();
      return key ? key : null;
    });
  }

  /** Persist a key (trimmed, obfuscated). A blank key clears it instead. */
  set(id: string, value: string): Promise<void> {
    assertKeyId(id);
    const trimmed = value.trim();
    return this.serialize(async () => {
      const all = await this.readFile();
      if (this.#left) throw new StoreNotWritableError(this.filePath, this.#left);
      if (trimmed.length === 0) delete all.keys[id];
      else all.keys[id] = encodeApiKey(trimmed);
      await this.write(all);
    });
  }

  /** Remove the stored key. Any environment value is unaffected. */
  clear(id: string): Promise<void> {
    assertKeyId(id);
    return this.serialize(async () => {
      // A file left as it is reads as holding no key, so there is nothing to clear and nothing is written.
      const all = await this.readFile();
      if (id in all.keys) {
        delete all.keys[id];
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
    // not recorded: api-keys.json is a secret, kept out of the history so its lifetime is not extended
    // there (data-backup-conventions); the 0600 mode below is where this file's protection lives.
    await atomicWriteFile(this.filePath, versionedJson(FORMAT_VERSIONS.apiKeys, { keys: data.keys }), { mode: SECRETS_FILE_MODE });
  }

  // POSIX-only: runs on every read, per the api-key-storage-conventions — a
  // file widened mid-session must be re-tightened on the very next access, not
  // just once at startup. Each warning kind is once-per-session; the chmod itself
  // is unconditional whenever the file is found group/world-readable, so a file
  // re-widened after the first warning still gets tightened back.
  private async warnIfInsecureMode(file: FileHandle): Promise<void> {
    if (!ENFORCE_FILE_MODE) return;
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await file.stat();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !this.#modeInspectionWarned) {
        this.#modeInspectionWarned = true;
        this.logger?.warn("could not inspect api key file permissions", {
          mod: "api-keys",
          apiKeysPath: this.filePath,
          err: error,
        });
      }
      return;
    }
    if ((stat.mode & 0o077) === 0) return;
    if (!this.#modeWarned) {
      this.#modeWarned = true;
      const octal = (stat.mode & 0o777).toString(8).padStart(3, "0");
      this.logger?.warn("api key file is readable beyond the owner; tightening to 0600", {
        mod: "api-keys",
        apiKeysPath: this.filePath,
        mode: octal,
      });
    }
    try {
      await file.chmod(SECRETS_FILE_MODE);
    } catch (error) {
      if (!this.#modeRepairWarned) {
        this.#modeRepairWarned = true;
        this.logger?.warn("could not tighten api key file permissions to 0600", {
          mod: "api-keys",
          apiKeysPath: this.filePath,
          err: error,
        });
      }
    }
  }

  private async readFile(): Promise<ApiKeysFile> {
    if (this.#left) return { keys: {} };
    let read: VersionedJsonRead;
    try {
      const file = await fs.open(this.filePath, "r");
      try {
        read = parseVersionedJson(await file.readFile("utf8"), FORMAT_VERSIONS.apiKeys, UNMARKED_EARLIER_FORM);
        if (read.kind === "current" && normalize(read.body)) await this.warnIfInsecureMode(file);
      } finally {
        await file.close().catch((error) => this.logger?.warn("could not close inspected api key file", { mod: "api-keys", apiKeysPath: this.filePath, err: error }));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.loaded({ keys: {} });
      // An access failure never moves the file; it is reported as such, not as corruption.
      return this.leave("unreadable", "api key file could not be read; treating as empty and leaving it as it is for this session", { err: error });
    }
    if (read.kind === "newer") {
      return this.leave("newer", "api key file was written by a newer FotoReady; treating as empty and leaving it as it is", { formatVersion: read.found });
    }
    const normalized = read.kind === "current" ? normalize(read.body) : null;
    if (normalized) return this.loaded(normalized);
    // A session that already decided to write the file meets malformed content only through an
    // unsupported outside edit; it reads as empty and the next save replaces it.
    if (this.#left === null) {
      this.logger?.warn("api key file changed outside FotoReady and could not be read; treating as empty", { mod: "api-keys", apiKeysPath: this.filePath });
      return { keys: {} };
    }
    const detail = read.kind === "invalid" ? { err: read.error } : {};
    let movedTo: string;
    try {
      // not recorded: both the live file and this corrupt quarantine contain secrets.
      movedTo = await setAsideStore(this.filePath);
    } catch (moveError) {
      return this.leave("unreadable", "api key file was not valid and could not be set aside; treating as empty and leaving it as it is for this session", { ...detail, moveErr: moveError });
    }
    this.logger?.warn("api key file was not valid JSON or had an unexpected shape; set aside and treating as empty", {
      mod: "api-keys",
      apiKeysPath: this.filePath,
      movedTo,
      ...detail,
    });
    return this.loaded({ keys: {} });
  }

  /** The first read decides the session may write the file. */
  private loaded(keys: ApiKeysFile): ApiKeysFile {
    this.#left ??= null;
    return keys;
  }

  /** Leaves the file exactly as it is for the session; only the first read can decide this. */
  private leave(reason: StoreLeftReason, warning: string, detail: Record<string, unknown>): ApiKeysFile {
    if (this.#left === undefined) {
      this.#left = reason;
      this.logger?.warn(warning, { mod: "api-keys", apiKeysPath: this.filePath, ...detail });
    } else {
      this.logger?.warn("api key file could not be read; treating as empty", { mod: "api-keys", apiKeysPath: this.filePath, ...detail });
    }
    return { keys: {} };
  }
}
