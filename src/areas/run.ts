// Runs one call to an area tool: index, explanation, tidied look-up or catalog look-up.
import { CATALOG, findEntry } from "../catalog/catalog.ts";
import type { ToolDeps } from "../format/common.ts";
import { formatAppleJson, formatDoc, formatTable } from "../format/generic.ts";
import type { AreaName } from "./areas.ts";
import { explainEntry, renderIndex } from "./indexText.ts";
import { POLISHED } from "./polished.ts";
import { buildQuery, type ParamValue } from "./query.ts";

export type AreaInput = {
  lookup?: string;
  app?: string;
  id?: string;
  params?: Record<string, ParamValue>;
  limit?: number;
  cursor?: string;
  explain?: boolean;
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,200}$/;

type Issue = { path: PropertyKey[]; message: string; code?: string; values?: unknown[]; keys?: string[] };

function describeIssue(i: Issue): string {
  const where = i.path.length ? `${i.path.map(String).join(".")}: ` : "";
  if (i.code === "invalid_value" && i.values) return `${where}must be one of ${i.values.map(String).join(", ")}`;
  if (i.code === "unrecognized_keys" && i.keys) return `unknown param ${i.keys.join(", ")}`;
  return where + i.message;
}

export async function runLookup(deps: ToolDeps, area: AreaName, input: AreaInput): Promise<string> {
  const polished = POLISHED[area];
  const lookup = input.lookup?.trim();
  if (!lookup) return renderIndex(area, polished);

  const p = polished.find((x) => x.name === lookup.toLowerCase());
  if (p) {
    const parsed = p.args.safeParse(input.params ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map(describeIssue).join("; ");
      throw new Error(`Invalid params for ${area} ${p.name} (${issues}). Accepted params: ${p.argsHelp || "none"}.`);
    }
    if (p.needsApp && !input.app) throw new Error(`The ${p.name} look-up needs \`app\` (name, bundle ID or Apple ID).`);
    return p.run(deps, { app: input.app, limit: input.limit, cursor: input.cursor, args: parsed.data });
  }

  const entry = lookup.startsWith("/") ? findEntry(lookup) : undefined;
  if (!entry) throw new Error(`Unknown look-up "${lookup}". Call ${area} with no lookup to see what's available.`);
  if (entry.area !== area) throw new Error(`That look-up belongs to the ${entry.area} tool.`);
  if (input.explain) return explainEntry(entry);

  let path = entry.path;
  let appId: string | undefined;
  if (path.includes("{id}")) {
    let id = input.id;
    if (!id) {
      if (/^\/v\d+\/apps\/\{id\}/.test(path)) {
        if (!input.app) throw new Error("This look-up needs `app` (name, bundle ID or Apple ID).");
        id = (await deps.apps.resolve(input.app)).id;
      } else throw new Error("This look-up needs `id` (an Apple ID from a previous result).");
    }
    if (!SAFE_ID.test(id)) throw new Error("`id` must be an Apple ID: letters, digits, '-' or '_' only.");
    path = path.replace("{id}", id);
  } else if (input.app) {
    appId = (await deps.apps.resolve(input.app)).id;
  }

  const query = buildQuery(entry, input.params, { limit: input.limit, cursor: input.cursor, appId }, CATALOG.fieldSets);
  switch (entry.response) {
    case "json":
      return formatDoc(await deps.client.get(path, query), path);
    case "csv":
      return formatTable(await deps.client.getText(path, query, "text/csv"), ",", path);
    case "gzip-tsv":
      return formatTable(await deps.client.getText(path, query, "application/a-gzip"), "\t", path);
    case "apple-json":
      return formatAppleJson(await deps.client.getText(path, query, entry.accept ?? "application/json"), path);
  }
}
