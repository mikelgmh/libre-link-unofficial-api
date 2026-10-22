/**
 * Minimal deterministic fetch stub for unit tests (offline).
 * bun-bagel can't match headerless mocks against requests that carry
 * headers, so these specs stub `globalThis.fetch` directly instead.
 */
export interface StubResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface StubRoute {
  urlContains: string;
  method?: string;
  /** Fixed list consumed in order, or a function per call index. */
  responses: StubResponse[] | ((call: number) => StubResponse);
}

export interface FetchCall {
  url: string;
  method: string;
  /** LibreLinkUp client fingerprint sent with the request (if any). */
  version?: string;
  product?: string;
  authorization?: string;
}

const originalFetch = globalThis.fetch;
const calls: FetchCall[] = [];

export function stubFetch(routes: StubRoute[]): void {
  const counters = new Map<StubRoute, number>();
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({
      url,
      method,
      version: headers?.["version"],
      product: headers?.["product"],
      authorization: headers?.Authorization ?? headers?.authorization,
    });
    const route = routes.find(
      (r) => url.includes(r.urlContains) && (r.method ?? "GET").toUpperCase() === method
    );
    if (!route) {
      return new Response(JSON.stringify({ status: 404, message: "no stub route" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    const n = counters.get(route) ?? 0;
    counters.set(route, n + 1);
    const r: StubResponse =
      typeof route.responses === "function"
        ? route.responses(n)
        : route.responses[Math.min(n, route.responses.length - 1)];
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json", ...(r.headers ?? {}) },
    });
  }) as typeof fetch;
}

export function fetchCalls(): FetchCall[] {
  return [...calls];
}

export function restoreFetch(): void {
  globalThis.fetch = originalFetch;
  calls.length = 0;
}
