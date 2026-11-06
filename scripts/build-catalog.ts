// Usage: npm run catalog -- <path/to/openapi.oas.json> [out]
// Download Apple's App Store Connect OpenAPI spec from developer.apple.com first.
import { readFileSync, writeFileSync } from "node:fs";
import { buildCatalog } from "./catalog-generate.ts";

const [specPath, out = "src/catalog/catalog.json"] = process.argv.slice(2);
if (!specPath) {
  process.stderr.write("usage: npm run catalog -- <path/to/openapi.oas.json> [out]\n");
  process.exit(2);
}
const catalog = buildCatalog(JSON.parse(readFileSync(specPath, "utf8")));
const lines = [
  "{",
  `  "specVersion": ${JSON.stringify(catalog.specVersion)},`,
  `  "fieldSets": {`,
  Object.entries(catalog.fieldSets)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(",\n"),
  "  },",
  `  "entries": [`,
  catalog.entries.map((e) => `    ${JSON.stringify(e)}`).join(",\n"),
  "  ]",
  "}",
  "",
];
writeFileSync(out, lines.join("\n"));
const counts: Record<string, number> = {};
for (const e of catalog.entries) counts[e.area] = (counts[e.area] ?? 0) + 1;
for (const [area, n] of Object.entries(counts)) process.stderr.write(`${area}: ${n}\n`);
process.stderr.write(`total: ${catalog.entries.length} (spec ${catalog.specVersion})\n`);
