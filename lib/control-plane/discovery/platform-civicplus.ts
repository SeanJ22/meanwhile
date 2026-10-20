import type { MeetingsDiscoveryNeed } from "../../hunt/meetings-discovery.ts";
import { CIVICPLUS_CALENDAR_INDEX_PATH, civicPlusCategoryFeeds, meetingEndpointCandidates, verifyEndpointBody } from "../../hunt/meetings-site-discovery.ts";
import type { DiscoveryRuntime } from "./meetings-discovery-executor.ts";
import { platformCalendarReading, type PlatformPublisher } from "./platform-calendar-reading.ts";
import { categoryBodyOf } from "./auto-crosswalk.ts";

/** Enumerate the native categories once. Calendar doors own the linked agendas and version histories. */
export async function readCivicPlusGovernment(input: {
  need: MeetingsDiscoveryNeed; runtime: DiscoveryRuntime; publisher: PlatformPublisher;
  checkedCalendars?: Record<string, string>;
}) {
  const reading = await platformCalendarReading({ ...input, platform: "civicplus" });
  const { home, via, get, found, leads, steps } = reading;
  const routes = meetingEndpointCandidates(home.body, home.url, input.runtime.now(), input.runtime.fingerprints)
    .filter(candidate => candidate.vendor === "civicplus-agendacenter" && !/\/AgendaCenter\/(?:ViewFile|PreviousVersions)(?:\/|$)/i.test(new URL(candidate.url).pathname));
  if (/\/AgendaCenter(?:\/|$)/i.test(new URL(home.url).pathname)) routes.unshift({ vendor: "civicplus-agendacenter", url: home.url,
    basis: "SERVED_BY", evidence: home.url, verifiable: true });
  const seen = new Set<string>();
  for (const route of routes) {
    const key = route.url.replace(/\/$/, "").toLowerCase(); if (seen.has(key)) continue; seen.add(key);
    const page = route.url === home.url ? home : await get(route.url, "endpoint");
    if (!page) continue;
    if (page === home) steps.push({ ...steps.find(step => step.url === home.url && step.purpose === "homepage")!, purpose: "endpoint" });
    const verified = verifyEndpointBody(route, { ...page, finalUrl: page.url });
    const find = { ...route, url: page.url, artifactId: page.artifactId, count: verified.count, detail: verified.detail, via };
    if (verified.verdict === "YIELDED") found.push(find); else leads.push(find);
  }
  const index = await get(new URL(CIVICPLUS_CALENDAR_INDEX_PATH, home.url).href, "endpoint");
  if (index && new URL(index.url).origin === new URL(home.url).origin) {
    leads.push({ vendor: "civicplus-icalendar", url: index.url, basis: "SERVED_BY", evidence: home.url,
      detail: "The platform's native calendar category index.", via });
    const feeds = [...civicPlusCategoryFeeds(index.body, index.url)].sort((a, b) => Number("unmatched" in categoryBodyOf(a.name, input.need.jurisdictionId)) - Number("unmatched" in categoryBodyOf(b.name, input.need.jurisdictionId)));
    for (const feed of feeds) {
      if (input.runtime.budget.spent()) break;
      const key = `${feed.url}|${feed.name}`;
      if (Date.parse(input.checkedCalendars?.[key] ?? "") > Date.parse(input.runtime.now()) - 12 * 3_600_000) continue;
      const page = await get(feed.url, "endpoint");
      if (!page) { const last = steps.at(-1); if (last?.status === null || last?.status === 429 || (last?.status ?? 0) >= 500) break; continue; }
      const verified = verifyEndpointBody({ vendor: "ical", url: page.url }, { ...page, finalUrl: page.url });
      if (input.checkedCalendars && verified.verdict !== "NOT_CONFIRMED") input.checkedCalendars[key] = page.retrievedAt ?? input.runtime.now();
      const find = { vendor: "ical", url: page.url, basis: "LINKED" as const, evidence: `Published category "${feed.name}" (catID ${feed.catId}) on ${index.url}`,
        artifactId: page.artifactId, count: verified.count, detail: verified.detail, via: { page: index.url, artifactId: index.artifactId } };
      if (verified.verdict === "YIELDED") found.push(find); else leads.push(find);
    }
  }
  return reading.finish();
}
