import { nextCursor, type AscClient } from "./client.ts";
import type { AppAttributes, Resource } from "./types.ts";

export type AppRef = { id: string; name: string; bundleId: string; sku?: string; primaryLocale?: string };

export class AppNotFoundError extends Error {
  override name = "AppNotFoundError";
}

const APP_FIELDS = "name,bundleId,sku,primaryLocale";
const CACHE_MS = 5 * 60 * 1000;
const MAX_PAGES = 5;
const BUNDLE_ID_RE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/**
 * Turns what a person types ("Acme", "com.acme.app", "1234567890") into an app.
 * Never guesses between several matches: it lists them so Claude can ask.
 */
export class AppResolver {
  readonly #client: Pick<AscClient, "get">;
  readonly #now: () => number;
  #cache: { at: number; apps: AppRef[] } | undefined;

  constructor(client: Pick<AscClient, "get">, now: () => number = Date.now) {
    this.#client = client;
    this.#now = now;
  }

  async resolve(query: string): Promise<AppRef> {
    const q = query.trim();
    if (!q) throw new AppNotFoundError("Say which app (name, bundle ID, or Apple ID).");

    if (/^\d+$/.test(q)) {
      const doc = await this.#client.get<AppAttributes>(`/v1/apps/${q}`, { "fields[apps]": APP_FIELDS });
      return toRef(doc.data as Resource<AppAttributes>);
    }

    if (BUNDLE_ID_RE.test(q)) {
      const doc = await this.#client.get<AppAttributes>("/v1/apps", { "filter[bundleId]": q, "fields[apps]": APP_FIELDS, limit: 2 });
      const exact = (doc.data as Resource<AppAttributes>[]).map(toRef).filter((a) => a.bundleId.toLowerCase() === q.toLowerCase());
      if (exact.length === 1) return exact[0]!;
    }

    const apps = await this.listAll();
    const needle = q.toLowerCase();
    const tiers: Array<(a: AppRef) => boolean> = [
      (a) => a.name.toLowerCase() === needle || a.bundleId.toLowerCase() === needle,
      (a) => a.name.toLowerCase().startsWith(needle),
      (a) => a.name.toLowerCase().includes(needle) || a.bundleId.toLowerCase().includes(needle),
    ];
    for (const matches of tiers) {
      const hits = apps.filter(matches);
      if (hits.length === 1) return hits[0]!;
      if (hits.length > 1) {
        throw new AppNotFoundError(`"${q}" matches ${hits.length} apps: ${hits.slice(0, 10).map(label).join("; ")}. Which one?`);
      }
    }
    const known = apps.slice(0, 10).map(label).join("; ");
    throw new AppNotFoundError(
      apps.length ? `No app matching "${q}". Apps you can see include: ${known}${apps.length > 10 ? "; …" : ""}.` : `No app matching "${q}", and your key can't see any apps.`,
    );
  }

  /** All apps visible to the key (cached for 5 minutes). */
  async listAll(): Promise<AppRef[]> {
    if (this.#cache && this.#now() - this.#cache.at < CACHE_MS) return this.#cache.apps;
    const apps: AppRef[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const doc = await this.#client.get<AppAttributes>("/v1/apps", { "fields[apps]": APP_FIELDS, limit: 200, sort: "name", cursor });
      apps.push(...(doc.data as Resource<AppAttributes>[]).map(toRef));
      cursor = nextCursor(doc);
      if (!cursor) break;
    }
    this.#cache = { at: this.#now(), apps };
    return apps;
  }
}

function toRef(r: Resource<AppAttributes>): AppRef {
  const a = r.attributes ?? {};
  return {
    id: r.id,
    name: a.name ?? "(unnamed app)",
    bundleId: a.bundleId ?? "—",
    ...(a.sku !== undefined ? { sku: a.sku } : {}),
    ...(a.primaryLocale !== undefined ? { primaryLocale: a.primaryLocale } : {}),
  };
}

function label(a: AppRef): string {
  return `${a.name} (${a.bundleId})`;
}
