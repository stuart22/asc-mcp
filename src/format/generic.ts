// The general tidy-up: any App Store Connect response as compact text, never raw JSON.
import type { Doc, Resource } from "../asc/types.ts";
import { asList, pagingFooter, truncate } from "./common.ts";
import { capOutput, redactAttributes, UNTRUSTED_NOTE, UNTRUSTED_TYPES } from "./policy.ts";

const MAX_VALUE = 300;
const MAX_ROWS = 50;

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

/** One line per resource: line breaks inside values (e.g. in customer text) become spaces. */
function oneLine(s: string): string {
  return s.replace(/\s*[\r\n]+\s*/g, " ");
}

function scalar(v: unknown): string {
  if (Array.isArray(v)) {
    const allScalar = v.every((x) => x === null || typeof x !== "object");
    return truncate(oneLine(allScalar ? v.map(String).join(", ") : JSON.stringify(v)), MAX_VALUE);
  }
  if (typeof v === "object" && v !== null) return truncate(JSON.stringify(v), MAX_VALUE);
  return truncate(oneLine(String(v)), MAX_VALUE);
}

function attributeParts(attrs: Record<string, unknown>): string[] {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (isEmpty(v)) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (!isEmpty(v2)) parts.push(`${k}.${k2}: ${scalar(v2)}`);
      }
    } else parts.push(`${k}: ${scalar(v)}`);
  }
  return parts;
}

function resourceLine(r: Resource<Record<string, unknown>>): string {
  const parts = attributeParts(redactAttributes(r.type, r.attributes ?? {}));
  for (const [rel, value] of Object.entries(r.relationships ?? {})) {
    const data = value?.data;
    if (!data) continue;
    const ids = (Array.isArray(data) ? data : [data]).map((l) => l.id);
    if (ids.length) parts.push(`${rel}: ${ids.join(", ")}`);
  }
  return `• ${r.type} ${r.id}` + (parts.length ? ` — ${parts.join(" · ")}` : "");
}

/** Formats a JSON:API document: one line per resource, related resources after, paging footer. */
export function formatDoc(doc: Doc<Record<string, unknown>>, title: string): string {
  const main = doc.data ? asList(doc) : [];
  const included = doc.included ?? [];
  const single = !Array.isArray(doc.data);
  const lines = [single ? `${title}:` : `${title} — ${main.length} shown:`];
  if ([...main, ...included].some((r) => UNTRUSTED_TYPES.has(r.type))) lines.push(UNTRUSTED_NOTE);
  if (!single && main.length === 0) lines.push("(none)");
  lines.push(...main.map(resourceLine));
  if (included.length) lines.push("Related:", ...included.map(resourceLine));
  const footer = pagingFooter(main.length, doc);
  if (footer) lines.push(footer);
  return capOutput(lines.join("\n"));
}

function splitRow(line: string, sep: "," | "\t"): string[] {
  if (sep === "\t") return line.split("\t");
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

/** Formats CSV or TSV text: header row, then up to 50 rows. */
export function formatTable(text: string, sep: "," | "\t", title: string): string {
  const rows = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const [header, ...body] = rows;
  if (header === undefined) return `${title}:\n(no rows)`;
  const fmt = (l: string) => splitRow(l, sep).map((c) => truncate(c, MAX_VALUE)).join(" | ");
  const lines = [`${title}:`, fmt(header), ...body.slice(0, MAX_ROWS).map(fmt)];
  if (body.length > MAX_ROWS) lines.push(`(${body.length} rows; showing first ${MAX_ROWS})`);
  return capOutput(lines.join("\n"));
}

/** Formats Apple's metrics/diagnostics JSON compactly. */
export function formatAppleJson(text: string, title: string): string {
  let compact: string;
  try {
    compact = JSON.stringify(JSON.parse(text));
  } catch {
    compact = text;
  }
  return capOutput(`${title}:\n${compact}`, "Narrow it with this look-up's filters (call with explain: true to see them).");
}
