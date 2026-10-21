/**
 * Version watchdog probe (CI).
 *
 * Tries the known version ladder (plus a few minor bumps above `latest`)
 * against the real LibreLinkUp login endpoint and records the highest
 * working version in `llu-versions.json`. Consumers pick it up at runtime
 * via `resolveLluVersionAsync()` — no library release needed.
 *
 * Failures are CLASSIFIED so a broken watchdog is never silent:
 * - `account` (bad credentials / Terms&Privacy pending): version-independent,
 *   abort immediately and fail the workflow — a human must fix the sentinel
 *   account or the secrets.
 * - `version-blocked` (400 RequiredHeaderMissing / 403 fingerprint block):
 *   expected signal, keep probing the rest of the ladder.
 * - `transient` (rate limits, network): leave everything untouched, exit 0.
 * - all versions version-blocked and none working: fail loudly — Abbott
 *   likely requires a brand-new app version the ladder doesn't know yet.
 *
 * Usage: bun scripts/check-llu-versions.ts
 * Needs: LIBRE_LINK_EMAIL, LIBRE_LINK_PASSWORD env vars.
 */
import { LibreLinkClient } from "../src/client";
import { BUNDLED_LADDER } from "../src/version-resolver";

const FILE = new URL("../llu-versions.json", import.meta.url);

interface VersionsFile {
  latest: string;
  product: string;
  ladder: string[];
  regions?: string[];
  updatedAt?: string;
  source?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

function cmp(a: string, b: string): number {
  const pa = parseVersion(a) ?? [0, 0, 0];
  const pb = parseVersion(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** A few minor bumps above latest, in case Abbott shipped a new app. */
function upwardProbes(latest: string, n = 3): string[] {
  const p = parseVersion(latest);
  if (!p) return [];
  const out: string[] = [];
  for (let i = 1; i <= n; i++) out.push(`${p[0]}.${p[1] + i}.0`);
  return out;
}

type FailureKind = "account" | "version-blocked" | "transient" | "unknown";

interface ProbeResult {
  ok: boolean;
  kind?: FailureKind;
  detail?: string;
}

function errorf(msg: string): void {
  // GitHub Actions annotation when running in CI, plain log otherwise.
  if (process.env.GITHUB_ACTIONS) console.log(`::error::${msg}`);
  else console.error(`ERROR: ${msg}`);
}

function notice(msg: string): void {
  if (process.env.GITHUB_ACTIONS) console.log(`::notice::${msg}`);
  else console.log(msg);
}

function summary(line: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    require("node:fs").appendFileSync(file, line + "\n");
  } catch {
    // Non-fatal: summaries are best-effort.
  }
}

/** Classify a login failure so signal (fingerprint block) never looks like noise. */
function classifyLoginError(message: string): FailureKind {
  const m = message.toLowerCase();
  if (
    /invalid credentials|bad credentials/.test(m) ||
    /account action required|terms of use|privacy policy/.test(m)
  ) {
    return "account";
  }
  if (/too many requests|429|430|rate.limit|timed out|timeout|network|fetch failed|econn|enotfound|socket/.test(m)) {
    return "transient";
  }
  if (
    /rejected client version|requiredheader|minimumversion|status 400|status 403|forbidden|version/.test(m)
  ) {
    return "version-blocked";
  }
  return "unknown";
}

async function tryLogin(email: string, password: string, version: string): Promise<ProbeResult> {
  const client = new LibreLinkClient({
    email,
    password,
    lluVersion: version,
    autoUpdateVersion: false,
    cache: false,
  });
  try {
    await client.login();
    return { ok: true };
  } catch (err) {
    const detail = (err as Error).message.slice(0, 200);
    const kind = classifyLoginError(detail);
    console.log(`  ${version}: FAIL [${kind}] — ${detail}`);
    return { ok: false, kind, detail };
  }
}

const email = process.env.LIBRE_LINK_EMAIL;
const password = process.env.LIBRE_LINK_PASSWORD;
if (!email || !password) {
  console.log("No credentials (LIBRE_LINK_EMAIL/LIBRE_LINK_PASSWORD) — skipping probe.");
  process.exit(0);
}

const current = (await Bun.file(FILE).json()) as VersionsFile;
const candidates = [...new Set([...upwardProbes(current.latest), current.latest, ...current.ladder, ...BUNDLED_LADDER])]
  .sort(cmp)
  .reverse()
  .slice(0, 8);

console.log(`Probing ${candidates.length} candidate versions (highest first)…`);
const working: string[] = [];
const failures: { version: string; kind: FailureKind; detail?: string }[] = [];
for (const v of candidates) {
  const r = await tryLogin(email, password, v);
  if (r.ok) {
    console.log(`  ${v}: OK`);
    working.push(v);
  } else {
    failures.push({ version: v, kind: r.kind!, detail: r.detail });
    // Account problems are version-independent: every other version would
    // fail the same way. Abort now and shout — probing more only burns
    // the sentinel account against Abbott's rate limits.
    if (r.kind === "account") {
      errorf(
        `Sentinel account problem on ${v}: ${r.detail}. ` +
          `Fix the account (app login / accept Terms) or the LIBRE_LINK_EMAIL/LIBRE_LINK_PASSWORD secrets; llu-versions.json left untouched.`
      );
      summary(`❌ version-watch: sentinel account problem (${r.detail}) — file untouched.`);
      process.exit(1);
    }
  }
  await sleep(5000); // be gentle with Abbott
}

if (working.length === 0) {
  const kinds = [...new Set(failures.map((f) => f.kind))];
  if (kinds.every((k) => k === "version-blocked")) {
    errorf(
      `All ${failures.length} probed versions blocked by Abbott (${failures.map((f) => f.version).join(", ")}). ` +
        `Abbott likely requires a brand-new app version: check the LibreLinkUp release, extend the ladder, re-run.`
    );
    summary(`❌ version-watch: ALL versions blocked — manual ladder update needed.`);
    process.exit(1);
  }
  notice(
    `No working version (failures: ${kinds.join(", ")}) — likely transient Abbott/CI issue; llu-versions.json left untouched.`
  );
  summary(`⚠️ version-watch: no working version (${kinds.join(", ")}) — file untouched, will retry on schedule.`);
  process.exit(0);
}

const best = working.sort(cmp).reverse()[0];
if (best === current.latest) {
  console.log(`Latest ${best} still works — nothing to update.`);
  summary(`✅ version-watch: latest ${best} still works — no change.`);
  process.exit(0);
}

const ladder = [...new Set([best, ...working.sort(cmp).reverse(), ...current.ladder, ...BUNDLED_LADDER])].slice(0, 8);
const next: VersionsFile = {
  ...current,
  latest: best,
  ladder,
  updatedAt: new Date().toISOString(),
  source: "version-watch.yml",
};
await Bun.write(FILE, JSON.stringify(next, null, 2) + "\n");
console.log(`Updated llu-versions.json: latest ${current.latest} → ${best}`);
summary(`🔄 version-watch: latest ${current.latest} → ${best}.`);
