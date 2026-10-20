/**
 * Version watchdog probe (CI).
 *
 * Tries the known version ladder (plus a few minor bumps above `latest`)
 * against the real LibreLinkUp login endpoint and records the highest
 * working version in `llu-versions.json`. Consumers pick it up at runtime
 * via `resolveLluVersionAsync()` — no library release needed.
 *
 * Usage: bun scripts/check-llu-versions.ts
 * Needs: LIBRE_LINK_EMAIL, LIBRE_LINK_PASSWORD env vars.
 * Exits 0 always (a failed probe must not fail the workflow); prints result.
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

async function tryLogin(email: string, password: string, version: string): Promise<boolean> {
  const client = new LibreLinkClient({
    email,
    password,
    lluVersion: version,
    autoUpdateVersion: false,
    cache: false,
  });
  try {
    await client.login();
    return true;
  } catch (err) {
    console.log(`  ${version}: FAIL — ${(err as Error).message.slice(0, 160)}`);
    return false;
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
for (const v of candidates) {
  if (await tryLogin(email, password, v)) {
    console.log(`  ${v}: OK`);
    working.push(v);
  }
  await sleep(5000); // be gentle with Abbott
}

if (working.length === 0) {
  console.log("No working version found — leaving llu-versions.json untouched.");
  process.exit(0);
}

const best = working.sort(cmp).reverse()[0];
if (best === current.latest) {
  console.log(`Latest ${best} still works — nothing to update.`);
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
