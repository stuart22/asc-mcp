import { test } from "node:test";
import assert from "node:assert/strict";
import { listCustomPages } from "../src/tools/customPages.ts";
import { listInAppEvents } from "../src/tools/inAppEvents.ts";
import { runLookup } from "../src/areas/run.ts";
import { on, toolDeps } from "./helpers.ts";

const pages = on("/v1/apps/100/appCustomProductPages", {
  data: [
    {
      type: "appCustomProductPages",
      id: "cp1",
      attributes: { name: "Spring promo", url: "https://apps.apple.com/app/id100?ppid=cp1", visible: true },
      relationships: { appCustomProductPageVersions: { data: [{ type: "appCustomProductPageVersions", id: "cv1" }, { type: "appCustomProductPageVersions", id: "cv2" }] } },
    },
    { type: "appCustomProductPages", id: "cp2", attributes: { name: "Old", visible: false }, relationships: { appCustomProductPageVersions: { data: [] } } },
  ],
  included: [
    { type: "appCustomProductPageVersions", id: "cv1", attributes: { version: "1", state: "APPROVED" } },
    { type: "appCustomProductPageVersions", id: "cv2", attributes: { version: "2", state: "PREPARE_FOR_SUBMISSION" } },
  ],
});
const pageLocs = on("/v1/appCustomProductPageVersions/cv2/appCustomProductPageLocalizations", {
  data: [{ type: "appCustomProductPageLocalizations", id: "l1", attributes: { locale: "en-US", promotionalText: "Spring is here. ".repeat(20) } }],
});

test("custom pages show visibility, state, URL and promo text", async () => {
  const d = toolDeps(pages, pageLocs);
  const out = await listCustomPages(d, { app: "Acme" });
  const lines = out.split("\n");
  assert.equal(lines[0], "Custom product pages for Acme (com.acme.app) — 2 shown:");
  assert.equal(lines[1], "• Spring promo · visible · prepare for submission · https://apps.apple.com/app/id100?ppid=cp1");
  assert.ok(lines[2]!.startsWith("  en-US: Spring is here."));
  assert.ok(lines[2]!.length <= "  en-US: ".length + 170);
  assert.equal(lines[3], "• Old · hidden · no versions");
  const q = d.f.requests.find((r) => r.url.pathname === "/v1/apps/100/appCustomProductPages")!.url.searchParams;
  assert.equal(q.get("include"), "appCustomProductPageVersions");
  assert.equal(d.f.requests.some((r) => r.url.pathname.includes("cv1")), false);
});

test("no custom pages says so", async () => {
  const d = toolDeps(on("/v1/apps/100/appCustomProductPages", { data: [] }));
  assert.equal(await listCustomPages(d, { app: "Acme" }), "No custom product pages found for Acme (com.acme.app).");
});

const eventsDoc = {
  data: [
    {
      type: "appEvents",
      id: "e1",
      attributes: {
        referenceName: "Summer Cup",
        eventState: "PUBLISHED",
        badge: "COMPETITION",
        priority: "HIGH",
        purpose: "KEEP_ACTIVE_USERS_INFORMED",
        territorySchedules: [
          { territories: ["USA"], publishStart: "2026-06-01T00:00:00Z", eventStart: "2026-06-05T17:00:00Z", eventEnd: "2026-06-12T17:00:00Z" },
          { territories: ["GBR"], publishStart: "2026-06-02T00:00:00Z", eventStart: "2026-06-06T17:00:00Z", eventEnd: "2026-06-13T17:00:00Z" },
        ],
      },
      relationships: { localizations: { data: [{ type: "appEventLocalizations", id: "el1" }] } },
    },
    { type: "appEvents", id: "e2", attributes: { referenceName: "Draft idea", eventState: "DRAFT" } },
  ],
  included: [{ type: "appEventLocalizations", id: "el1", attributes: { locale: "en-US", name: "Summer Cup", shortDescription: "Win prizes" } }],
};

test("events show state, dates and localized names", async () => {
  const d = toolDeps(on("/v1/apps/100/appEvents", eventsDoc));
  const out = await listInAppEvents(d, { app: "Acme" });
  assert.equal(
    out,
    [
      "In-app events for Acme (com.acme.app) — 2 shown:",
      "• Summer Cup · published · badge competition · priority high · purpose keep active users informed",
      "  publish 2026-06-01 00:00 UTC · runs 2026-06-05 17:00 UTC–2026-06-12 17:00 UTC (+1 more schedules)",
      "  en-US: Summer Cup — Win prizes",
      "• Draft idea · draft",
    ].join("\n"),
  );
  const q = d.f.requests.find((r) => r.url.pathname === "/v1/apps/100/appEvents")!.url.searchParams;
  assert.equal(q.get("include"), "localizations");
  assert.equal(q.get("fields[appEventLocalizations]"), "locale,name,shortDescription");
});

test("event state filter is sent upper-cased", async () => {
  const d = toolDeps(on("/v1/apps/100/appEvents", { data: [] }));
  const out = await runLookup(d, "in_app_events", { lookup: "list", app: "Acme", params: { state: "published" } });
  assert.equal(out, "No published in-app events found for Acme (com.acme.app).");
  assert.equal(d.f.requests.find((r) => r.url.pathname === "/v1/apps/100/appEvents")!.url.searchParams.get("filter[eventState]"), "PUBLISHED");
});

test("invalid state lists valid ones", async () => {
  const d = toolDeps();
  await assert.rejects(runLookup(d, "in_app_events", { lookup: "list", app: "Acme", params: { state: "live" } }), /draft, ready_for_review|DRAFT, READY_FOR_REVIEW/i);
  assert.equal(d.f.requests.length, 0);
});

test("custom pages and events appear as tidied look-ups", async () => {
  const d = toolDeps();
  assert.match(await runLookup(d, "custom_product_pages", {}), /Tidied look-ups:\n• list — /);
  assert.match(await runLookup(d, "in_app_events", {}), /Tidied look-ups:\n• list — .*params: state/);
});
