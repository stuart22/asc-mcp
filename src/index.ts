#!/usr/bin/env node
// Entry point: serves the asc-mcp tools over stdio. stdout is the MCP channel,
// so diagnostics go to stderr, and never include keys, tokens or request contents.
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { AREA_NAMES, parseHiddenAreas } from "./areas/areas.ts";
import { createDeps } from "./deps.ts";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.ts";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { deps, summary, problem } = createDeps(process.env, os.homedir(), serverDir);

if (problem) {
  console.error(`${SERVER_NAME}: configuration problem — ${problem}`);
}
const { hidden, unknown } = parseHiddenAreas(process.env.ASC_HIDE_AREAS);
if (unknown.length) {
  console.error(`${SERVER_NAME}: ASC_HIDE_AREAS has unknown areas: ${unknown.join(", ")}. Known: ${AREA_NAMES.join(", ")}.`);
}
console.error(`${SERVER_NAME} ${SERVER_VERSION} ready (${summary})`);

serveStdio(() => createServer(deps, { hidden }), {
  onerror: (err) => console.error(`${SERVER_NAME}: ${err.message}`),
});
