// The App Store Connect areas, one MCP tool each. Order is the order tools are listed in.

export type AreaName =
  | "apps"
  | "product_page"
  | "custom_product_pages"
  | "in_app_events"
  | "testflight"
  | "builds"
  | "in_app_purchases"
  | "subscriptions"
  | "pricing"
  | "reviews"
  | "xcode_cloud"
  | "reports"
  | "users"
  | "game_center"
  | "app_clips"
  | "certificates_and_distribution";

export const AREAS: readonly { name: AreaName; title: string; covers: string }[] = [
  { name: "apps", title: "Apps", covers: "Apps, app info, categories, age rating, EULA, encryption & accessibility declarations, tags" },
  { name: "product_page", title: "Product page", covers: "App Store versions, localizations (description, keywords, what's new, promo text), screenshots, previews, review details, review submissions, phased release" },
  { name: "custom_product_pages", title: "Custom product pages", covers: "Custom product pages and product page optimization experiments" },
  { name: "in_app_events", title: "In-app events", covers: "Events, localizations, screenshots, video clips" },
  { name: "testflight", title: "TestFlight", covers: "Beta groups, testers, group builds, public links, beta review, beta localizations, feedback & crash submissions, crash logs" },
  { name: "builds", title: "Builds", covers: "Builds, pre-release versions, bundles, uploads, performance metrics, diagnostics, background assets" },
  { name: "in_app_purchases", title: "In-app purchases", covers: "Products, versions, localizations, prices, availability, offer codes (not code values), promoted purchases" },
  { name: "subscriptions", title: "Subscriptions", covers: "Groups, subscriptions, offers, win-back offers, offer codes, prices, grace periods, retention messages" },
  { name: "pricing", title: "Pricing and availability", covers: "App price schedules, price points, availability, territories" },
  { name: "reviews", title: "Customer reviews", covers: "Customer reviews and responses" },
  { name: "xcode_cloud", title: "Xcode Cloud", covers: "Products, workflows, build runs, actions, artifacts, issues, test results, repositories" },
  { name: "reports", title: "Reports", covers: "Analytics report requests/reports/instances/segments (listing only) and sales & finance reports" },
  { name: "users", title: "Users and access", covers: "Users, invitations" },
  { name: "game_center", title: "Game Center", covers: "Everything Game Center" },
  { name: "app_clips", title: "App Clips", covers: "App Clips and experiences" },
  { name: "certificates_and_distribution", title: "Certificates and distribution", covers: "Certificates, bundle IDs, devices, profiles, merchant/pass IDs, EU alternative distribution, webhooks" },
];

export const AREA_NAMES: readonly AreaName[] = AREAS.map((a) => a.name);

/** Parses ASC_HIDE_AREAS: comma-separated, trimmed, case-insensitive. */
export function parseHiddenAreas(raw: string | undefined): { hidden: AreaName[]; unknown: string[] } {
  const hidden: AreaName[] = [];
  const unknown: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const name = part.trim().toLowerCase();
    if (!name) continue;
    if ((AREA_NAMES as readonly string[]).includes(name)) {
      if (!hidden.includes(name as AreaName)) hidden.push(name as AreaName);
    } else unknown.push(part.trim());
  }
  return { hidden, unknown };
}
