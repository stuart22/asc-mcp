import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { PLATFORMS } from "./asc/types.ts";
import type { ToolDeps } from "./format/common.ts";
import { getApp, listApps } from "./tools/apps.ts";
import { BUILD_STATUSES, listBuilds } from "./tools/builds.ts";
import { listCustomerReviews } from "./tools/reviews.ts";
import { listBetaGroups, listBetaTesters } from "./tools/testflight.ts";
import { listAppStoreVersions } from "./tools/versions.ts";

export const SERVER_NAME = "asc-mcp";
export const SERVER_VERSION = "0.1.0";

export const TOOL_NAMES = [
  "list_apps",
  "get_app",
  "list_builds",
  "list_beta_groups",
  "list_beta_testers",
  "list_app_store_versions",
  "list_customer_reviews",
] as const;

const app = z.string().trim().min(1).max(200).describe("The app: its name (e.g. \"Acme\"), bundle ID (com.example.app), or numeric Apple ID.");
const limit = z.number().int().min(1).max(200).optional().describe("How many items to return (default 20, max 200).");
const cursor = z.string().min(1).max(500).optional().describe("Paging cursor from a previous result's \"More available\" line.");
const platform = z.enum(PLATFORMS).optional().describe("Only this platform.");

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

/** Builds the MCP server with every milestone-1 tool. All tools are read-only. */
export function createServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });

  const run = (fn: () => Promise<string>) => async () => {
    try {
      return { content: [{ type: "text" as const, text: await fn() }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error.";
      return { content: [{ type: "text" as const, text: message }], isError: true };
    }
  };

  server.registerTool(
    "list_apps",
    {
      title: "List apps",
      description: "Read-only. Lists the apps in App Store Connect that your API key can see, with bundle IDs and Apple IDs. Optionally filter by part of the name or bundle ID.",
      inputSchema: z.object({
        search: z.string().trim().min(1).max(200).optional().describe("Part of an app name or bundle ID."),
        limit: z.number().int().min(1).max(200).optional().describe("How many apps to show (default 50)."),
      }),
      annotations: { title: "List apps", ...READ_ONLY },
    },
    async (args) => run(() => listApps(deps, args))(),
  );

  server.registerTool(
    "get_app",
    {
      title: "Get app details",
      description: "Read-only. Shows one app's details (bundle ID, Apple ID, SKU, primary locale) and its latest App Store version and state per platform.",
      inputSchema: z.object({ app }),
      annotations: { title: "Get app details", ...READ_ONLY },
    },
    async (args) => run(() => getApp(deps, args))(),
  );

  server.registerTool(
    "list_builds",
    {
      title: "List builds",
      description:
        "Read-only. Lists an app's uploaded builds, newest first, with version, build number, platform, processing status (processing / ready / failed / invalid), upload time and expiry. Use status \"processing\" to see builds still being processed by Apple.",
      inputSchema: z.object({
        app,
        status: z.enum(BUILD_STATUSES).optional().describe("Only builds with this processing status."),
        version: z.string().trim().min(1).max(50).optional().describe("Only builds for this app version, e.g. \"1.4.0\"."),
        platform,
        limit,
        cursor,
      }),
      annotations: { title: "List builds", ...READ_ONLY },
    },
    async (args) => run(() => listBuilds(deps, args))(),
  );

  server.registerTool(
    "list_beta_groups",
    {
      title: "List TestFlight groups",
      description: "Read-only. Lists an app's TestFlight beta groups, showing whether each is internal or external and whether its public link is on.",
      inputSchema: z.object({ app, limit, cursor }),
      annotations: { title: "List TestFlight groups", ...READ_ONLY },
    },
    async (args) => run(() => listBetaGroups(deps, args))(),
  );

  server.registerTool(
    "list_beta_testers",
    {
      title: "List TestFlight testers",
      description:
        "Read-only. Lists TestFlight testers for an app (or for one of its beta groups), with name, email, status (invited / accepted / installed …) and how they were invited.",
      inputSchema: z.object({
        app,
        group: z.string().trim().min(1).max(200).optional().describe("Only testers in this beta group (name or ID)."),
        limit,
        cursor,
      }),
      annotations: { title: "List TestFlight testers", ...READ_ONLY },
    },
    async (args) => run(() => listBetaTesters(deps, args))(),
  );

  server.registerTool(
    "list_app_store_versions",
    {
      title: "List App Store versions",
      description:
        "Read-only. Lists an app's App Store versions, newest first, with platform, state (e.g. prepare for submission, waiting for review, in review, ready for distribution, rejected) and release type.",
      inputSchema: z.object({ app, platform, limit: z.number().int().min(1).max(200).optional().describe("How many versions to show (default 10, max 200).") }),
      annotations: { title: "List App Store versions", ...READ_ONLY },
    },
    async (args) => run(() => listAppStoreVersions(deps, args))(),
  );

  server.registerTool(
    "list_customer_reviews",
    {
      title: "List customer reviews",
      description: "Read-only. Lists an app's App Store customer reviews, newest first, with star rating, title, text (trimmed), country and date. Optionally filter by star rating or territory.",
      inputSchema: z.object({
        app,
        rating: z.number().int().min(1).max(5).optional().describe("Only reviews with this many stars."),
        territory: z
          .string()
          .trim()
          .regex(/^[A-Za-z]{3}$/)
          .transform((s) => s.toUpperCase())
          .optional()
          .describe("Only reviews from this App Store territory, as a 3-letter code (e.g. USA, GBR, DEU)."),
        limit,
        cursor,
      }),
      annotations: { title: "List customer reviews", ...READ_ONLY },
    },
    async (args) => run(() => listCustomerReviews(deps, args))(),
  );

  return server;
}
