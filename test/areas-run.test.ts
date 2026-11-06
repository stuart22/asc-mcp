import { test } from "node:test";
import assert from "node:assert/strict";
import { runLookup } from "../src/areas/run.ts";
import { on, toolDeps } from "./helpers.ts";

const buildsDoc = {
  data: [{ type: "builds", id: "b1", attributes: { version: "412", processingState: "PROCESSING", uploadedDate: "2026-11-05T14:02:00Z" }, relationships: { preReleaseVersion: { data: { type: "preReleaseVersions", id: "p1" } } } }],
  included: [{ type: "preReleaseVersions", id: "p1", attributes: { version: "1.4.0", platform: "IOS" } }],
};

const nonApps = (d: ReturnType<typeof toolDeps>) => d.f.requests.filter((r) => r.url.pathname !== "/v1/apps");

test("no lookup returns the index without a request", async () => {
  const d = toolDeps();
  const out = await runLookup(d, "in_app_events", {});
  assert.match(out, /^In-app events — read-only/);
  assert.match(out, /• \/v1\/apps\/\{id\}\/appEvents/);
  assert.equal(d.f.requests.length, 0);
});

test("polished builds list still works", async () => {
  const d = toolDeps(on("/v1/builds", buildsDoc));
  const out = await runLookup(d, "builds", { lookup: "list", app: "Acme", params: { status: "processing" } });
  assert.equal(out.split("\n")[0], "Processing builds for Acme (com.acme.app) — 1 shown, newest first:");
  assert.equal(out.split("\n")[1], "• 1.4.0 (412) · iOS · processing · uploaded 2026-11-05 14:02 UTC (23 min ago)");
  assert.equal(d.f.requests.find((r) => r.url.pathname === "/v1/builds")!.url.searchParams.get("filter[processingState]"), "PROCESSING");
});

test("polished look-up params are checked and case-insensitive", async () => {
  const d = toolDeps(on("/v1/builds", buildsDoc));
  await runLookup(d, "builds", { lookup: "list", app: "Acme", params: { status: "Processing", platform: "ios" } });
  assert.equal(d.f.requests.find((r) => r.url.pathname === "/v1/builds")!.url.searchParams.get("filter[preReleaseVersion.platform]"), "IOS");
  await assert.rejects(runLookup(d, "builds", { lookup: "list", app: "Acme", params: { colour: "red" } }), /params: status, version, platform/);
});

test("polished look-up that needs an app says so", async () => {
  const d = toolDeps();
  await assert.rejects(runLookup(d, "builds", { lookup: "list" }), /needs `app`/);
  assert.equal(d.f.requests.length, 0);
});

test("catalog look-up resolves app into {id}", async () => {
  const d = toolDeps(on("/v1/apps/100/appEvents", { data: [{ type: "appEvents", id: "e1", attributes: { referenceName: "Launch" } }] }));
  const out = await runLookup(d, "in_app_events", { lookup: "/v1/apps/{id}/appEvents", app: "Acme", params: { eventState: "published" } });
  const req = nonApps(d)[0]!;
  assert.equal(req.url.pathname, "/v1/apps/100/appEvents");
  assert.equal(req.url.searchParams.get("filter[eventState]"), "PUBLISHED");
  assert.match(out, /^\/v1\/apps\/100\/appEvents — 1 shown:/);
  assert.match(out, /• appEvents e1 — referenceName: Launch/);
});

test("catalog look-up with id fills {id}", async () => {
  const d = toolDeps(on("/v1/appEvents/e1", { data: { type: "appEvents", id: "e1", attributes: { referenceName: "Launch" } } }));
  const out = await runLookup(d, "in_app_events", { lookup: "/v1/appEvents/{id}", id: "e1" });
  assert.equal(out, "/v1/appEvents/e1:\n• appEvents e1 — referenceName: Launch");
});

test("app on a look-up without {id} fills filter[app]", async () => {
  const d = toolDeps(on("/v1/builds", { data: [] }));
  await runLookup(d, "builds", { lookup: "/v1/builds", app: "Acme" });
  assert.equal(nonApps(d)[0]!.url.searchParams.get("filter[app]"), "100");
});

test("missing id is explained without a request", async () => {
  const d = toolDeps();
  await assert.rejects(runLookup(d, "in_app_events", { lookup: "/v1/appEvents/{id}" }), /This look-up needs `id` \(an Apple ID from a previous result\)\./);
  await assert.rejects(runLookup(d, "in_app_events", { lookup: "/v1/appEvents/{id}", app: "Acme" }), /needs `id`/);
  await assert.rejects(runLookup(d, "in_app_events", { lookup: "/v1/apps/{id}/appEvents" }), /needs `app`/);
  assert.equal(d.f.requests.length, 0);
});

test("unsafe id is refused without a request", async () => {
  const d = toolDeps();
  await assert.rejects(runLookup(d, "in_app_events", { lookup: "/v1/appEvents/{id}", id: "../apps" }), /id/);
  assert.equal(d.f.requests.length, 0);
});

test("look-up from another area names the right tool without a request", async () => {
  const d = toolDeps();
  await assert.rejects(runLookup(d, "builds", { lookup: "/v1/apps/{id}/appEvents", app: "Acme" }), /That look-up belongs to the in_app_events tool\./);
  await assert.rejects(runLookup(d, "builds", { lookup: "/v1/nope" }), /Unknown look-up "\/v1\/nope"\. Call builds with no lookup to see what's available\./);
  await assert.rejects(runLookup(d, "builds", { lookup: "feedback" }), /Unknown look-up "feedback"/);
  assert.equal(d.f.requests.length, 0);
});

test("explain returns parameters without a request", async () => {
  const d = toolDeps();
  const out = await runLookup(d, "in_app_events", { lookup: "/v1/apps/{id}/appEvents", explain: true });
  assert.match(out, /filter\[eventState\] — one or more of:/);
  assert.equal(d.f.requests.length, 0);
});

test("bad params return the explanation without a request", async () => {
  const d = toolDeps();
  await assert.rejects(runLookup(d, "in_app_events", { lookup: "/v1/appEvents/{id}", id: "e1", params: { colour: "red" } }), /Unknown parameter "colour"[\s\S]*fields\[appEvents\]/);
  assert.equal(d.f.requests.length, 0);
});

test("403 on a catalog look-up passes Apple's hint through", async () => {
  const d = toolDeps(on("/v1/users", { errors: [{ status: "403", code: "FORBIDDEN", title: "Forbidden", detail: "Admin role required" }] }, 403));
  await assert.rejects(runLookup(d, "users", { lookup: "/v1/users" }), /isn't allowed to see this \(403\)[\s\S]*Admin role required/);
});

test("gzipped sales report look-up is tabulated", async () => {
  const { gzipSync } = await import("node:zlib");
  const { AscClient } = await import("../src/asc/client.ts");
  const requests: { url: URL; init?: RequestInit }[] = [];
  const f = (async (input: URL, init?: RequestInit) => {
    requests.push({ url: input, init });
    return new Response(gzipSync("Title\tUnits\nAcme\t12\n"), { headers: { "content-type": "application/a-gzip" } });
  }) as unknown as typeof fetch;
  const client = new AscClient({ tokens: { getToken: async () => "T" }, fetch: f });
  const out = await runLookup({ ...toolDeps(), client }, "reports", {
    lookup: "/v1/salesReports",
    params: { vendorNumber: "8", reportType: "sales", reportSubType: "summary", frequency: "daily" },
  });
  assert.equal(new Headers(requests[0]!.init?.headers).get("accept"), "application/a-gzip");
  assert.equal(requests[0]!.url.searchParams.get("filter[reportType]"), "SALES");
  assert.equal(out, "/v1/salesReports:\nTitle | Units\nAcme | 12");
});
