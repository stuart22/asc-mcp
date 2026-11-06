// In-app events: state, badge, schedule and localized names.
import { APP_EVENT_STATES, type AppEventAttributes, type AppEventLocalizationAttributes, type Resource } from "../asc/types.ts";
import { appLabel, asList, DEFAULT_LIMIT, fmtDate, humanize, pagingFooter, render, truncate, type ToolDeps } from "../format/common.ts";
import { capOutput } from "../format/policy.ts";

export type AppEventState = (typeof APP_EVENT_STATES)[number];

export async function listInAppEvents(deps: ToolDeps, input: { app: string; state?: AppEventState; limit?: number; cursor?: string }): Promise<string> {
  const app = await deps.apps.resolve(input.app);
  const doc = await deps.client.get<AppEventAttributes>(`/v1/apps/${app.id}/appEvents`, {
    "filter[eventState]": input.state,
    include: "localizations",
    "fields[appEventLocalizations]": "locale,name,shortDescription",
    "limit[localizations]": 50,
    limit: input.limit ?? DEFAULT_LIMIT,
    cursor: input.cursor,
  });
  const events = asList(doc);
  if (events.length === 0) return `No ${input.state ? `${humanize(input.state)} ` : ""}in-app events found for ${appLabel(app)}.`;

  const lines: string[] = [];
  for (const e of events) {
    const a = e.attributes ?? {};
    const head = [
      a.referenceName ?? "(unnamed)",
      humanize(a.eventState),
      a.badge ? `badge ${humanize(a.badge)}` : "",
      a.priority ? `priority ${humanize(a.priority)}` : "",
      a.purpose ? `purpose ${humanize(a.purpose)}` : "",
    ];
    lines.push(`• ${head.filter(Boolean).join(" · ")}`);
    const [first, ...rest] = a.territorySchedules ?? [];
    if (first) {
      const more = rest.length ? ` (+${rest.length} more schedules)` : "";
      lines.push(`  publish ${fmtDate(first.publishStart)} · runs ${fmtDate(first.eventStart)}–${fmtDate(first.eventEnd)}${more}`);
    }
    const linked = e.relationships?.localizations?.data;
    const ids = new Set((Array.isArray(linked) ? linked : []).map((l) => l.id));
    const locs = (doc.included ?? []).filter((i) => i.type === "appEventLocalizations" && ids.has(i.id)) as Resource<AppEventLocalizationAttributes>[];
    for (const l of locs) {
      const la = l.attributes ?? {};
      lines.push(`  ${la.locale ?? "—"}: ${la.name ?? "—"}${la.shortDescription ? ` — ${truncate(la.shortDescription, 200)}` : ""}`);
    }
  }
  return capOutput(render(`In-app events for ${appLabel(app)} — ${events.length} shown:`, lines), undefined, pagingFooter(events.length, doc));
}
