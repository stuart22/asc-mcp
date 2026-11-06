import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Catalog } from "../src/catalog/types.ts";
import { AREA_NAMES, AREAS, parseHiddenAreas } from "../src/areas/areas.ts";

const catalog: Catalog = JSON.parse(readFileSync(new URL("../src/catalog/catalog.json", import.meta.url), "utf8"));

test("every area has look-ups and counts match the audit", () => {
  const counts: Record<string, number> = {};
  for (const e of catalog.entries) counts[e.area] = (counts[e.area] ?? 0) + 1;
  assert.deepEqual(counts, {
    apps: 36,
    product_page: 44,
    custom_product_pages: 21,
    in_app_events: 9,
    testflight: 47,
    builds: 40,
    in_app_purchases: 39,
    subscriptions: 64,
    pricing: 12,
    reviews: 5,
    xcode_cloud: 37,
    reports: 10,
    users: 8,
    game_center: 121,
    app_clips: 14,
    certificates_and_distribution: 38,
  });
  assert.equal(catalog.entries.length, 545);
  assert.deepEqual(AREAS.map((a) => a.name), AREA_NAMES);
  assert.equal(AREA_NAMES.length, 16);
});

test("no excluded look-ups", () => {
  for (const e of catalog.entries) {
    assert.ok(!e.path.includes("/relationships/"), e.path);
    assert.ok(!/OneTimeUseCodes\/\{id\}\/values$/.test(e.path), e.path);
  }
});

test("every path passes the client's path check", () => {
  for (const e of catalog.entries) {
    assert.match(e.path, /^\/v\d+\/[A-Za-z0-9/_{}-]+$/);
    const placeholders = e.path.match(/\{[^}]*\}/g) ?? [];
    for (const p of placeholders) assert.equal(p, "{id}", e.path);
  }
});

test("parseHiddenAreas", () => {
  assert.deepEqual(parseHiddenAreas(" Game_Center, xcode_cloud ,nope"), { hidden: ["game_center", "xcode_cloud"], unknown: ["nope"] });
  assert.deepEqual(parseHiddenAreas(undefined), { hidden: [], unknown: [] });
  assert.deepEqual(parseHiddenAreas(""), { hidden: [], unknown: [] });
});
