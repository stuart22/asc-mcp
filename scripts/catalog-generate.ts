// Turns Apple's official App Store Connect OpenAPI spec into the catalog of read-only look-ups.
// Pure: no file or network access. See scripts/build-catalog.ts for the command.
import type { AreaName } from "../src/areas/areas.ts";
import type { Catalog, CatalogEntry, ParamSpec, ResponseKind } from "../src/catalog/types.ts";

// First match wins, on the operation's first tag.
const TAG_AREAS: readonly [RegExp, AreaName][] = [
  [/^GameCenter/, "game_center"],
  [/^(Ci|Scm)/, "xcode_cloud"],
  [/^(Beta|BuildBetaDetails|SandboxTesters)/, "testflight"],
  [/^(Subscription|WinBackOffers|RetentionM|RetentionOffers)/, "subscriptions"],
  [/^(InAppPurchase|PromotedPurchases)/, "in_app_purchases"],
  [/^AppEvent/, "in_app_events"],
  [/^(AppCustomProductPage|AppStoreVersionExperiment)/, "custom_product_pages"],
  [/^(AppStoreVersion|AppScreenshot|AppPreview|AppStoreReview|ReviewSubmissions|AppAssetLibrar|AssetLibrar|SearchKeywords)/, "product_page"],
  [/^(AppPrice|AppAvailabilit|Territories|TerritoryAvailabilities)/, "pricing"],
  [/^(Builds|BuildBundles|BuildUpload|PreReleaseVersions|Metrics|Perf|DiagnosticSignatures|BackgroundAsset)/, "builds"],
  [/^CustomerReview/, "reviews"],
  [/^AppClip/, "app_clips"],
  [/^(AppInfo|AppCategories|EndUserLicense|AppEncryption|AccessibilityDecl|AppTags|RoutingAppCoverages|AndroidToIos|Nominations)/, "apps"],
  [/^(Analytics|SalesReports|FinanceReports)/, "reports"],
  [/^(Users|UserInvitations|Actors)/, "users"],
  [/^(Certificates|BundleIds|Devices|Profiles|MerchantIds|PassTypeIds|AlternativeDistribution|Marketplace|Webhooks)/, "certificates_and_distribution"],
  [/^Apps$/, "apps"],
];

type AnyObj = Record<string, any>;

function areaFor(tag: string, path: string): AreaName | undefined {
  let key = tag;
  if (tag === "Apps") {
    // /apps/{id}/metrics/<x> is filed by <x> (e.g. betaTesterUsages → TestFlight).
    const m = /^\/v\d+\/apps\/\{id\}\/([A-Za-z0-9]+)(?:\/([A-Za-z0-9]+))?/.exec(path);
    const seg = m?.[1] === "metrics" && m[2] ? m[2] : m?.[1];
    if (seg) key = seg[0]!.toUpperCase() + seg.slice(1);
  }
  for (const [re, area] of TAG_AREAS) if (re.test(key)) return area;
  return undefined;
}

function resolve(spec: AnyObj, obj: AnyObj): AnyObj {
  let cur = obj;
  while (cur && typeof cur.$ref === "string" && cur.$ref.startsWith("#/")) {
    cur = cur.$ref
      .slice(2)
      .split("/")
      .reduce((o: AnyObj | undefined, k: string) => o?.[k.replace(/~1/g, "/").replace(/~0/g, "~")], spec) as AnyObj;
  }
  return cur;
}

function responseKind(op: AnyObj): { response: ResponseKind; accept?: string } {
  const codes = Object.keys(op.responses ?? {}).filter((c) => /^2\d\d$/.test(c)).sort();
  const types = Object.keys(op.responses?.[codes[0] ?? ""]?.content ?? {});
  const t = types[0] ?? "application/json";
  if (t === "application/json") return { response: "json" };
  if (t === "text/csv") return { response: "csv" };
  if (t === "application/a-gzip") return { response: "gzip-tsv" };
  if (t.startsWith("application/vnd.apple.")) return { response: "apple-json", accept: t };
  throw new Error(`Unknown response type ${t}`);
}

function param(spec: AnyObj, raw: AnyObj, fieldSets: Record<string, string[]>): ParamSpec {
  const p = resolve(spec, raw);
  const schema = resolve(spec, p.schema ?? {});
  const name: string = p.name;
  const out: ParamSpec = { name, type: schema.type === "integer" || schema.type === "boolean" || schema.type === "array" ? schema.type : "string" };
  const fieldSet = /^fields\[(.+)\]$/.exec(name)?.[1];
  const values: string[] | undefined = schema.enum ?? resolve(spec, schema.items ?? {}).enum;
  if (fieldSet) {
    out.type = "array";
    out.fieldSet = fieldSet;
    const known = (fieldSets[fieldSet] ??= []);
    for (const v of values ?? []) if (!known.includes(v)) known.push(v);
  } else if (name === "limit" || name.startsWith("limit[")) {
    out.type = "integer";
    if (typeof schema.maximum === "number") out.max = schema.maximum;
  } else if (values) out.values = [...values];
  if (p.required) out.required = true;
  return out;
}

export function buildCatalog(spec: unknown): Catalog {
  const s = spec as AnyObj;
  const fieldSets: Record<string, string[]> = {};
  const entries: CatalogEntry[] = [];
  const unmapped = new Set<string>();
  for (const [path, item] of Object.entries<AnyObj>(s.paths ?? {})) {
    const op = item.get;
    if (!op) continue;
    if (path.includes("/relationships/")) continue;
    if (/OneTimeUseCodes\/\{id\}\/values$/.test(path)) continue;
    const tag: string = op.tags?.[0] ?? "(untagged)";
    const area = areaFor(tag, path);
    if (!area) {
      unmapped.add(tag);
      continue;
    }
    const rawParams = [...(item.parameters ?? []), ...(op.parameters ?? [])].map((p: AnyObj) => resolve(s, p)).filter((p: AnyObj) => p.in === "query");
    const entry: CatalogEntry = { path, area, ...responseKind(op), params: rawParams.map((p: AnyObj) => param(s, p, fieldSets)) };
    if (op.deprecated) entry.deprecated = true;
    entries.push(entry);
  }
  if (unmapped.size) throw new Error(`Unmapped Apple tags: ${[...unmapped].sort().join(", ")}`);
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { specVersion: String(s.info?.version ?? ""), fieldSets, entries };
}
