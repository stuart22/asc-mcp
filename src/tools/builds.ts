import type { BuildAttributes, BuildProcessingState, Platform, PreReleaseVersionAttributes } from "../asc/types.ts";
import { DEFAULT_LIMIT, appLabel, asList, fmtAge, fmtDate, fmtDay, fmtPlatform, pagingFooter, related, render, type ToolDeps } from "../format/common.ts";

export const BUILD_STATUSES = ["processing", "ready", "failed", "invalid"] as const;
export type BuildStatus = (typeof BUILD_STATUSES)[number];

const TO_APPLE: Record<BuildStatus, BuildProcessingState> = { processing: "PROCESSING", ready: "VALID", failed: "FAILED", invalid: "INVALID" };
const FROM_APPLE: Record<BuildProcessingState, BuildStatus> = { PROCESSING: "processing", VALID: "ready", FAILED: "failed", INVALID: "invalid" };

export type ListBuildsInput = { app: string; status?: BuildStatus; version?: string; platform?: Platform; limit?: number; cursor?: string };

export async function listBuilds(deps: ToolDeps, input: ListBuildsInput): Promise<string> {
  const app = await deps.apps.resolve(input.app);
  const doc = await deps.client.get<BuildAttributes>("/v1/builds", {
    "filter[app]": app.id,
    "filter[processingState]": input.status ? TO_APPLE[input.status] : undefined,
    "filter[preReleaseVersion.version]": input.version,
    "filter[preReleaseVersion.platform]": input.platform,
    sort: "-uploadedDate",
    include: "preReleaseVersion",
    "fields[builds]": "version,uploadedDate,expirationDate,expired,processingState,buildAudienceType,preReleaseVersion",
    "fields[preReleaseVersions]": "version,platform",
    limit: input.limit ?? DEFAULT_LIMIT,
    cursor: input.cursor,
  });

  const builds = asList(doc);
  const what = input.status ? `${input.status} builds` : "builds";
  if (builds.length === 0) return `No ${what} found for ${appLabel(app)}.`;

  const now = deps.now();
  const lines = builds.map((b) => {
    const a = b.attributes ?? {};
    const pre = related<PreReleaseVersionAttributes>(doc, b, "preReleaseVersion")?.attributes;
    const status = a.processingState ? FROM_APPLE[a.processingState] : "unknown status";
    const age = fmtAge(a.uploadedDate, now);
    const parts = [
      `${pre?.version ?? "—"} (${a.version ?? "—"})`,
      fmtPlatform(pre?.platform),
      status,
      ...(a.buildAudienceType === "INTERNAL_ONLY" ? ["internal testing only"] : []),
      `uploaded ${fmtDate(a.uploadedDate)}${age ? ` (${age})` : ""}`,
      ...(a.expired ? ["expired"] : a.processingState === "VALID" && a.expirationDate ? [`expires ${fmtDay(a.expirationDate)}`] : []),
    ];
    return `• ${parts.join(" · ")}`;
  });

  const header = `${what[0]!.toUpperCase()}${what.slice(1)} for ${appLabel(app)} — ${builds.length} shown, newest first:`;
  return render(header, lines, pagingFooter(builds.length, doc));
}
