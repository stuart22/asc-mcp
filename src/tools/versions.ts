import type { AppStoreVersionAttributes, Platform, Resource } from "../asc/types.ts";
import { nextCursor } from "../asc/client.ts";
import { appLabel, asList, fmtDate, fmtDay, fmtPlatform, humanize, render, type ToolDeps } from "../format/common.ts";

const DEFAULT_VERSION_LIMIT = 10;
const MAX_PAGES = 5;
const VERSION_FIELDS = "platform,versionString,appVersionState,appStoreState,releaseType,earliestReleaseDate,createdDate";

/** `appVersionState` is current; `appStoreState` is deprecated but still sent by Apple. */
export function versionState(a: AppStoreVersionAttributes): string | undefined {
  return a.appVersionState ?? a.appStoreState;
}

export function sortNewestFirst<T extends Resource<AppStoreVersionAttributes>>(items: T[]): T[] {
  return [...items].sort((x, y) => (Date.parse(y.attributes?.createdDate ?? "") || 0) - (Date.parse(x.attributes?.createdDate ?? "") || 0));
}

function releaseText(a: AppStoreVersionAttributes): string {
  switch (a.releaseType) {
    case "MANUAL":
      return "manual release";
    case "AFTER_APPROVAL":
      return "releases automatically after approval";
    case "SCHEDULED":
      return a.earliestReleaseDate ? `scheduled release (not before ${fmtDate(a.earliestReleaseDate)})` : "scheduled release";
    default:
      return "—";
  }
}

/**
 * Apple's appStoreVersions endpoint has no sort parameter, so to be sure what's
 * "newest" we fetch every version (up to 1,000) and sort them ourselves.
 */
export async function fetchAllVersions(deps: ToolDeps, appId: string, platform?: Platform): Promise<{ versions: Resource<AppStoreVersionAttributes>[]; total?: number }> {
  const versions: Resource<AppStoreVersionAttributes>[] = [];
  let cursor: string | undefined;
  let total: number | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const doc = await deps.client.get<AppStoreVersionAttributes>(`/v1/apps/${appId}/appStoreVersions`, {
      "filter[platform]": platform,
      "fields[appStoreVersions]": VERSION_FIELDS,
      limit: 200,
      cursor,
    });
    versions.push(...asList(doc));
    total = doc.meta?.paging?.total ?? total;
    cursor = nextCursor(doc);
    if (!cursor) break;
  }
  return { versions: sortNewestFirst(versions), ...(total !== undefined ? { total } : {}) };
}

export type ListVersionsInput = { app: string; platform?: Platform; limit?: number };

export async function listAppStoreVersions(deps: ToolDeps, input: ListVersionsInput): Promise<string> {
  const app = await deps.apps.resolve(input.app);
  const { versions, total } = await fetchAllVersions(deps, app.id, input.platform);
  if (versions.length === 0) return `No App Store versions found for ${appLabel(app)}.`;

  const shown = versions.slice(0, input.limit ?? DEFAULT_VERSION_LIMIT);
  const lines = shown.map((v) => {
    const a = v.attributes ?? {};
    return `• ${[a.versionString ?? "—", fmtPlatform(a.platform), humanize(versionState(a)), releaseText(a), `created ${fmtDay(a.createdDate)}`].join(" · ")}`;
  });
  const all = Math.max(total ?? 0, versions.length);
  const footer = all > shown.length ? `Showing ${shown.length} of ${all} versions. Ask for a higher limit to see more.` : "";
  return render(`App Store versions for ${appLabel(app)} — ${shown.length} shown, newest first:`, lines, footer);
}
