import type { MeetingsDiscoveryNeed } from "../../hunt/meetings-discovery.ts";
import type { MeetingsDiscoveryAttempt } from "../../hunt/meetings-site-discovery.ts";
import { parseCalendarRows } from "../../sources/legistar-insite/calendar.ts";
import type { DiscoveryRuntime } from "./meetings-discovery-executor.ts";
import { platformCalendarReading } from "./platform-calendar-reading.ts";

/** The published native client inventory and rolling event pages cover all this government's bodies together. */
export async function readLegistarGovernment(input: {
  need: MeetingsDiscoveryNeed; runtime: DiscoveryRuntime; client: string;
  publisher: { url: string; page: Awaited<ReturnType<DiscoveryRuntime["open"]>> };
}): Promise<MeetingsDiscoveryAttempt> {
  const { need, runtime, publisher } = input;
  if (!/^[a-z0-9_-]+$/i.test(input.client)) throw new Error("Invalid published Legistar client identifier");
  const reading = await platformCalendarReading({ need, runtime, publisher, platform: "legistar" });
  const { startedAt, capture, home, via, found, leads, steps } = reading;
  const grid = parseCalendarRows(home.body);
  if (grid.length) {
    steps.push({ ...steps.at(-1)!, purpose: "endpoint" });
    found.push({ vendor: "legistar-insite", url: publisher.url, basis: "SERVED_BY", evidence: publisher.url,
      detail: "The native calendar grid names its bodies and dated sittings.", count: grid.length, artifactId: home.artifactId, via });
  }
  await capture("https://webapi.legistar.com/robots.txt", "robots");
  const base = `https://webapi.legistar.com/v1/${input.client}`, bodiesUrl = `${base}/bodies`;
  const bodies = await capture(bodiesUrl, "endpoint");
  if (bodies) {
    leads.push({ vendor: "legistar-api", url: bodiesUrl, basis: "SERVED_BY", evidence: publisher.url,
      detail: "The platform's published native body inventory.", via });
    const day = (delta: number) => new Date(Date.parse(startedAt) + delta * 86_400_000).toISOString().slice(0, 10);
    for (let offset = 0; !runtime.budget.spent(); offset += 1000) {
      const url = new URL(`${base}/events`);
      url.searchParams.set("$filter", `EventDate ge datetime'${day(-120)}' and EventDate le datetime'${day(120)}'`);
      url.searchParams.set("$orderby", "EventId"); url.searchParams.set("$top", "1000"); url.searchParams.set("$skip", String(offset));
      const page = await capture(url.href, "endpoint");
      if (!page) break;
      let events: unknown;
      try { events = JSON.parse(page.body); } catch { break; }
      if (!Array.isArray(events)) break;
      if (events.length) found.push({ vendor: "legistar-api", url: url.href, basis: "SERVED_BY", evidence: bodiesUrl,
        detail: "The publisher's dated native events; each body retains its own numeric selector.", count: events.length,
        artifactId: page.artifactId, via: { page: bodiesUrl, artifactId: bodies.artifactId } });
      if (events.length < 1000) break;
    }
  }
  return reading.finish();
}
