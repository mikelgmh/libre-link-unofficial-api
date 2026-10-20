import { expect, test, describe, beforeEach } from "bun:test";
import {
  __resetVersionState,
  apiUrlForRegion,
  backoffDelay,
  buildVersionLadder,
  isRateLimited,
  isTokenError,
  isVersionBlockedError,
  markVersionWorking,
  resolveLluVersionAsync,
  resolveLluVersionSync,
} from "../src/version-resolver";

describe("version-resolver", () => {
  beforeEach(() => {
    __resetVersionState();
  });

  test("apiUrlForRegion maps regions, defaults to global", () => {
    expect(apiUrlForRegion()).toBe("https://api.libreview.io");
    expect(apiUrlForRegion(null)).toBe("https://api.libreview.io");
    expect(apiUrlForRegion("eu")).toBe("https://api-eu.libreview.io");
    expect(apiUrlForRegion("EU")).toBe("https://api-eu.libreview.io");
    expect(apiUrlForRegion("unknown")).toBe("https://api.libreview.io");
  });

  test("isTokenError: 401 always, 403 only with token wording", () => {
    expect(isTokenError(401, "whatever")).toBe(true);
    expect(isTokenError(403, "Malformed JWT")).toBe(true);
    expect(isTokenError(403, "token expired")).toBe(true);
    expect(isTokenError(403, "Forbidden")).toBe(false);
    expect(isTokenError(403, '{"status":1,"data":{}}')).toBe(false);
    expect(isTokenError(200, "token expired")).toBe(false);
    expect(isTokenError(400, "Missing JWT")).toBe(true);
    expect(isTokenError(400, "bad request")).toBe(false);
  });

  test("isVersionBlockedError: bare 403, never 401", () => {
    expect(isVersionBlockedError(403, "Forbidden")).toBe(true);
    expect(isVersionBlockedError(403, '{"status":1}')).toBe(true);
    expect(isVersionBlockedError(403, "token expired")).toBe(false);
    expect(isVersionBlockedError(401, "x")).toBe(false);
    expect(isVersionBlockedError(429, "x")).toBe(false);
  });

  test("isRateLimited covers 429 and 430", () => {
    expect(isRateLimited(429)).toBe(true);
    expect(isRateLimited(430)).toBe(true);
    expect(isRateLimited(403)).toBe(false);
  });

  test("resolveLluVersionSync prefers explicit, then last-working, then bundled", () => {
    expect(resolveLluVersionSync()).toBe("4.16.0");
    expect(resolveLluVersionSync("9.9.9")).toBe("9.9.9");
    expect(resolveLluVersionSync("bogus")).toBe("4.16.0");
    markVersionWorking("4.17.0");
    expect(resolveLluVersionSync()).toBe("4.17.0");
    expect(resolveLluVersionSync("9.9.9")).toBe("9.9.9");
  });

  test("resolveLluVersionAsync uses remote file and caches it", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(
        JSON.stringify({ latest: "5.0.0", product: "llu.android", ladder: ["5.0.0", "4.16.0"] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;

    const v = await resolveLluVersionAsync({ fetchImpl });
    expect(v).toBe("5.0.0");
    // Second call hits the cache, no extra fetch.
    expect(await resolveLluVersionAsync({ fetchImpl })).toBe("5.0.0");
    expect(calls).toBe(1);
    // Sync resolution now sees the remote value too.
    expect(resolveLluVersionSync()).toBe("5.0.0");
  });

  test("resolveLluVersionAsync falls back silently when remote fails", async () => {
    const failing = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    expect(await resolveLluVersionAsync({ fetchImpl: failing })).toBe("4.16.0");
    const hanging = (() => new Promise(() => {})) as unknown as typeof fetch;
    expect(await resolveLluVersionAsync({ fetchImpl: hanging, timeoutMs: 20 })).toBe("4.16.0");
  });

  test("resolveLluVersionAsync rejects malformed remote payloads", async () => {
    const bad = (async () =>
      new Response(JSON.stringify({ latest: "not-a-version" }), { status: 200 })) as typeof fetch;
    expect(await resolveLluVersionAsync({ fetchImpl: bad })).toBe("4.16.0");
  });

  test("buildVersionLadder dedups and orders explicit > working > bundled", () => {
    markVersionWorking("4.17.0");
    const ladder = buildVersionLadder("9.9.9");
    expect(ladder[0]).toBe("9.9.9");
    expect(ladder[1]).toBe("4.17.0");
    expect(new Set(ladder).size).toBe(ladder.length);
    expect(ladder).toContain("4.16.0");
  });

  test("backoffDelay grows with jitter and caps", () => {
    const d0 = backoffDelay(0);
    const d2 = backoffDelay(2);
    expect(d0).toBeGreaterThan(0);
    expect(d0).toBeLessThanOrEqual(2000);
    expect(d2).toBeGreaterThan(d0);
    expect(backoffDelay(99)).toBeLessThanOrEqual(30000 + 1);
  });
});
