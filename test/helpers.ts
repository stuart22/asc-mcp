// Shared test helpers: a fake fetch that records requests and returns canned JSON.
export type Recorded = { url: URL; init: RequestInit | undefined };

export type Route = (url: URL) => { status?: number; body: unknown } | undefined;

export function fakeFetch(...routes: Route[]): typeof fetch & { requests: Recorded[] } {
  const requests: Recorded[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    requests.push({ url, init });
    for (const route of routes) {
      const r = route(url);
      if (r) {
        return new Response(JSON.stringify(r.body), {
          status: r.status ?? 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response(JSON.stringify({ errors: [{ status: "404", code: "NOT_FOUND", title: "Not found", detail: `No fake route for ${url.pathname}` }] }), {
      status: 404,
    });
  }) as typeof fetch & { requests: Recorded[] };
  fn.requests = requests;
  return fn;
}

/** Route matching a path exactly (query ignored). */
export function on(pathname: string, body: unknown, status = 200): Route {
  return (url) => (url.pathname === pathname ? { status, body } : undefined);
}

export const staticTokens = { getToken: async () => "TEST.TOKEN.VALUE" };

import { AscClient } from "../src/asc/client.ts";
import { AppResolver } from "../src/asc/resolveApp.ts";
import type { ToolDeps } from "../src/format/common.ts";

export const TEST_NOW = Date.parse("2026-11-05T14:25:00Z");
export const ACME = { type: "apps", id: "100", attributes: { name: "Acme", bundleId: "com.acme.app" } };

/** Tool deps backed by a fake fetch; the app list always contains Acme. */
export function toolDeps(...routes: Route[]): ToolDeps & { f: ReturnType<typeof fakeFetch> } {
  const f = fakeFetch(...routes, on("/v1/apps", { data: [ACME] }));
  const client = new AscClient({ tokens: staticTokens, fetch: f });
  return { f, client, apps: new AppResolver(client, () => TEST_NOW), now: () => TEST_NOW };
}
