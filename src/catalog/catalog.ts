// The generated catalog of Apple's read-only look-ups (see scripts/build-catalog.ts).
import type { AreaName } from "../areas/areas.ts";
import data from "./catalog.json" with { type: "json" };
import type { Catalog, CatalogEntry } from "./types.ts";

export const CATALOG = data as unknown as Catalog;

const BY_PATH = new Map(CATALOG.entries.map((e) => [e.path, e]));

export function findEntry(path: string): CatalogEntry | undefined {
  return BY_PATH.get(path);
}

export function entriesFor(area: AreaName): CatalogEntry[] {
  return CATALOG.entries.filter((e) => e.area === area).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
