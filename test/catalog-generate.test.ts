import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCatalog } from "../scripts/catalog-generate.ts";

const mini = JSON.parse(readFileSync(new URL("./fixtures/mini-spec.json", import.meta.url), "utf8"));
const byPath = (path: string) => buildCatalog(mini).entries.find((e) => e.path === path)!;

test("maps Apps sub-resources by segment and excludes relationships, code values and writes", () => {
  const cat = buildCatalog(mini);
  assert.deepEqual(
    cat.entries.map((e) => e.path),
    ["/v1/apps", "/v1/apps/{id}/appEvents", "/v1/apps/{id}/perfPowerMetrics", "/v1/salesReports"],
  );
  assert.deepEqual(
    cat.entries.map((e) => e.area),
    ["apps", "in_app_events", "builds", "reports"],
  );
});

test("records params, field sets, limits and enums", () => {
  const cat = buildCatalog(mini);
  const params = byPath("/v1/apps/{id}/appEvents").params;
  assert.deepEqual(params.find((p) => p.name === "filter[eventState]"), { name: "filter[eventState]", type: "array", values: ["DRAFT", "PUBLISHED"] });
  assert.deepEqual(params.find((p) => p.name === "fields[appEvents]"), { name: "fields[appEvents]", type: "array", fieldSet: "appEvents" });
  assert.deepEqual(params.find((p) => p.name === "limit"), { name: "limit", type: "integer", max: 50 });
  assert.deepEqual(cat.fieldSets.appEvents, ["referenceName", "badge"]);
  assert.equal(cat.specVersion, "9.9");
});

test("response kinds", () => {
  const sales = byPath("/v1/salesReports");
  assert.equal(sales.response, "gzip-tsv");
  assert.deepEqual(sales.params.find((p) => p.name === "filter[vendorNumber]"), { name: "filter[vendorNumber]", type: "array", required: true });
  const perf = byPath("/v1/apps/{id}/perfPowerMetrics");
  assert.equal(perf.response, "apple-json");
  assert.equal(perf.accept, "application/vnd.apple.xcode-metrics+json");
  assert.equal(byPath("/v1/apps").response, "json");
});

test("unmapped tag throws naming it", () => {
  const spec = { info: { version: "1" }, paths: { "/v1/zebras": { get: { tags: ["Zebras"], responses: { "200": { content: { "application/json": {} } } } } } } };
  assert.throws(() => buildCatalog(spec), /Unmapped Apple tags: Zebras/);
});
