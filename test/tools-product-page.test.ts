import { test } from "node:test";
import assert from "node:assert/strict";
import { listing, screenshots } from "../src/tools/productPage.ts";
import { runLookup } from "../src/areas/run.ts";
import { on, toolDeps } from "./helpers.ts";

const v = (id: string, versionString: string, appVersionState: string, createdDate: string) => ({
  type: "appStoreVersions",
  id,
  attributes: { platform: "IOS", versionString, appVersionState, createdDate },
});
const LIVE = v("v1", "1.3.0", "READY_FOR_DISTRIBUTION", "2026-10-01T00:00:00Z");
const EDITABLE = v("v2", "1.4.0", "PREPARE_FOR_SUBMISSION", "2026-11-01T00:00:00Z");

const versionLocs = (id: string) =>
  on(`/v1/appStoreVersions/${id}/appStoreVersionLocalizations`, {
    data: [
      { type: "appStoreVersionLocalizations", id: `${id}-en`, attributes: { locale: "en-US", description: "Best app. ".repeat(100), keywords: "acme,tools", whatsNew: `Notes for ${id}`, promotionalText: "Now faster", supportUrl: "https://acme.example/help", marketingUrl: null } },
      { type: "appStoreVersionLocalizations", id: `${id}-de`, attributes: { locale: "de-DE", description: "Beste App.", keywords: "acme" } },
    ],
  });

const appInfos = on("/v1/apps/100/appInfos", {
  data: [
    { type: "appInfos", id: "i-live", attributes: { state: "READY_FOR_DISTRIBUTION" } },
    { type: "appInfos", id: "i-next", attributes: { state: "PREPARE_FOR_SUBMISSION" } },
  ],
});
const infoLocs = (id: string, name: string) =>
  on(`/v1/appInfos/${id}/appInfoLocalizations`, {
    data: [{ type: "appInfoLocalizations", id: `${id}-en`, attributes: { locale: "en-US", name, subtitle: "Get things done" } }],
  });
const allInfo = [appInfos, infoLocs("i-live", "Acme"), infoLocs("i-next", "Acme Pro")];

test("listing shows the editable version's text per locale", async () => {
  const d = toolDeps(on("/v1/apps/100/appStoreVersions", { data: [LIVE, EDITABLE] }), versionLocs("v2"), ...allInfo);
  const out = await listing(d, { app: "Acme" });
  const lines = out.split("\n");
  assert.equal(lines[0], "Product page for Acme (com.acme.app) — version 1.4.0 · iOS · prepare for submission:");
  assert.equal(lines[1], "■ en-US");
  assert.equal(lines[2], "name: Acme Pro");
  assert.equal(lines[3], "subtitle: Get things done");
  assert.equal(lines[4], "promotional text: Now faster");
  assert.ok(lines[5]!.startsWith("description: Best app.") && lines[5]!.length <= "description: ".length + 600);
  assert.equal(lines[6], "keywords: acme,tools");
  assert.equal(lines[7], "what's new: Notes for v2");
  assert.equal(lines[8], "support URL: https://acme.example/help");
  assert.equal(lines[9], "■ de-DE");
  assert.equal(out.includes("marketing URL"), false);
  const q = d.f.requests.find((r) => r.url.pathname === "/v1/appStoreVersions/v2/appStoreVersionLocalizations")!.url.searchParams;
  assert.equal(q.get("fields[appStoreVersionLocalizations]"), "locale,description,keywords,whatsNew,promotionalText,marketingUrl,supportUrl");
});

test("listing falls back to the live version", async () => {
  const d = toolDeps(on("/v1/apps/100/appStoreVersions", { data: [LIVE] }), versionLocs("v1"), ...allInfo);
  const out = await listing(d, { app: "Acme" });
  assert.match(out, /^Product page for Acme \(com\.acme\.app\) — version 1\.3\.0 · iOS · ready for distribution:/);
  assert.match(out, /name: Acme\n/);
  assert.match(out, /what's new: Notes for v1/);
});

test("listing says when the app has no versions", async () => {
  const d = toolDeps(on("/v1/apps/100/appStoreVersions", { data: [] }));
  assert.equal(await listing(d, { app: "Acme" }), "No App Store versions found for Acme (com.acme.app).");
});

test("listing filters by locale", async () => {
  const d = toolDeps(on("/v1/apps/100/appStoreVersions", { data: [LIVE, EDITABLE] }), versionLocs("v2"), ...allInfo);
  const out = await listing(d, { app: "Acme", locale: "DE-de" });
  assert.match(out, /■ de-DE\ndescription: Beste App\.\nkeywords: acme$/);
  assert.equal(out.includes("en-US"), false);
  await assert.rejects(listing(d, { app: "Acme", locale: "fr-FR" }), /No fr-FR localization\. Locales: en-US, de-DE/);
});

test("unknown version lists the versions", async () => {
  const d = toolDeps(on("/v1/apps/100/appStoreVersions", { data: [LIVE, EDITABLE] }));
  await assert.rejects(listing(d, { app: "Acme", version: "9.9" }), /No version 9\.9\. Versions: 1\.4\.0, 1\.3\.0/);
  const d2 = toolDeps(on("/v1/apps/100/appStoreVersions", { data: [LIVE, EDITABLE] }), versionLocs("v1"), ...allInfo);
  assert.match(await listing(d2, { app: "Acme", version: "1.3.0" }), /version 1\.3\.0/);
});

test("screenshots counts per display type", async () => {
  const d = toolDeps(
    on("/v1/apps/100/appStoreVersions", { data: [EDITABLE] }),
    versionLocs("v2"),
    on("/v1/appStoreVersionLocalizations/v2-en/appScreenshotSets", {
      data: [
        { type: "appScreenshotSets", id: "s1", attributes: { screenshotDisplayType: "APP_IPHONE_67" }, relationships: { appScreenshots: { data: [{ type: "appScreenshots", id: "a" }, { type: "appScreenshots", id: "b" }] } } },
        { type: "appScreenshotSets", id: "s2", attributes: { screenshotDisplayType: "APP_IPAD_PRO_129" }, relationships: { appScreenshots: { data: [] } } },
      ],
    }),
    on("/v1/appStoreVersionLocalizations/v2-en/appPreviewSets", {
      data: [{ type: "appPreviewSets", id: "p1", attributes: { previewType: "IPHONE_67" }, relationships: { appPreviews: { data: [{ type: "appPreviews", id: "x" }] } } }],
    }),
    on("/v1/appStoreVersionLocalizations/v2-de/appScreenshotSets", { data: [] }),
    on("/v1/appStoreVersionLocalizations/v2-de/appPreviewSets", { data: [] }),
  );
  const out = await screenshots(d, { app: "Acme" });
  assert.equal(
    out,
    [
      "Screenshots for Acme (com.acme.app) — version 1.4.0 · iOS · prepare for submission:",
      "■ en-US",
      "• app iphone 67: 2 screenshots",
      "• app ipad pro 129: 0 screenshots",
      "• iphone 67: 1 preview",
      "■ de-DE",
      "• no screenshots or previews",
    ].join("\n"),
  );
  const q = d.f.requests.find((r) => r.url.pathname === "/v1/appStoreVersionLocalizations/v2-en/appScreenshotSets")!.url.searchParams;
  assert.equal(q.get("include"), "appScreenshots");
});

test("product_page tool exposes listing and screenshots", async () => {
  const d = toolDeps(on("/v1/apps/100/appStoreVersions", { data: [LIVE] }), versionLocs("v1"), ...allInfo);
  const out = await runLookup(d, "product_page", { lookup: "listing", app: "Acme", params: { locale: "en-US" } });
  assert.match(out, /■ en-US/);
  assert.match(await runLookup(d, "product_page", {}), /• listing — .*\(needs app; params: version, platform, locale\)/);
  assert.match(await runLookup(d, "product_page", {}), /• screenshots — /);
});
