// The text an area tool returns when called without a look-up, and the detail for one look-up.
import { CATALOG, entriesFor } from "../catalog/catalog.ts";
import type { CatalogEntry, ParamSpec } from "../catalog/types.ts";
import { AREAS, type AreaName } from "./areas.ts";

export type PolishedSummary = { name: string; summary: string; argsHelp: string; needsApp: boolean };

/** "filter[eventState]" → "eventState"; "exists[parent]" → "parent". */
export function shortName(name: string): string | undefined {
  return /^(?:filter|exists)\[(.+)\]$/.exec(name)?.[1];
}

export function renderIndex(area: AreaName, polished: readonly PolishedSummary[]): string {
  const title = AREAS.find((a) => a.name === area)?.title ?? area;
  const lines = [`${title} — read-only. Pass one of these as \`lookup\`.`];
  if (polished.length) {
    lines.push("Tidied look-ups:");
    for (const p of polished) {
      const notes = [p.needsApp ? "needs app" : "", p.argsHelp ? `params: ${p.argsHelp}` : ""].filter(Boolean);
      lines.push(`• ${p.name} — ${p.summary}${notes.length ? ` (${notes.join("; ")})` : ""}`);
    }
  }
  lines.push("All look-ups in Apple's API — pass `app` for /apps/{id}/ paths, `id` for other {id} paths, `explain: true` for a look-up's parameters:");
  for (const e of entriesFor(area)) {
    const filters = e.params.map((p) => shortName(p.name)).filter((n): n is string => n !== undefined);
    lines.push(`• ${e.path}${filters.length ? ` — filters: ${filters.join(", ")}` : ""}${e.deprecated ? " (deprecated)" : ""}`);
  }
  return lines.join("\n");
}

function describeParam(p: ParamSpec): string {
  let d: string;
  if (p.fieldSet) d = `comma list of fields: ${(CATALOG.fieldSets[p.fieldSet] ?? []).join(", ")}`;
  else if (p.name === "limit" || p.name.startsWith("limit[")) d = `1–${p.max ?? 200}${p.name === "limit" ? " (default 20)" : ""}`;
  else if (p.values) d = `${p.type === "array" ? "one or more of" : "one of"}: ${p.values.join(", ")}`;
  else if (p.type === "integer") d = "a whole number";
  else if (p.type === "boolean") d = "true or false";
  else if (p.type === "array") d = "one or more values, comma-separated";
  else d = "text";
  return `• ${p.name} — ${d}${p.required ? " — required" : ""}`;
}

export function explainEntry(entry: CatalogEntry): string {
  const lines = [`${entry.path}${entry.deprecated ? " (deprecated by Apple)" : ""}`];
  if (entry.params.length) {
    lines.push("Parameters (filters can also be passed by their short name, e.g. eventState for filter[eventState]):");
    lines.push(...entry.params.map(describeParam));
  } else lines.push("No parameters.");
  lines.push(`• cursor — from a previous "More available" line`);
  return lines.join("\n");
}
