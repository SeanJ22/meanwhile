import { DEFAULT_USER_AGENT } from "../scheduler/route-executor.ts";
import { accessControlIn } from "../../hunt/access-control.ts";
import { assertPublicUrl } from "../../hunt/egress.ts";
import { recordAcquisition } from "../evidence/artifact.ts";
import type { DiscoveryOpen, DiscoveryRuntime } from "./meetings-discovery-executor.ts";

export const CENSUS_LANE_INTERVAL_MS = 5 * 60_000;
export const CENSUS_LANE_BUDGET_MS = 10 * 60_000;
type CensusPage = Awaited<ReturnType<DiscoveryOpen>> & { url: string; artifactId: string };

export function censusReader(runtime: DiscoveryRuntime, subjectId: string) {
  const pages = new Map<string, Promise<CensusPage>>();
  const read = (url: string): Promise<CensusPage> => {
    if (pages.has(url)) return pages.get(url)!;
    const pending = (async () => {
      assertPublicUrl(url);
      await runtime.spaceOut(new URL(url).hostname);
      const got = await runtime.open({ url, headers: { "user-agent": DEFAULT_USER_AGENT, accept: "*/*" }, timeoutMs: runtime.timeoutMs ?? 20_000 });
      const at = runtime.now();
      const acquired = recordAcquisition({ canonicalUrl: url, retrievedAt: at, httpStatus: got.status ?? 0,
        contentType: got.contentType, sourceId: "platform-census", workItemId: `census:${subjectId}`,
        attemptId: `census:${subjectId}:${at}`, methodRouteId: "platform-census", permission: "ALLOWED",
        transport: got.transportError ? "OTHER_NAMED_FAILURE" : "REACHABLE" }, got.body);
      const stored = await runtime.vault(acquired.artifact, got.body);
      if (!stored.stored) throw new Error(`Census evidence not saved: ${stored.why}`);
      return { ...got, url, retrievedAt: at, artifactId: acquired.artifact.id };
    })();
    pages.set(url, pending);
    return pending;
  };
  const get = async (url: string): Promise<CensusPage | null> => {
    const seen = new Set<string>();
    for (let hops = 0; hops < 6; hops++) {
      if (seen.has(url)) return null;
      seen.add(url);
      await read(`${new URL(url).origin}/robots.txt`);
      const page = await read(url);
      if (page.status !== null && page.status >= 300 && page.status < 400 && page.location) {
        url = new URL(page.location, url).href;
        continue;
      }
      if (page.transportError || page.status === null || page.status < 200 || page.status >= 300 || accessControlIn({ status: page.status, text: page.body })) return null;
      return page;
    }
    return null;
  };
  const inventory = (url: string) => /\/bodies(?:[?]|$)|\/v1\/Categories(?:[?]|$)|\/Board\.nsf\/Public(?:[?]|$)|\/iCalendar\.aspx$|\/AgendaCenter(?:[/?]|$)|\/Public\/Organization\/\d+$|\/Citizens\/Calendar\.aspx$/i.test(url);
  const open: DiscoveryOpen = input => input.method === "POST" || (!pages.has(input.url) && !inventory(input.url))
    ? runtime.open(input) : read(input.url);
  return { get, open, pages };
}
