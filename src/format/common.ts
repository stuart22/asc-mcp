import { nextCursor, type AscClient } from "../asc/client.ts";
import type { AppRef, AppResolver } from "../asc/resolveApp.ts";
import type { Doc, Linkage, Platform, Resource } from "../asc/types.ts";

/** What every tool function receives. */
export type ToolDeps = {
  client: Pick<AscClient, "get">;
  apps: Pick<AppResolver, "resolve" | "listAll">;
  /** Clock in milliseconds. */
  now: () => number;
};

export const DEFAULT_LIMIT = 20;

/** "2026-11-05 14:02 UTC", or "—" when missing/invalid. */
export function fmtDate(iso: string | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "—";
  return new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/** "2026-11-05", or "—". */
export function fmtDay(iso: string | undefined): string {
  return fmtDate(iso).slice(0, 10);
}

/** "just now" / "23 min ago" / "3 h ago" / "4 d ago"; "" when missing. */
export function fmtAge(iso: string | undefined, nowMs: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "";
  const minutes = Math.floor((nowMs - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** Footer telling Claude more results exist and how to get them; "" when there are none. */
export function pagingFooter(shown: number, doc: Doc<unknown>): string {
  const cursor = nextCursor(doc);
  if (!cursor) return "";
  const total = doc.meta?.paging?.total;
  const more = `More available — call again with cursor: "${cursor}".`;
  return total !== undefined ? `Showing ${shown} of ${total}. ${more}` : more;
}

export function truncate(s: string | undefined, max: number): string {
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

const PLATFORM_NAMES: Record<Platform, string> = { IOS: "iOS", MAC_OS: "macOS", TV_OS: "tvOS", VISION_OS: "visionOS" };
export function fmtPlatform(p: string | undefined): string {
  return p ? (PLATFORM_NAMES[p as Platform] ?? p) : "—";
}

/** "READY_FOR_DISTRIBUTION" → "ready for distribution". */
export function humanize(state: string | undefined): string {
  return state ? state.toLowerCase().replace(/_/g, " ") : "unknown";
}

export function appLabel(app: AppRef): string {
  return `${app.name} (${app.bundleId})`;
}

export function asList<A>(doc: Doc<A>): Resource<A>[] {
  return Array.isArray(doc.data) ? doc.data : [doc.data];
}

/** Finds the included resource a to-one relationship points at. */
export function related<A>(doc: Doc<unknown>, r: Resource<unknown>, rel: string): Resource<A> | undefined {
  const link = r.relationships?.[rel]?.data;
  if (!link || Array.isArray(link)) return undefined;
  return doc.included?.find((i) => i.type === (link as Linkage).type && i.id === (link as Linkage).id) as Resource<A> | undefined;
}

/** Joins non-empty parts into a body with an optional footer. */
export function render(header: string, lines: string[], footer = ""): string {
  return [header, ...lines, ...(footer ? [footer] : [])].join("\n");
}
