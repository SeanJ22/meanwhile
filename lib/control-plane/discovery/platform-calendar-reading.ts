import type { MeetingsDiscoveryNeed } from "../../hunt/meetings-discovery.ts";
import type { MeetingsDiscoveryAttempt, DiscoveryStep } from "../../hunt/meetings-site-discovery.ts";
import { accessControlIn } from "../../hunt/access-control.ts";
import { recordAcquisition, deriveSanitized } from "../evidence/artifact.ts";
import { DEFAULT_USER_AGENT } from "../scheduler/route-executor.ts";
import type { DiscoveryRuntime } from "./meetings-discovery-executor.ts";
import { observePlatformCensus } from "./platform-census.ts";

export interface PlatformPublisher {
  url: string;
  page: Awaited<ReturnType<DiscoveryRuntime["open"]>>;
}

/** One government's native calendar responses retain their actual bytes, dates and authority chain. */
export async function platformCalendarReading(input: {
  need: MeetingsDiscoveryNeed; runtime: DiscoveryRuntime; publisher: PlatformPublisher; platform: string;
}) {
  const { need, runtime, publisher } = input;
  const startedAt = runtime.now(), attemptId = `platform-${input.platform}:${need.jurisdictionId}:${startedAt}`;
  const steps: DiscoveryStep[] = [], found: MeetingsDiscoveryAttempt["found"][number][] = [], leads: MeetingsDiscoveryAttempt["leads"][number][] = [];
  let requests = 0;
  const capture = async (url: string, purpose: DiscoveryStep["purpose"], served?: PlatformPublisher["page"], follow = false, hop = 0): Promise<(PlatformPublisher["page"] & { artifactId: string; url: string }) | null> => {
    if (runtime.budget.spent()) return null;
    if (!served) { await runtime.spaceOut(new URL(url).hostname); requests++; }
    const got = served ?? await runtime.open({ url, headers: { "user-agent": DEFAULT_USER_AGENT, accept: "application/json,text/calendar,text/html" }, timeoutMs: runtime.timeoutMs ?? 20_000 });
    const access = got.status === null ? null : accessControlIn({ status: got.status, text: got.body });
    const acquired = recordAcquisition({ canonicalUrl: url, retrievedAt: got.retrievedAt ?? runtime.now(), httpStatus: got.status ?? 0,
      contentType: got.contentType, sourceId: "platform-census", workItemId: need.jurisdictionId, attemptId,
      methodRouteId: `${input.platform}-public-calendar`, permission: "ALLOWED", transport: got.transportError ? "OTHER_NAMED_FAILURE" : "REACHABLE" }, got.body);
    const readable = acquired.artifact.tier === "RESTRICTED_RAW" ? deriveSanitized(acquired.artifact, got.body, runtime.now()) : { artifact: acquired.artifact, text: got.body };
    const saved = await runtime.vault(readable.artifact, readable.text);
    if (!saved.stored) throw new Error(saved.why);
    steps.push({ purpose, url, permission: "ALLOWED", status: got.status, transportError: got.transportError,
      bytes: got.bytes, artifactId: readable.artifact.id, rung: null, ...(access ? { accessControl: access.detail } : {}),
      note: access?.detail ?? "Public calendar for the directory's named publisher." });
    if (follow && hop < 6 && got.status && got.status >= 300 && got.status < 400 && got.location)
      return capture(new URL(got.location, url).href, purpose, undefined, true, hop + 1);
    return got.status === 200 && !access && !got.transportError ? { ...got, body: readable.text, artifactId: readable.artifact.id, url } : null;
  };
  const get = (url: string, purpose: DiscoveryStep["purpose"]) => capture(url, purpose, undefined, true);
  await capture(new URL("/robots.txt", publisher.url).href, "robots");
  const home = await capture(publisher.url, "homepage", publisher.page);
  if (!home) throw new Error("The platform publisher could not be read");
  const via = { page: publisher.url, artifactId: home.artifactId };
  const finish = (): MeetingsDiscoveryAttempt => {
    const finishedAt = runtime.now();
    return { formatVersion: 1, attemptId, jurisdictionId: need.jurisdictionId, stateCode: need.stateCode,
      ownWebAddress: publisher.url, startedAt, finishedAt, outcome: found.length ? "FOUND" : "LEAD", found, leads, steps,
      requestCount: requests, recheckAfter: runtime.budget.spent() ? finishedAt : new Date(Date.parse(finishedAt) + 12 * 3_600_000).toISOString(),
      recipes: { applied: [], skipped: [], learned: [] }, search: [], note: `${need.name}: public ${input.platform} calendar and native body inventory read.`,
      site: { address: { source: "WEBSITE_EVIDENCE", versionId: home.artifactId }, homepage: { url: publisher.url, artifactId: home.artifactId,
        basis: "RECORDED_ADDRESS", hintFingerprint: null, startedAt: publisher.url, redirects: [] } },
      platformCensus: observePlatformCensus(home.body, publisher.url, home.artifactId, finishedAt) };
  };
  return { startedAt, capture, get, home, via, found, leads, steps, finish };
}
