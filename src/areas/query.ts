// Checks a catalog look-up's parameters against Apple's spec and builds the query to send.
import type { Query } from "../asc/client.ts";
import type { CatalogEntry, ParamSpec } from "../catalog/types.ts";
import { DEFAULT_LIMIT } from "../format/common.ts";
import { explainEntry } from "./indexText.ts";

export type ParamValue = string | number | boolean | string[];

const DEFAULT_MAX = 200;

function fail(entry: CatalogEntry, problem: string): never {
  throw new Error(`${problem}\n\n${explainEntry(entry)}`);
}

function resolveKey(entry: CatalogEntry, key: string): ParamSpec | undefined {
  const byName = (n: string) => entry.params.find((p) => p.name === n);
  return byName(key) ?? byName(`filter[${key}]`) ?? byName(`exists[${key}]`);
}

function listOf(value: ParamValue): string[] {
  const raw = Array.isArray(value) ? value : String(value).split(",");
  return raw.map((s) => s.trim()).filter((s) => s !== "");
}

function capLimit(entry: CatalogEntry, spec: ParamSpec, value: ParamValue | undefined): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) fail(entry, `${spec.name} must be a whole number of 1 or more.`);
  return Math.min(n, spec.max ?? DEFAULT_MAX);
}

function convert(entry: CatalogEntry, spec: ParamSpec, value: ParamValue, fieldSets: Record<string, string[]>): string | number | boolean {
  if (spec.name === "limit" || spec.name.startsWith("limit[")) return capLimit(entry, spec, value);
  const allowed = spec.fieldSet ? fieldSets[spec.fieldSet] : spec.values;
  if (allowed) {
    const items = listOf(value).map((v) => allowed.find((a) => a.toLowerCase() === v.toLowerCase()) ?? fail(entry, `Invalid value "${v}" for ${spec.name}. ${spec.fieldSet ? "Fields" : "Values"}: ${allowed.join(", ")}.`));
    if (spec.type !== "array" && items.length > 1) fail(entry, `${spec.name} takes one value.`);
    return items.join(",");
  }
  switch (spec.type) {
    case "integer": {
      const n = Number(value);
      if (typeof value === "boolean" || Array.isArray(value) || !Number.isInteger(n)) fail(entry, `${spec.name} must be a whole number.`);
      return n;
    }
    case "boolean": {
      const s = String(value).toLowerCase();
      if (s !== "true" && s !== "false") fail(entry, `${spec.name} must be true or false.`);
      return s === "true";
    }
    case "array":
      return listOf(value).join(",");
    default:
      return Array.isArray(value) ? value.join(",") : String(value);
  }
}

export function buildQuery(
  entry: CatalogEntry,
  params: Record<string, ParamValue> | undefined,
  opts: { limit?: number; cursor?: string; appId?: string },
  fieldSets: Record<string, string[]>,
): Query {
  const query: Query = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (key === "cursor") {
      query.cursor = String(value);
      continue;
    }
    const spec = resolveKey(entry, key);
    if (!spec) fail(entry, `Unknown parameter "${key}" for ${entry.path}.`);
    query[spec.name] = convert(entry, spec, value, fieldSets);
  }
  const limitSpec = entry.params.find((p) => p.name === "limit");
  if (limitSpec && (opts.limit !== undefined || query.limit === undefined)) query.limit = capLimit(entry, limitSpec, opts.limit ?? DEFAULT_LIMIT);
  if (opts.cursor) query.cursor = opts.cursor;
  if (opts.appId) {
    for (const name of ["filter[app]", "filter[apps]"]) {
      if (entry.params.some((p) => p.name === name) && query[name] === undefined) query[name] = opts.appId;
    }
  }
  const missing = entry.params.filter((p) => p.required && query[p.name] === undefined).map((p) => p.name);
  if (missing.length) fail(entry, `Missing required parameter(s): ${missing.join(", ")}.`);
  return query;
}
