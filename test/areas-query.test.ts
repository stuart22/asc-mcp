import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG, entriesFor, findEntry } from "../src/catalog/catalog.ts";
import type { CatalogEntry } from "../src/catalog/types.ts";
import { buildQuery } from "../src/areas/query.ts";
import { explainEntry, renderIndex } from "../src/areas/indexText.ts";
import { MAX_RESULT_CHARS } from "../src/format/policy.ts";

const events = findEntry("/v1/apps/{id}/appEvents")!;
const fs = CATALOG.fieldSets;

test("catalog lookups", () => {
  assert.equal(events.area, "in_app_events");
  assert.equal(findEntry("/v1/nope"), undefined);
  const paths = entriesFor("in_app_events").map((e) => e.path);
  assert.deepEqual(paths, [...paths].sort());
  assert.ok(paths.includes("/v1/apps/{id}/appEvents"));
});

test("short filter names map to filter[...]", () => {
  const q = buildQuery(events, { eventState: "published" }, {}, fs);
  assert.equal(q["filter[eventState]"], "PUBLISHED");
  assert.equal(q.limit, 20);
});

test("arrays are comma-joined", () => {
  const q = buildQuery(events, { "filter[eventState]": ["draft", "PUBLISHED"], id: "a, b" }, {}, fs);
  assert.equal(q["filter[eventState]"], "DRAFT,PUBLISHED");
  assert.equal(q["filter[id]"], "a,b");
});

test("bad enum values list the valid ones", () => {
  assert.throws(() => buildQuery(events, { eventState: "LIVE" }, {}, fs), /Invalid value "LIVE" for filter\[eventState\][\s\S]*DRAFT/);
});

test("unknown parameter lists accepted ones", () => {
  assert.throws(
    () => buildQuery(events, { colour: "red" }, {}, fs),
    (e: unknown) => e instanceof Error && e.message.startsWith('Unknown parameter "colour" for /v1/apps/{id}/appEvents.') && e.message.includes("filter[eventState] — one or more of:"),
  );
});

test("limit is capped at the spec max", () => {
  assert.equal(buildQuery(events, undefined, { limit: 500 }, fs).limit, 200);
  assert.equal(buildQuery(events, { "limit[localizations]": 99 }, {}, fs)["limit[localizations]"], 50);
  assert.equal(buildQuery(events, undefined, { limit: 5, cursor: "CUR" }, fs).cursor, "CUR");
  const single = findEntry("/v1/appEvents/{id}")!;
  assert.equal(buildQuery(single, undefined, {}, fs).limit, undefined);
});

test("fields are validated against the field set", () => {
  assert.equal(buildQuery(events, { "fields[appEvents]": "referencename,BADGE" }, {}, fs)["fields[appEvents]"], "referenceName,badge");
  assert.throws(() => buildQuery(events, { "fields[appEvents]": "colour" }, {}, fs), /Invalid value "colour" for fields\[appEvents\]/);
});

test("required params are enforced", () => {
  const entry: CatalogEntry = {
    path: "/v1/salesReports",
    area: "reports",
    response: "gzip-tsv",
    params: [
      { name: "filter[vendorNumber]", type: "array", required: true },
      { name: "filter[frequency]", type: "array", values: ["DAILY", "WEEKLY"], required: true },
    ],
  };
  assert.throws(() => buildQuery(entry, { vendorNumber: "123" }, {}, fs), /Missing required parameter\(s\): filter\[frequency\]/);
  assert.deepEqual(buildQuery(entry, { vendorNumber: "123", frequency: "daily" }, {}, fs), { "filter[vendorNumber]": "123", "filter[frequency]": "DAILY" });
});

test("integer and boolean params are type-checked", () => {
  const entry: CatalogEntry = { path: "/v1/x", area: "apps", response: "json", params: [{ name: "n", type: "integer" }, { name: "exists[b]", type: "boolean" }] };
  assert.deepEqual(buildQuery(entry, { n: "3", b: "true" }, {}, fs), { n: 3, "exists[b]": true });
  assert.throws(() => buildQuery(entry, { n: "three" }, {}, fs), /must be a whole number/);
  assert.throws(() => buildQuery(entry, { b: "maybe" }, {}, fs), /must be true or false/);
});

test("appId fills filter[app] when accepted", () => {
  const builds = findEntry("/v1/builds")!;
  assert.equal(buildQuery(builds, undefined, { appId: "100" }, fs)["filter[app]"], "100");
  assert.equal(buildQuery(builds, { app: "200" }, { appId: "100" }, fs)["filter[app]"], "200");
  assert.equal(buildQuery(events, undefined, { appId: "100" }, fs)["filter[app]"], undefined);
});

test("index for game_center is under 12,000 chars and has no enum values", () => {
  const text = renderIndex("game_center", []);
  assert.ok(text.length < MAX_RESULT_CHARS, `length ${text.length}`);
  assert.equal(text.includes("one or more of"), false);
  assert.equal(text.includes("ARCHIVED"), false);
  for (const area of ["apps", "product_page", "testflight", "subscriptions", "builds", "certificates_and_distribution"] as const) {
    assert.ok(renderIndex(area, []).length < MAX_RESULT_CHARS, area);
  }
});

test("index lists tidied look-ups first", () => {
  const text = renderIndex("in_app_events", [{ name: "list", summary: "Events with dates", argsHelp: "state", needsApp: true }]);
  const lines = text.split("\n");
  assert.equal(lines[0], "In-app events — read-only. Pass one of these as `lookup`.");
  assert.equal(lines[1], "Tidied look-ups:");
  assert.equal(lines[2], "• list — Events with dates (needs app; params: state)");
  assert.match(lines[3]!, /^All look-ups in Apple's API — pass `app` for \/apps\/\{id\}\/ paths, `id` for other \{id\} paths, `explain: true` for a look-up's parameters:$/);
  assert.ok(lines.includes("• /v1/apps/{id}/appEvents — filters: eventState, id"));
});

test("index without tidied look-ups skips that section", () => {
  const lines = renderIndex("game_center", []).split("\n");
  assert.match(lines[1]!, /^All look-ups/);
});

test("explain shows enums, fields and limit", () => {
  const text = explainEntry(events);
  assert.match(text, /^\/v1\/apps\/\{id\}\/appEvents/);
  assert.match(text, /filter\[eventState\] — one or more of: DRAFT, READY_FOR_REVIEW/);
  assert.match(text, /fields\[appEvents\] — comma list of fields: referenceName, badge/);
  assert.match(text, /limit — 1–200 \(default 20\)/);
  assert.match(text, /limit\[localizations\] — 1–50/);
  assert.match(text, /cursor — from a previous "More available" line/);
});
