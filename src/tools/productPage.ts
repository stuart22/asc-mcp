// Product page: the listing text per language, and screenshot/preview counts.
import type {
  AppInfoAttributes,
  AppInfoLocalizationAttributes,
  AppPreviewSetAttributes,
  AppScreenshotSetAttributes,
  AppStoreVersionAttributes,
  AppStoreVersionLocalizationAttributes,
  Platform,
  Resource,
} from "../asc/types.ts";
import type { AppRef } from "../asc/resolveApp.ts";
import { appLabel, asList, fmtPlatform, humanize, truncate, type ToolDeps } from "../format/common.ts";
import { capOutput } from "../format/policy.ts";
import { fetchAllVersions, versionState } from "./versions.ts";

export type ProductPageInput = { app: string; version?: string; platform?: Platform; locale?: string };

// Live and finished states, including the deprecated appStoreState names Apple may still send.
const LIVE = new Set(["READY_FOR_DISTRIBUTION", "READY_FOR_SALE", "PREORDER_READY_FOR_SALE"]);
const NOT_EDITABLE = new Set([...LIVE, "REPLACED_WITH_NEW_VERSION", "REMOVED_FROM_SALE", "DEVELOPER_REMOVED_FROM_SALE"]);

type Version = Resource<AppStoreVersionAttributes>;
type Chosen = { app: AppRef; version: Version; live: boolean; label: string };

/** The version asked for; else the editable one; else the live one. A string means "nothing to show". */
async function chooseVersion(deps: ToolDeps, input: ProductPageInput): Promise<Chosen | string> {
  const app = await deps.apps.resolve(input.app);
  const { versions } = await fetchAllVersions(deps, app.id, input.platform);
  if (versions.length === 0) return `No App Store versions found for ${appLabel(app)}.`;
  let version: Version | undefined;
  if (input.version) {
    version = versions.find((v) => v.attributes?.versionString === input.version);
    if (!version) {
      const names = [...new Set(versions.map((v) => v.attributes?.versionString).filter(Boolean))];
      throw new Error(`No version ${input.version}. Versions: ${names.join(", ")}.`);
    }
  } else {
    version =
      versions.find((v) => !NOT_EDITABLE.has(versionState(v.attributes ?? {}) ?? "")) ?? versions.find((v) => LIVE.has(versionState(v.attributes ?? {}) ?? ""));
    if (!version) return `No editable or live App Store version found for ${appLabel(app)}.`;
  }
  const a = version.attributes ?? {};
  const state = versionState(a);
  return { app, version, live: LIVE.has(state ?? ""), label: `version ${a.versionString ?? "—"} · ${fmtPlatform(a.platform)} · ${humanize(state)}` };
}

function filterLocale<T extends { locale?: string }>(items: Resource<T>[], locale: string | undefined): Resource<T>[] {
  if (!locale) return items;
  const hit = items.filter((i) => i.attributes?.locale?.toLowerCase() === locale.toLowerCase());
  if (hit.length === 0) throw new Error(`No ${locale} localization. Locales: ${items.map((i) => i.attributes?.locale).join(", ")}.`);
  return hit;
}

async function versionLocalizations(deps: ToolDeps, versionId: string, fields: string) {
  return asList(
    await deps.client.get<AppStoreVersionLocalizationAttributes>(`/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`, {
      "fields[appStoreVersionLocalizations]": fields,
      limit: 200,
    }),
  );
}

async function appInfoNames(deps: ToolDeps, appId: string, live: boolean): Promise<Map<string, AppInfoLocalizationAttributes>> {
  const infos = asList(await deps.client.get<AppInfoAttributes>(`/v1/apps/${appId}/appInfos`, { "fields[appInfos]": "state,appStoreState", limit: 200 }));
  const isLive = (i: Resource<AppInfoAttributes>) => LIVE.has(i.attributes?.state ?? i.attributes?.appStoreState ?? "");
  const replaced = (i: Resource<AppInfoAttributes>) => (i.attributes?.state ?? i.attributes?.appStoreState) === "REPLACED_WITH_NEW_INFO";
  const info = live ? infos.find(isLive) : infos.find((i) => !isLive(i) && !replaced(i)) ?? infos.find(isLive);
  const names = new Map<string, AppInfoLocalizationAttributes>();
  if (!info) return names;
  const locs = asList(
    await deps.client.get<AppInfoLocalizationAttributes>(`/v1/appInfos/${info.id}/appInfoLocalizations`, {
      "fields[appInfoLocalizations]": "locale,name,subtitle",
      limit: 200,
    }),
  );
  for (const l of locs) if (l.attributes?.locale) names.set(l.attributes.locale, l.attributes);
  return names;
}

export async function listing(deps: ToolDeps, input: ProductPageInput): Promise<string> {
  const chosen = await chooseVersion(deps, input);
  if (typeof chosen === "string") return chosen;
  const locs = filterLocale(await versionLocalizations(deps, chosen.version.id, "locale,description,keywords,whatsNew,promotionalText,marketingUrl,supportUrl"), input.locale);
  const names = await appInfoNames(deps, chosen.app.id, chosen.live);
  const lines = [`Product page for ${appLabel(chosen.app)} — ${chosen.label}:`];
  for (const l of locs) {
    const a = l.attributes ?? {};
    const n = names.get(a.locale ?? "") ?? {};
    lines.push(`■ ${a.locale ?? "—"}`);
    const fields: [string, string | undefined, number][] = [
      ["name", n.name, 100],
      ["subtitle", n.subtitle, 100],
      ["promotional text", a.promotionalText, 300],
      ["description", a.description, 600],
      ["keywords", a.keywords, 200],
      ["what's new", a.whatsNew, 600],
      ["support URL", a.supportUrl, 300],
      ["marketing URL", a.marketingUrl, 300],
    ];
    for (const [label, value, max] of fields) if (value) lines.push(`${label}: ${truncate(value.replace(/\s*\n\s*/g, " "), max)}`);
  }
  if (locs.length === 0) lines.push("(no localizations)");
  return capOutput(lines.join("\n"));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const countOf = (r: Resource<unknown>, rel: string) => {
  const data = r.relationships?.[rel]?.data;
  return Array.isArray(data) ? data.length : 0;
};

export async function screenshots(deps: ToolDeps, input: ProductPageInput): Promise<string> {
  const chosen = await chooseVersion(deps, input);
  if (typeof chosen === "string") return chosen;
  const locs = filterLocale(await versionLocalizations(deps, chosen.version.id, "locale"), input.locale);
  const lines = [`Screenshots for ${appLabel(chosen.app)} — ${chosen.label}:`];
  for (const l of locs) {
    lines.push(`■ ${l.attributes?.locale ?? "—"}`);
    const sets = asList(
      await deps.client.get<AppScreenshotSetAttributes>(`/v1/appStoreVersionLocalizations/${l.id}/appScreenshotSets`, {
        include: "appScreenshots",
        "limit[appScreenshots]": 50,
        limit: 50,
      }),
    );
    const previews = asList(
      await deps.client.get<AppPreviewSetAttributes>(`/v1/appStoreVersionLocalizations/${l.id}/appPreviewSets`, {
        include: "appPreviews",
        "limit[appPreviews]": 50,
        limit: 50,
      }),
    );
    for (const s of sets) lines.push(`• ${humanize(s.attributes?.screenshotDisplayType)}: ${plural(countOf(s, "appScreenshots"), "screenshot")}`);
    for (const p of previews) lines.push(`• ${humanize(p.attributes?.previewType)}: ${plural(countOf(p, "appPreviews"), "preview")}`);
    if (sets.length + previews.length === 0) lines.push("• no screenshots or previews");
  }
  return capOutput(lines.join("\n"));
}
