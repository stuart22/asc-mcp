// Custom product pages: name, visibility, latest version state, URL and promo text.
import type {
  AppCustomProductPageAttributes,
  AppCustomProductPageLocalizationAttributes,
  AppCustomProductPageVersionAttributes,
  Resource,
} from "../asc/types.ts";
import { appLabel, asList, DEFAULT_LIMIT, humanize, pagingFooter, render, truncate, type ToolDeps } from "../format/common.ts";
import { capOutput } from "../format/policy.ts";

type VersionRes = Resource<AppCustomProductPageVersionAttributes>;

/** The newest version: highest version number among those Apple returned. */
function latestVersion(page: Resource<unknown>, included: Resource<Record<string, unknown>>[]): VersionRes | undefined {
  const data = page.relationships?.appCustomProductPageVersions?.data;
  const ids = new Set((Array.isArray(data) ? data : []).map((l) => l.id));
  const versions = included.filter((i) => i.type === "appCustomProductPageVersions" && ids.has(i.id)) as VersionRes[];
  return versions.sort((a, b) => (Number(b.attributes?.version) || 0) - (Number(a.attributes?.version) || 0))[0];
}

export async function listCustomPages(deps: ToolDeps, input: { app: string; limit?: number; cursor?: string }): Promise<string> {
  const app = await deps.apps.resolve(input.app);
  const doc = await deps.client.get<AppCustomProductPageAttributes>(`/v1/apps/${app.id}/appCustomProductPages`, {
    include: "appCustomProductPageVersions",
    "limit[appCustomProductPageVersions]": 50,
    "fields[appCustomProductPages]": "name,url,visible,appCustomProductPageVersions",
    "fields[appCustomProductPageVersions]": "version,state,deepLink",
    limit: input.limit ?? DEFAULT_LIMIT,
    cursor: input.cursor,
  });
  const pages = asList(doc);
  if (pages.length === 0) return `No custom product pages found for ${appLabel(app)}.`;

  const lines: string[] = [];
  for (const p of pages) {
    const a = p.attributes ?? {};
    const latest = latestVersion(p, doc.included ?? []);
    const parts = [a.name ?? "(unnamed)", a.visible ? "visible" : "hidden", latest ? humanize(latest.attributes?.state) : "no versions", a.url];
    lines.push(`• ${parts.filter(Boolean).join(" · ")}`);
    if (!latest) continue;
    const locs = asList(
      await deps.client.get<AppCustomProductPageLocalizationAttributes>(`/v1/appCustomProductPageVersions/${latest.id}/appCustomProductPageLocalizations`, {
        "fields[appCustomProductPageLocalizations]": "locale,promotionalText",
        limit: 50,
      }),
    );
    for (const l of locs) {
      if (l.attributes?.promotionalText) lines.push(`  ${l.attributes.locale ?? "—"}: ${truncate(l.attributes.promotionalText.replace(/\s*\n\s*/g, " "), 170)}`);
    }
  }
  return capOutput(render(`Custom product pages for ${appLabel(app)} — ${pages.length} shown:`, lines), undefined, pagingFooter(pages.length, doc));
}
