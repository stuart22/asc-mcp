import type { BetaFeedbackAttributes, BetaGroupAttributes, BetaTesterAttributes, BuildAttributes, Resource } from "../asc/types.ts";
import { DEFAULT_LIMIT, appLabel, asList, fmtDate, humanize, pagingFooter, related, render, truncate, type ToolDeps } from "../format/common.ts";
import { capOutput, UNTRUSTED_NOTE } from "../format/policy.ts";
import { listBuilds } from "./builds.ts";

const GROUP_FIELDS = "name,isInternalGroup,publicLinkEnabled,publicLink,publicLinkLimitEnabled,publicLinkLimit,feedbackEnabled,createdDate";
const TESTER_FIELDS = "firstName,lastName,email,inviteType,state";

export async function listBetaGroups(deps: ToolDeps, input: { app: string; limit?: number; cursor?: string }): Promise<string> {
  const app = await deps.apps.resolve(input.app);
  const doc = await deps.client.get<BetaGroupAttributes>(`/v1/apps/${app.id}/betaGroups`, {
    "fields[betaGroups]": GROUP_FIELDS,
    limit: input.limit ?? DEFAULT_LIMIT,
    cursor: input.cursor,
  });
  const groups = asList(doc);
  if (groups.length === 0) return `No TestFlight groups found for ${appLabel(app)}.`;
  const lines = groups.map((g) => {
    const a = g.attributes ?? {};
    const linkDetail = [a.publicLink, a.publicLinkLimitEnabled && a.publicLinkLimit !== undefined ? `limit ${a.publicLinkLimit}` : ""].filter(Boolean).join(", ");
    const link = a.publicLinkEnabled ? `public link on${linkDetail ? ` (${linkDetail})` : ""}` : "public link off";
    return `• ${[a.name ?? "(unnamed group)", a.isInternalGroup ? "internal" : "external", link, `feedback ${a.feedbackEnabled ? "on" : "off"}`].join(" · ")}`;
  });
  return render(`TestFlight groups for ${appLabel(app)} — ${groups.length} shown:`, lines, pagingFooter(groups.length, doc));
}

export type ListTestersInput = { app: string; group?: string; limit?: number; cursor?: string };

export async function listBetaTesters(deps: ToolDeps, input: ListTestersInput): Promise<string> {
  const app = await deps.apps.resolve(input.app);
  const query = { "fields[betaTesters]": TESTER_FIELDS, limit: input.limit ?? DEFAULT_LIMIT, cursor: input.cursor };

  let scope: string;
  let doc;
  if (input.group) {
    const group = await findGroup(deps, app.id, input.group);
    scope = `in "${group.attributes?.name ?? group.id}" `;
    doc = await deps.client.get<BetaTesterAttributes>(`/v1/betaGroups/${group.id}/betaTesters`, query);
  } else {
    scope = "";
    doc = await deps.client.get<BetaTesterAttributes>("/v1/betaTesters", { ...query, "filter[apps]": app.id });
  }

  const testers = asList(doc);
  if (testers.length === 0) return `No TestFlight testers ${scope}found for ${appLabel(app)}.`;
  const lines = testers.map((t) => {
    const a = t.attributes ?? {};
    const name = [a.firstName, a.lastName].filter(Boolean).join(" ") || "(no name)";
    const via = a.inviteType === "PUBLIC_LINK" ? "joined via public link" : a.inviteType === "EMAIL" ? "invited by email" : "—";
    return `• ${[name, a.email ?? "—", humanize(a.state), via].join(" · ")}`;
  });
  return render(`TestFlight testers ${scope}for ${appLabel(app)} — ${testers.length} shown:`, lines, pagingFooter(testers.length, doc));
}

/** Finds a beta group by ID or name (exact, then partial); never guesses between several. */
async function findGroup(deps: ToolDeps, appId: string, query: string): Promise<Resource<BetaGroupAttributes>> {
  const doc = await deps.client.get<BetaGroupAttributes>(`/v1/apps/${appId}/betaGroups`, { "fields[betaGroups]": GROUP_FIELDS, limit: 200 });
  const groups = asList(doc);
  const q = query.trim().toLowerCase();
  const nameOf = (g: Resource<BetaGroupAttributes>) => (g.attributes?.name ?? "").toLowerCase();
  for (const match of [(g: Resource<BetaGroupAttributes>) => g.id === query.trim() || nameOf(g) === q, (g: Resource<BetaGroupAttributes>) => nameOf(g).includes(q)]) {
    const hits = groups.filter(match);
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) throw new Error(`"${query}" matches ${hits.length} groups: ${hits.map((g) => g.attributes?.name).join(", ")}. Which one?`);
  }
  const names = groups.map((g) => g.attributes?.name ?? g.id).join(", ");
  throw new Error(groups.length ? `No TestFlight group named "${query}". Groups for this app: ${names}.` : `This app has no TestFlight groups.`);
}

export async function listGroupBuilds(deps: ToolDeps, input: { app: string; group: string; limit?: number; cursor?: string }): Promise<string> {
  const app = await deps.apps.resolve(input.app);
  const group = await findGroup(deps, app.id, input.group);
  return listBuilds(deps, { app: input.app, group: { id: group.id, name: group.attributes?.name ?? group.id }, limit: input.limit, cursor: input.cursor });
}

type FeedbackKind = { path: string; title: string; screenshots: boolean };
const SCREENSHOT_FEEDBACK: FeedbackKind = { path: "betaFeedbackScreenshotSubmissions", title: "feedback", screenshots: true };
const CRASH_FEEDBACK: FeedbackKind = { path: "betaFeedbackCrashSubmissions", title: "crash reports", screenshots: false };

async function listSubmissions(deps: ToolDeps, kind: FeedbackKind, input: { app: string; limit?: number; cursor?: string }): Promise<string> {
  const app = await deps.apps.resolve(input.app);
  const doc = await deps.client.get<BetaFeedbackAttributes>(`/v1/apps/${app.id}/${kind.path}`, {
    sort: "-createdDate",
    include: "build,tester",
    "fields[builds]": "version",
    "fields[betaTesters]": "firstName,lastName,email",
    limit: input.limit ?? DEFAULT_LIMIT,
    cursor: input.cursor,
  });
  const items = asList(doc);
  if (items.length === 0) return `No TestFlight ${kind.title} found for ${appLabel(app)}.`;
  const lines = items.map((f) => {
    const a = f.attributes ?? {};
    const tester = related<BetaTesterAttributes>(doc, f, "tester")?.attributes;
    const who = [tester?.firstName, tester?.lastName].filter(Boolean).join(" ") || tester?.email || a.email || "unknown tester";
    const build = related<BuildAttributes>(doc, f, "build")?.attributes?.version;
    const parts = [fmtDate(a.createdDate), who, `build ${build ?? "—"}`, a.deviceModel ?? "—", a.osVersion ?? "—"];
    if (a.comment) parts.push(`“${truncate(a.comment.replace(/\s*\n\s*/g, " "), 400)}”`);
    if (kind.screenshots && Array.isArray(a.screenshots) && a.screenshots.length) parts.push(`${a.screenshots.length} screenshot${a.screenshots.length === 1 ? "" : "s"}`);
    return `• ${parts.join(" · ")}`;
  });
  const header = `TestFlight ${kind.title} for ${appLabel(app)} — ${items.length} shown, newest first:`;
  return capOutput(render(header, [UNTRUSTED_NOTE, ...lines], pagingFooter(items.length, doc)));
}

export function listFeedback(deps: ToolDeps, input: { app: string; limit?: number; cursor?: string }): Promise<string> {
  return listSubmissions(deps, SCREENSHOT_FEEDBACK, input);
}

export function listCrashes(deps: ToolDeps, input: { app: string; limit?: number; cursor?: string }): Promise<string> {
  return listSubmissions(deps, CRASH_FEEDBACK, input);
}
