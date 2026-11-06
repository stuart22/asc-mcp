import type { AppStoreVersionAttributes } from "../asc/types.ts";
import { fmtPlatform, humanize, render, type ToolDeps } from "../format/common.ts";
import { fetchAllVersions, versionState } from "./versions.ts";

const DEFAULT_APP_LIMIT = 50;

export async function listApps(deps: ToolDeps, input: { search?: string; limit?: number }): Promise<string> {
  const all = await deps.apps.listAll();
  const needle = input.search?.trim().toLowerCase();
  const matches = needle ? all.filter((a) => a.name.toLowerCase().includes(needle) || a.bundleId.toLowerCase().includes(needle)) : all;
  if (matches.length === 0) {
    return needle ? `No apps matching "${input.search}".` : "Your key can't see any apps.";
  }
  const limit = input.limit ?? DEFAULT_APP_LIMIT;
  const shown = matches.slice(0, limit);
  const header = needle ? `Apps matching "${input.search}" — ${matches.length}:` : `${matches.length} apps visible to your key:`;
  const lines = shown.map((a) => `• ${[a.name, a.bundleId, `Apple ID ${a.id}`, ...(a.sku ? [`SKU ${a.sku}`] : [])].join(" · ")}`);
  const more = matches.length - shown.length;
  return render(header, lines, more > 0 ? `…and ${more} more. Use search to narrow it down.` : "");
}

export async function getApp(deps: ToolDeps, input: { app: string }): Promise<string> {
  const app = await deps.apps.resolve(input.app);
  const { versions } = await fetchAllVersions(deps, app.id);
  const latest = new Map<string, AppStoreVersionAttributes>();
  for (const v of versions) {
    const a = v.attributes ?? {};
    const key = a.platform ?? "—";
    if (!latest.has(key)) latest.set(key, a);
  }

  const lines = [
    `• Bundle ID: ${app.bundleId}`,
    `• Apple ID: ${app.id}`,
    ...(app.sku ? [`• SKU: ${app.sku}`] : []),
    ...(app.primaryLocale ? [`• Primary locale: ${app.primaryLocale}`] : []),
    latest.size ? "• Latest App Store version per platform:" : "• No App Store versions yet.",
    ...[...latest.values()].map((a) => `  – ${fmtPlatform(a.platform)} ${a.versionString ?? "—"} — ${humanize(versionState(a))}`),
  ];
  return render(app.name, lines);
}
