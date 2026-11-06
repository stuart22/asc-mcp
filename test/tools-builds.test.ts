import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtDate, fmtAge, pagingFooter, truncate } from "../src/format/common.ts";
import { listBuilds } from "../src/tools/builds.ts";
import { on, toolDeps as depsWith, TEST_NOW as NOW } from "./helpers.ts";

const buildsDoc = {
  data: [
    {
      type: "builds",
      id: "b1",
      attributes: { version: "412", uploadedDate: "2026-11-05T06:02:00-08:00", processingState: "PROCESSING", expired: false },
      relationships: { preReleaseVersion: { data: { type: "preReleaseVersions", id: "p1" } } },
    },
    {
      type: "builds",
      id: "b2",
      attributes: {
        version: "411",
        uploadedDate: "2026-11-01T09:00:00Z",
        expirationDate: "2027-01-30T09:00:00Z",
        processingState: "VALID",
        expired: false,
        buildAudienceType: "INTERNAL_ONLY",
      },
      relationships: { preReleaseVersion: { data: { type: "preReleaseVersions", id: "p1" } } },
    },
  ],
  included: [{ type: "preReleaseVersions", id: "p1", attributes: { version: "1.4.0", platform: "IOS" } }],
  meta: { paging: { total: 2, limit: 20 } },
};

test("fmtDate renders UTC minutes, and a dash when missing", () => {
  assert.equal(fmtDate("2026-11-05T06:02:31.000-08:00"), "2026-11-05 14:02 UTC");
  assert.equal(fmtDate(undefined), "—");
  assert.equal(fmtDate("not a date"), "—");
});

test("fmtAge is short and human", () => {
  assert.equal(fmtAge("2026-11-05T14:24:40Z", NOW), "just now");
  assert.equal(fmtAge("2026-11-05T14:02:00Z", NOW), "23 min ago");
  assert.equal(fmtAge("2026-11-05T11:00:00Z", NOW), "3 h ago");
  assert.equal(fmtAge("2026-11-01T11:00:00Z", NOW), "4 d ago");
  assert.equal(fmtAge(undefined, NOW), "");
});

test("pagingFooter mentions totals and the cursor only when more exist", () => {
  assert.equal(pagingFooter(2, { data: [], meta: { paging: { total: 2 } } }), "");
  assert.equal(
    pagingFooter(20, { data: [], meta: { paging: { total: 134 } }, links: { next: "https://api.appstoreconnect.apple.com/v1/builds?cursor=abc" } }),
    'Showing 20 of 134. More available — call again with cursor: "abc".',
  );
  assert.equal(pagingFooter(20, { data: [], links: { next: "https://api.appstoreconnect.apple.com/v1/builds?cursor=abc" } }), 'More available — call again with cursor: "abc".');
});

test("truncate adds an ellipsis only when needed", () => {
  assert.equal(truncate("short", 10), "short");
  assert.equal(truncate("abcdefghij", 5), "abcd…");
  assert.equal(truncate(undefined, 5), "");
});

test("list_builds sends the right query", async () => {
  const d = depsWith(on("/v1/builds", buildsDoc));
  await listBuilds(d, { app: "Acme", status: "processing", version: "1.4.0", platform: "IOS" });
  const q = d.f.requests.find((r) => r.url.pathname === "/v1/builds")!.url.searchParams;
  assert.equal(q.get("filter[app]"), "100");
  assert.equal(q.get("filter[processingState]"), "PROCESSING");
  assert.equal(q.get("filter[preReleaseVersion.version]"), "1.4.0");
  assert.equal(q.get("filter[preReleaseVersion.platform]"), "IOS");
  assert.equal(q.get("sort"), "-uploadedDate");
  assert.equal(q.get("include"), "preReleaseVersion");
  assert.equal(q.get("limit"), "20");
});

test("list_builds formats compact lines", async () => {
  const out = await listBuilds(depsWith(on("/v1/builds", buildsDoc)), { app: "Acme" });
  const lines = out.split("\n");
  assert.equal(lines[0], "Builds for Acme (com.acme.app) — 2 shown, newest first:");
  assert.equal(lines[1], "• 1.4.0 (412) · iOS · processing · uploaded 2026-11-05 14:02 UTC (23 min ago)");
  assert.equal(lines[2], "• 1.4.0 (411) · iOS · ready · internal testing only · uploaded 2026-11-01 09:00 UTC (4 d ago) · expires 2027-01-30");
  assert.equal(lines.length, 3);
});

test("list_builds says when nothing matches", async () => {
  const out = await listBuilds(depsWith(on("/v1/builds", { data: [] })), { app: "Acme", status: "processing" });
  assert.equal(out, "No processing builds found for Acme (com.acme.app).");
});

test("list_builds tolerates missing fields", async () => {
  const doc = { data: [{ type: "builds", id: "b9", attributes: {} }] };
  const out = await listBuilds(depsWith(on("/v1/builds", doc)), { app: "Acme" });
  assert.match(out, /• — \(—\) · — · unknown status · uploaded —/);
});

test("list_builds shows expired builds as expired", async () => {
  const doc = { data: [{ type: "builds", id: "b3", attributes: { version: "1", processingState: "VALID", expired: true, uploadedDate: "2026-01-01T00:00:00Z" } }] };
  const out = await listBuilds(depsWith(on("/v1/builds", doc)), { app: "Acme" });
  assert.match(out, /· expired/);
});

test("list_builds adds a paging footer when more exist", async () => {
  const doc = { ...buildsDoc, meta: { paging: { total: 50 } }, links: { next: "https://api.appstoreconnect.apple.com/v1/builds?cursor=xyz" } };
  const out = await listBuilds(depsWith(on("/v1/builds", doc)), { app: "Acme", limit: 2 });
  assert.match(out, /Showing 2 of 50\. More available — call again with cursor: "xyz"\.$/);
});
