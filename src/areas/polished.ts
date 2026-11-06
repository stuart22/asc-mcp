// Hand-tidied look-ups: the everyday questions, with answers shaped for reading.
import { z } from "zod";
import { PLATFORMS } from "../asc/types.ts";
import type { ToolDeps } from "../format/common.ts";
import { getApp, listApps } from "../tools/apps.ts";
import { BUILD_STATUSES, listBuilds } from "../tools/builds.ts";
import { listing, screenshots } from "../tools/productPage.ts";
import { listCustomerReviews } from "../tools/reviews.ts";
import { listBetaGroups, listBetaTesters } from "../tools/testflight.ts";
import { listAppStoreVersions } from "../tools/versions.ts";
import type { AreaName } from "./areas.ts";

export type PolishedInput = { app?: string; limit?: number; cursor?: string; args: Record<string, unknown> };

export type PolishedLookup = {
  name: string;
  summary: string;
  argsHelp: string;
  needsApp: boolean;
  args: z.ZodType<Record<string, unknown>>;
  run(deps: ToolDeps, input: PolishedInput): Promise<string>;
};

const upper = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : v);
const lower = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : v);

export const platformArg = z.preprocess(upper, z.enum(PLATFORMS)).optional();
const text = (max: number) => z.string().trim().min(1).max(max).optional();
const none = z.object({}).strict();
const pageArgs = z.object({ version: text(50), platform: platformArg, locale: text(20) }).strict();

/** Narrows the app after runLookup has checked it is present. */
export const appOf = (input: PolishedInput): string => input.app ?? "";

export const POLISHED: Record<AreaName, readonly PolishedLookup[]> = {
  apps: [
    {
      name: "list",
      summary: "Apps your key can see, with bundle IDs and Apple IDs",
      argsHelp: "search",
      needsApp: false,
      args: z.object({ search: text(200) }).strict(),
      run: (deps, i) => listApps(deps, { search: i.args.search as string | undefined, limit: i.limit }),
    },
    {
      name: "details",
      summary: "One app's details and latest App Store version per platform",
      argsHelp: "",
      needsApp: true,
      args: none,
      run: (deps, i) => getApp(deps, { app: appOf(i) }),
    },
  ],
  product_page: [
    {
      name: "versions",
      summary: "App Store versions, newest first, with state and release type",
      argsHelp: "platform",
      needsApp: true,
      args: z.object({ platform: platformArg }).strict(),
      run: (deps, i) => listAppStoreVersions(deps, { app: appOf(i), platform: i.args.platform as never, limit: i.limit }),
    },
    {
      name: "listing",
      summary: "Store listing text per language: name, subtitle, promo text, description, keywords, what's new, URLs (editable version, else live)",
      argsHelp: "version, platform, locale",
      needsApp: true,
      args: pageArgs,
      run: (deps, i) => listing(deps, { app: appOf(i), ...(i.args as object) }),
    },
    {
      name: "screenshots",
      summary: "Screenshot and preview counts per language and device type",
      argsHelp: "version, platform, locale",
      needsApp: true,
      args: pageArgs,
      run: (deps, i) => screenshots(deps, { app: appOf(i), ...(i.args as object) }),
    },
  ],
  custom_product_pages: [],
  in_app_events: [],
  testflight: [
    {
      name: "groups",
      summary: "Beta groups, internal or external, public link",
      argsHelp: "",
      needsApp: true,
      args: none,
      run: (deps, i) => listBetaGroups(deps, { app: appOf(i), limit: i.limit, cursor: i.cursor }),
    },
    {
      name: "testers",
      summary: "Testers for the app or one group, with status",
      argsHelp: "group",
      needsApp: true,
      args: z.object({ group: text(200) }).strict(),
      run: (deps, i) => listBetaTesters(deps, { app: appOf(i), group: i.args.group as string | undefined, limit: i.limit, cursor: i.cursor }),
    },
  ],
  builds: [
    {
      name: "list",
      summary: "Builds, newest first, with processing status and expiry",
      argsHelp: "status, version, platform",
      needsApp: true,
      args: z
        .object({
          status: z.preprocess(lower, z.enum(BUILD_STATUSES)).optional(),
          version: text(50),
          platform: platformArg,
        })
        .strict(),
      run: (deps, i) => listBuilds(deps, { app: appOf(i), ...(i.args as object), limit: i.limit, cursor: i.cursor }),
    },
  ],
  in_app_purchases: [],
  subscriptions: [],
  pricing: [],
  reviews: [
    {
      name: "list",
      summary: "Customer reviews, newest first, with stars, text and country",
      argsHelp: "rating, territory",
      needsApp: true,
      args: z
        .object({
          rating: z.coerce.number().int().min(1).max(5).optional(),
          territory: z
            .string()
            .trim()
            .regex(/^[A-Za-z]{3}$/)
            .transform((s) => s.toUpperCase())
            .optional(),
        })
        .strict(),
      run: (deps, i) => listCustomerReviews(deps, { app: appOf(i), ...(i.args as object), limit: i.limit, cursor: i.cursor }),
    },
  ],
  xcode_cloud: [],
  reports: [],
  users: [],
  game_center: [],
  app_clips: [],
  certificates_and_distribution: [],
};
