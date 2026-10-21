/**
 * Self-updating LibreLinkUp client fingerprint.
 *
 * Abbott periodically blocks old `llu.*` app versions (HTTP 403, and since
 * late 2025 also HTTP 400 `RequiredHeaderMissing` on `/llu/auth/login`).
 * This module keeps the emulated version fresh without shipping a new
 * library release:
 *
 *   explicit option > last version that worked in this process >
 *   remote `llu-versions.json` (cached, short timeout) > bundled default.
 *
 * The remote file lives in this same repo and is kept fresh by
 * `.github/workflows/version-watch.yml`, so bumping the version for every
 * consumer is a data-only commit — no code release needed.
 */

export interface LluVersionInfo {
  latest: string;
  product: string;
  ladder: string[];
  regions?: string[];
  updatedAt?: string;
  source?: string;
}

export interface ResolveLluVersionOptions {
  /** Explicit pin — always wins. */
  explicit?: string;
  /** Fetch the remote file. Default true. */
  autoUpdate?: boolean;
  /** Override the remote URL (tests / mirrors). */
  versionUrl?: string;
  /** Remote fetch timeout. Default 3000ms. */
  timeoutMs?: number;
  /** Fetch implementation (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /** Ignore the TTL cache and refetch the remote file now. Default false. */
  forceRefresh?: boolean;
}

export const DEFAULT_LLU_VERSION = "4.19.0";
export const DEFAULT_PRODUCT = "llu.android";
/** Global endpoint — Abbott redirects to the account's region on login. */
export const DEFAULT_API_URL = "https://api.libreview.io";
export const BUNDLED_LADDER = ["4.19.0", "4.18.0", "4.17.0", "4.16.0", "4.12.0", "4.7.0"];
export const REMOTE_VERSION_URL =
  "https://raw.githubusercontent.com/mikelgmh/libre-link-unofficial-api/main/llu-versions.json";
/** How long a fetched remote file is trusted before refetching. */
export const REMOTE_TTL_MS = 6 * 60 * 60 * 1000;

export const BUNDLED_VERSION_INFO: LluVersionInfo = {
  latest: DEFAULT_LLU_VERSION,
  product: DEFAULT_PRODUCT,
  ladder: [...BUNDLED_LADDER],
};

const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** Region short-code → API host. `global`/undefined is the entry point. */
export const REGION_HOSTS: Record<string, string> = {
  global: "api.libreview.io",
  eu: "api-eu.libreview.io",
  us: "api-us.libreview.io",
  de: "api-de.libreview.io",
  fr: "api-fr.libreview.io",
  jp: "api-jp.libreview.io",
  ap: "api-ap.libreview.io",
  au: "api-au.libreview.io",
  ae: "api-ae.libreview.io",
  ca: "api-ca.libreview.io",
  la: "api-la.libreview.io",
};

export function apiUrlForRegion(region?: string | null): string {
  const key = (region ?? "global").toLowerCase();
  const host = REGION_HOSTS[key] ?? REGION_HOSTS.global;
  return `https://${host}`;
}

// ── Module-level shared state (all clients in this process benefit) ──

let lastWorkingVersion: string | null = null;
let remoteCache: { info: LluVersionInfo; fetchedAt: number } | null = null;
let remoteInflight: Promise<LluVersionInfo | null> | null = null;

/** Remember a version that just worked — preferred from now on. */
export function markVersionWorking(version: string): void {
  if (VERSION_RE.test(version)) lastWorkingVersion = version;
}

/** For tests only. */
export function __resetVersionState(): void {
  lastWorkingVersion = null;
  remoteCache = null;
  remoteInflight = null;
}

/** Synchronous best-known version. Never touches the network. */
export function resolveLluVersionSync(explicit?: string | null): string {
  if (explicit && VERSION_RE.test(explicit)) return explicit;
  if (lastWorkingVersion) return lastWorkingVersion;
  if (remoteCache && isValidVersionInfo(remoteCache.info)) return remoteCache.info.latest;
  return BUNDLED_VERSION_INFO.latest;
}

function isValidVersionInfo(v: unknown): v is LluVersionInfo {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.latest !== "string" || !VERSION_RE.test(o.latest)) return false;
  if (typeof o.product !== "string" || !o.product) return false;
  if (!Array.isArray(o.ladder)) return false;
  return true;
}

function sanitizeVersionInfo(v: LluVersionInfo): LluVersionInfo {
  const ladder = [...(v.ladder ?? [])]
    .filter((x): x is string => typeof x === "string" && VERSION_RE.test(x))
    .slice(0, 10);
  if (!ladder.includes(v.latest)) ladder.unshift(v.latest);
  return { latest: v.latest, product: v.product, ladder };
}

async function fetchRemoteVersionInfo(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<LluVersionInfo | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Race against the timeout: custom fetchImpls may ignore AbortSignal.
    const res = await Promise.race([
      fetchImpl(url, {
        signal: ctrl.signal,
        headers: { accept: "application/json", "cache-control": "no-cache" },
      }),
      sleep(timeoutMs).then(() => null),
    ]);
    if (!res || !res.ok) return null;
    const json = (await res.json()) as unknown;
    if (!isValidVersionInfo(json)) return null;
    return sanitizeVersionInfo(json);
  } catch {
    return null; // offline / timeout / DNS — never fatal
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-known version, refreshing from the remote file when stale.
 * Never throws and never blocks longer than `timeoutMs` — falls back
 * to the synchronous value on any failure.
 */
export async function resolveLluVersionAsync(
  opts: ResolveLluVersionOptions = {}
): Promise<string> {
  const {
    explicit,
    autoUpdate = true,
    versionUrl = REMOTE_VERSION_URL,
    timeoutMs = 3000,
    fetchImpl = fetch,
    forceRefresh = false,
  } = opts;
  if (explicit && VERSION_RE.test(explicit)) return explicit;
  if (lastWorkingVersion && !forceRefresh) return lastWorkingVersion;
  if (!autoUpdate) return resolveLluVersionSync(explicit);
  if (
    !forceRefresh &&
    remoteCache &&
    Date.now() - remoteCache.fetchedAt < REMOTE_TTL_MS
  ) {
    return remoteCache.info.latest;
  }
  try {
    remoteInflight ??= fetchRemoteVersionInfo(versionUrl, timeoutMs, fetchImpl).then(
      (info) => {
        if (info) remoteCache = { info, fetchedAt: Date.now() };
        return info;
      }
    );
    const info = await remoteInflight;
    return info?.latest ?? resolveLluVersionSync(explicit);
  } catch {
    return resolveLluVersionSync(explicit);
  } finally {
    remoteInflight = null;
  }
}

/** Ordered candidates for the version-ladder retry. Duplicates removed. */
export function buildVersionLadder(
  explicit?: string | null,
  remoteLatest?: string | null
): string[] {
  const out: string[] = [];
  const push = (v: string | null | undefined) => {
    if (typeof v === "string" && VERSION_RE.test(v) && !out.includes(v)) out.push(v);
  };
  push(explicit);
  push(lastWorkingVersion);
  push(remoteLatest ?? remoteCache?.info.latest);
  for (const v of BUNDLED_LADDER) push(v);
  return out;
}

// ── Error classification (Abbott HTTP statuses) ──

const TOKEN_WORDS = [
  "token",
  "jwt",
  "unauthorized",
  "unauthenticated",
  "authentication",
  "expired",
  "invalid token",
  "access denied",
  "malformed jwt",
  "missing jwt",
  "login",
  "session",
];

function mentionsToken(message: string): boolean {
  const m = (message ?? "").toLowerCase();
  return TOKEN_WORDS.some((w) => m.includes(w));
}

/**
 * Body signatures Abbott returns when it rejects the client fingerprint
 * (as opposed to the credentials/session). Observed in the wild:
 * `RequiredHeaderMissing` (HTTP 400 on /llu/auth/login since ~2025),
 * `minimumVersion` payloads, and plain version complaints.
 */
const FINGERPRINT_WORDS = [
  "requiredheader",
  "required header",
  "minimumversion",
  "minimum version",
  "client version",
  "app version",
  "version not allowed",
  "unsupported version",
  "invalid version",
  "outdated version",
  "version too old",
  "update required",
  "upgrade required",
];

function mentionsFingerprint(message: string): boolean {
  const m = (message ?? "").toLowerCase();
  return FINGERPRINT_WORDS.some((w) => m.includes(w));
}

/** True when the response looks like an auth/token problem (re-login may help). */
export function isTokenError(statusCode: number, message: string): boolean {
  if (statusCode === 401) return true;
  // A 403 only counts as a token problem when the body says so —
  // Abbott also returns 403 for blocked app versions, WAF and region issues.
  if (statusCode === 403 || (statusCode === 400 && mentionsToken(message))) {
    return mentionsToken(message);
  }
  return false;
}

/**
 * True when Abbott rejected the request but it does NOT look like a token
 * problem — the classic signature of a blocked/outdated `version` header
 * (or WAF/region block). Retrying with a newer client version may help;
 * blindly re-logging in will not.
 *
 * Abbott answers fingerprint blocks with HTTP 403 (bare/blocked version)
 * and — since ~2025 on `/llu/auth/login` — with HTTP 400
 * `RequiredHeaderMissing`, so both are covered. Token wording always wins:
 * a 400/403 that mentions tokens is a session problem, not a version one.
 */
export function isVersionBlockedError(statusCode: number, message: string): boolean {
  if (mentionsToken(message)) return false;
  if (statusCode === 403) return true;
  if (statusCode === 400) return mentionsFingerprint(message);
  return false;
}

/** Abbott rate limits: 429 standard, 430 observed in the wild. */
export function isRateLimited(statusCode: number): boolean {
  return statusCode === 429 || statusCode === 430;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Exponential backoff with jitter: ~1s, ~4s, ~16s … capped at 30s. */
export function backoffDelay(attempt: number): number {
  const exp = 1000 * 4 ** attempt;
  return Math.min(30_000, Math.round(exp * (0.7 + Math.random() * 0.6)));
}
