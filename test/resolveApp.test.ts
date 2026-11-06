import { test } from "node:test";
import assert from "node:assert/strict";
import { AscClient } from "../src/asc/client.ts";
import { AppResolver, AppNotFoundError } from "../src/asc/resolveApp.ts";
import { fakeFetch, on, staticTokens, type Route } from "./helpers.ts";

const app = (id: string, name: string, bundleId: string) => ({ type: "apps", id, attributes: { name, bundleId, sku: `SKU${id}`, primaryLocale: "en-US" } });
const APPS = [
  app("100", "Acme", "com.acme.app"),
  app("101", "Acme Beta", "com.acme.beta"),
  app("102", "Widget Pro", "com.example.widget"),
  app("103", "Widget Lite", "com.example.widgetlite"),
];

function resolverWith(routes: Route[], now?: () => number) {
  const f = fakeFetch(...routes);
  return { f, r: new AppResolver(new AscClient({ tokens: staticTokens, fetch: f }), now) };
}

test("digits resolve via /v1/apps/{id}", async () => {
  const { f, r } = resolverWith([on("/v1/apps/102", { data: APPS[2] })]);
  const a = await r.resolve("102");
  assert.equal(a.name, "Widget Pro");
  assert.equal(f.requests[0]!.url.pathname, "/v1/apps/102");
});

test("bundle id resolves via filter[bundleId]", async () => {
  const { f, r } = resolverWith([on("/v1/apps", { data: [APPS[0]] })]);
  const a = await r.resolve("com.acme.app");
  assert.equal(a.id, "100");
  assert.equal(f.requests[0]!.url.searchParams.get("filter[bundleId]"), "com.acme.app");
});

test("unknown bundle id falls back to name matching", async () => {
  const { r } = resolverWith([(u) => (u.searchParams.has("filter[bundleId]") ? { body: { data: [] } } : { body: { data: APPS } })]);
  await assert.rejects(r.resolve("com.nope.app"), AppNotFoundError);
});

test("exact name beats contains", async () => {
  const { r } = resolverWith([on("/v1/apps", { data: APPS })]);
  assert.equal((await r.resolve("acme")).id, "100");
});

test("case-insensitive prefix match", async () => {
  const { r } = resolverWith([on("/v1/apps", { data: APPS })]);
  assert.equal((await r.resolve("widget p")).id, "102");
});

test("ambiguous name lists candidates", async () => {
  const { r } = resolverWith([on("/v1/apps", { data: APPS })]);
  await assert.rejects(r.resolve("widget"), (e: unknown) => {
    assert.ok(e instanceof AppNotFoundError);
    assert.match(e.message, /Widget Pro \(com\.example\.widget\)/);
    assert.match(e.message, /Widget Lite \(com\.example\.widgetlite\)/);
    return true;
  });
});

test("no match lists known apps", async () => {
  const { r } = resolverWith([on("/v1/apps", { data: APPS })]);
  await assert.rejects(r.resolve("Zebra"), (e: unknown) => e instanceof AppNotFoundError && /Acme/.test(e.message));
});

test("caches the app list for 5 minutes", async () => {
  let now = 0;
  const { f, r } = resolverWith([on("/v1/apps", { data: APPS })], () => now);
  await r.resolve("Acme");
  await r.resolve("Widget Pro");
  assert.equal(f.requests.length, 1);
  now += 301_000;
  await r.resolve("Acme");
  assert.equal(f.requests.length, 2);
});

test("listAll follows paging", async () => {
  const { f, r } = resolverWith([
    (u) =>
      u.searchParams.get("cursor") === "p2"
        ? { body: { data: APPS.slice(2) } }
        : { body: { data: APPS.slice(0, 2), links: { next: "https://api.appstoreconnect.apple.com/v1/apps?cursor=p2" } } },
  ]);
  const all = await r.listAll();
  assert.equal(all.length, 4);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0]!.url.searchParams.get("limit"), "200");
  assert.equal(f.requests[0]!.url.searchParams.get("fields[apps]"), "name,bundleId,sku,primaryLocale");
});

test("bundle id lookup only accepts an exact match", async () => {
  const { r } = resolverWith([(u) => (u.searchParams.has("filter[bundleId]") ? { body: { data: [APPS[0]] } } : { body: { data: APPS } })]);
  // If Apple's filter were a prefix match, "com.acme" must not silently become com.acme.app.
  await assert.rejects(r.resolve("com.acme"), (e: unknown) => e instanceof AppNotFoundError && /matches 2 apps/.test(e.message));
});
