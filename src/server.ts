import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { AREA_NAMES, AREAS, type AreaName } from "./areas/areas.ts";
import { runLookup } from "./areas/run.ts";
import type { ToolDeps } from "./format/common.ts";

export const SERVER_NAME = "asc-mcp";
export const SERVER_VERSION = "0.2.0";

export const TOOL_NAMES = AREA_NAMES;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const inputSchema = z.object({
  lookup: z.string().trim().min(1).max(300).optional().describe("A look-up from this tool's index: a tidied name (e.g. \"list\") or an API path (e.g. \"/v1/apps/{id}/appEvents\"). Omit to see the index."),
  app: z.string().trim().min(1).max(200).optional().describe("The app: its name (e.g. \"Acme\"), bundle ID (com.example.app), or numeric Apple ID. Fills {id} in /apps/{id}/ paths."),
  id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).optional().describe("An Apple ID from a previous result. Fills {id} in other paths."),
  params: z
    .record(z.string().min(1).max(100), z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(200)).max(50)]))
    .optional()
    .describe("Look-up parameters, e.g. { \"status\": \"processing\" } or { \"eventState\": \"PUBLISHED\" }. Use explain to see what a path accepts."),
  limit: z.number().int().min(1).max(200).optional().describe("How many items to return (default 20, max 200)."),
  cursor: z.string().min(1).max(500).optional().describe("Paging cursor from a previous result's \"More available\" line."),
  explain: z.boolean().optional().describe("With an API path as lookup: show its parameters instead of calling Apple."),
});

/** Builds the MCP server with one read-only tool per App Store Connect area. */
export function createServer(deps: ToolDeps, opts: { hidden?: readonly AreaName[] } = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
  const hidden = new Set(opts.hidden ?? []);

  for (const area of AREAS) {
    if (hidden.has(area.name)) continue;
    server.registerTool(
      area.name,
      {
        title: area.title,
        description: `Read-only. ${area.covers}. Call with no \`lookup\` to see what you can look up here.`,
        inputSchema,
        annotations: { title: area.title, ...READ_ONLY },
      },
      async (args) => {
        try {
          return { content: [{ type: "text" as const, text: await runLookup(deps, area.name, args) }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unexpected error.";
          return { content: [{ type: "text" as const, text: message }], isError: true };
        }
      },
    );
  }
  return server;
}
