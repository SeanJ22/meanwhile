import type { MeetingsDiscoveryNeed } from "../../hunt/meetings-discovery.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { newFieldManualEntry, writeFieldManual } from "../field-manual.ts";
import { walkMeetingsDiscoveryNeed, discoveryFieldManualEntries, type DiscoveryRuntime } from "./meetings-discovery-executor.ts";
import { reviewDiscoveryWalk, textSha256, type HeldBytes, type RegisteredGovernment } from "./auto-crosswalk.ts";
import { openPlatformMeetingDoors, platformMeetingDoor } from "../../doors/platform-census.ts";
import { platformHostedUrl, samePlatformTenant, type PlatformTenant } from "./platform-enumeration.ts";
import { siteOrigins } from "../../hunt/site-origins.ts";
import { pageLinks } from "../../hunt/meetings-site-discovery.ts";
import { DEFAULT_USER_AGENT } from "../scheduler/route-executor.ts";
import { readLegistarGovernment } from "./platform-legistar.ts";
import { readCivicPlusGovernment } from "./platform-civicplus.ts";
import { observePlatformCensus } from "./platform-census.ts";
import { withPlatformPublisher } from "../../doors/platform-publisher.ts";
import { assertPublicUrl } from "../../hunt/egress.ts";
import { recordAcquisition, deriveSanitized } from "../evidence/artifact.ts";
import { meetingEndpointCandidates, type MeetingsDiscoveryAttempt } from "../../hunt/meetings-site-discovery.ts";

type Repos = Pick<ControlPlaneRepositories, "doors" | "fieldManual" | "discoveryAttempts">;

/** Re-review the source's original retained bytes; no retrieval or source timestamp is invented. */
export function reviewPlatformAttempt(input: {
  attempt: MeetingsDiscoveryAttempt; registered: RegisteredGovernment | { notRegistered: string };
  held: ReadonlyMap<string, HeldBytes>; reviewer: string; now: string;
}) {
  const { attempt, held } = input;
  const civicPlusHosts = new Set([
    ...[...attempt.found, ...attempt.leads].filter(find => find.vendor === "civicplus-agendacenter").map(find => new URL(find.url).hostname),
    ...attempt.platformCensus?.matches.filter(match => match.platform === "civicplus" && match.basis === "SERVED_BY").map(match => new URL(match.url).hostname) ?? [],
  ]);
  const platformFind = (find: { url: string; vendor: string }) => {
    const url = new URL(find.url);
    return !/\/AgendaCenter\/(?:ViewFile|PreviousVersions)(?:\/|$)/i.test(url.pathname)
      && (find.vendor === "platform-publisher" || platformHostedUrl(find.url) || find.vendor === "ical" && (civicPlusHosts.has(url.hostname)
        || /\/common\/modules\/iCalendar\/iCalendar\.aspx$/i.test(url.pathname)));
  };
  const platformAttempt = { ...attempt, found: attempt.found.filter(platformFind), leads: attempt.leads.filter(platformFind) };
  platformAttempt.outcome = platformAttempt.found.length ? "FOUND" : attempt.outcome === "FOUND" ? "NOTHING_DETECTED" : attempt.outcome;
  const review = reviewDiscoveryWalk({ walk: { attempt: platformAttempt, recordId: attempt.attemptId, recordedAt: attempt.finishedAt },
    registered: input.registered, held: id => held.get(id) ?? null, handWired: () => false, reviewer: input.reviewer, now: input.now });
  const doors = [...new Map(review.accepted.flatMap(accepted => platformMeetingDoor(accepted.row)).map(door => [door.doorId, door])).values()];
  return { attempt: platformAttempt, review, doors, held };
}

/** One worker owns one government, its source pages, and its exact registered body at a time. */
export async function readPlatformGovernment(input: {
  need: MeetingsDiscoveryNeed;
  registered: RegisteredGovernment | { notRegistered: string };
  runtime: DiscoveryRuntime;
  repos: Repos;
  reviewer: string;
  readonly?: boolean;
  tenant?: PlatformTenant;
  checkedCalendars?: Readonly<Record<string, string>>;
}) {
  const held = new Map<string, HeldBytes>();
  const checkedCalendars = Object.fromEntries(Object.entries(input.checkedCalendars ?? {}).filter(([, at]) => Date.parse(at) > Date.parse(input.runtime.now()) - 12 * 3_600_000));
  let need = input.tenant?.platform === "government-website" && input.tenant.sourceVersion
    ? { ...input.need, ownWebAddress: input.tenant.url, addressSource: { source: "WEBSITE_EVIDENCE" as const, versionId: input.tenant.sourceVersion } }
    : input.need;
  type Page = Awaited<ReturnType<DiscoveryRuntime["open"]>>;
  const pages = new Map<string, Page>();
  const primaryWebsite = need.ownWebAddress, primaryAddressSource = need.addressSource;
  let publisher: { url: string; page: Page } | null = null, civicPlusPublisher = false, tenantLinked = false;
  let authority: { url: string; page: Page; artifactId: string; startedAt: string; redirects: { from: string; to: string; status: number }[] } | null = null;
  const readPage = async (first: string) => {
    let url = first, page: Page | undefined;
    const redirects: { from: string; to: string; status: number }[] = [];
    for (let hops = 0; hops <= 6; hops++) {
      if (input.runtime.budget.spent()) return null;
      assertPublicUrl(url);
      await input.runtime.spaceOut(new URL(url).hostname);
      const got = pages.get(url) ?? await withPlatformPublisher(primaryWebsite, url, () => input.runtime.open({ url, headers: { "user-agent": DEFAULT_USER_AGENT }, timeoutMs: input.runtime.timeoutMs ?? 20_000 }));
      page = { ...got, retrievedAt: got.retrievedAt ?? input.runtime.now() }; pages.set(url, page);
      if (!page.status || page.status < 300 || page.status >= 400 || !page.location) break;
      const next = new URL(page.location, url).href;
      redirects.push({ from: url, to: next, status: page.status });
      url = next;
    }
    return page?.status === 200 ? { url, page, startedAt: first, redirects } : null;
  };
  const readablePublisher = async (source: { url: string; page: Page }) => {
    const { url, page } = source, at = page.retrievedAt!;
    const acquired = recordAcquisition({ canonicalUrl: url, retrievedAt: at, httpStatus: 200, contentType: page.contentType,
      sourceId: "platform-census", workItemId: need.jurisdictionId, attemptId: `platform-publisher:${need.jurisdictionId}:${at}`,
      methodRouteId: "public-customer-directory", permission: "ALLOWED", transport: "REACHABLE" }, page.body);
    const readable = acquired.artifact.tier === "RESTRICTED_RAW" ? deriveSanitized(acquired.artifact, page.body, at) : { artifact: acquired.artifact, text: page.body };
    const saved = await input.runtime.vault(readable.artifact, readable.text);
    if (!saved.stored) throw new Error(saved.why);
    if (readable.artifact.tier === "RAW" || readable.artifact.tier === "SANITIZED_DERIVED") held.set(readable.artifact.id, {
      text: readable.text, contentType: readable.artifact.contentType, sha256: textSha256(readable.text),
      evidence: { kind: "VAULTED_EVIDENCE", artifactId: readable.artifact.id, contentHash: readable.artifact.contentHash,
        tier: readable.artifact.tier, retrievedAt: readable.artifact.retrievedAt },
    });
    return readable;
  };
  const choosePublisher = (source: { url: string; page: Page }, readable: Awaited<ReturnType<typeof readablePublisher>>) => {
    publisher = source;
    civicPlusPublisher = observePlatformCensus(readable.text, source.url, readable.artifact.id, source.page.retrievedAt!).matches
      .some(match => match.platform === "civicplus" && new URL(match.url).origin === new URL(source.url).origin)
      && !meetingEndpointCandidates(readable.text, source.url, source.page.retrievedAt!, input.runtime.fingerprints)
        .some(candidate => !["ical", "civicplus-agendacenter"].includes(candidate.vendor) && platformHostedUrl(candidate.url));
    need = { ...need, ownWebAddress: source.url, addressSource: { source: "WEBSITE_EVIDENCE", versionId: readable.artifact.id } };
  };
  // A catalogue selects the government to check. Only its recorded site can establish the outbound portal connection.
  const origins = siteOrigins(primaryWebsite);
  if (primaryWebsite && origins.length) {
    const recorded = new URL(/^https?:\/\//i.test(primaryWebsite) ? primaryWebsite : `https://${primaryWebsite}`);
    recorded.protocol = "https:";
    for (const start of [...new Set([recorded.href, ...origins.map(origin => `${origin}/`)])]) {
      const source = await readPage(start); if (!source) continue;
      const readable = await readablePublisher(source);
      authority = { ...source, artifactId: readable.artifact.id };
      if (input.tenant && platformHostedUrl(input.tenant.url)) {
        const linked = pageLinks(readable.text, source.url).some(link => samePlatformTenant(link, input.tenant!.url));
        if (samePlatformTenant(source.url, input.tenant.url) || linked) {
          const portal = samePlatformTenant(source.url, input.tenant.url) ? source : await readPage(input.tenant.url);
          if (portal) { choosePublisher(portal, portal === source ? readable : await readablePublisher(portal)); tenantLinked = true; }
        }
      }
      if (!publisher) {
        const census = observePlatformCensus(readable.text, source.url, readable.artifact.id, source.page.retrievedAt!);
        if (census.matches.some(match => match.platform === "civicplus" && new URL(match.url).origin === new URL(source.url).origin)) choosePublisher(source, readable);
      }
      if (publisher) break;
    }
  }
  const runtime: DiscoveryRuntime = { ...input.runtime,
    open: request => request.method !== "POST" && pages.has(request.url) ? Promise.resolve(pages.get(request.url)!)
      : platformHostedUrl(request.url) || [...pages.keys()].some(url => new URL(url).origin === new URL(request.url).origin)
        ? withPlatformPublisher(primaryWebsite, request.url, () => input.runtime.open(request)) : input.runtime.open(request),
    // Platform census is a plain-code lane. Paid discovery stays with the owner's scoped work.
    search: undefined,
    vault: async (artifact, text) => {
      const stored = await input.runtime.vault(artifact, text);
      if (stored.stored && (artifact.tier === "RAW" || artifact.tier === "SANITIZED_DERIVED")) held.set(artifact.id, { text, contentType: artifact.contentType, sha256: textSha256(text),
        evidence: { kind: "VAULTED_EVIDENCE", artifactId: artifact.id, contentHash: artifact.contentHash,
          tier: artifact.tier, retrievedAt: artifact.retrievedAt } });
      return stored;
    },
  };
  const client = tenantLinked && input.tenant?.platform === "legistar" ? /^([a-z0-9_-]+)\.legistar\.com$/i.exec(new URL(input.tenant.url).hostname)?.[1] : null;
  let attempt = publisher && client
    ? await readLegistarGovernment({ need, runtime, client, publisher })
    : publisher && civicPlusPublisher
      ? await readCivicPlusGovernment({ need, runtime, publisher, checkedCalendars })
    : await walkMeetingsDiscoveryNeed(need, runtime);
  if (publisher && authority && attempt.site?.homepage) {
    const portal = attempt.site.homepage;
    const separatePage = authority.url !== portal.url;
    attempt = { ...attempt, ownWebAddress: primaryWebsite, site: { address: primaryAddressSource ?? attempt.site.address,
      homepage: { url: authority.url, artifactId: authority.artifactId, basis: "RECORDED_ADDRESS", hintFingerprint: null,
        startedAt: authority.startedAt, redirects: authority.redirects } },
      steps: [...(separatePage ? [{ purpose: "homepage" as const, url: authority.url, permission: "ALLOWED" as const, status: authority.page.status,
        transportError: authority.page.transportError, bytes: authority.page.bytes, artifactId: authority.artifactId,
        rung: null, note: "The government's recorded site links this platform tenant." }] : []), ...attempt.steps],
      found: attempt.found.map(find => separatePage && find.via?.page === portal.url
        ? { ...find, via: { page: authority!.url, artifactId: authority!.artifactId } } : find),
      leads: [...(separatePage ? [{ vendor: "platform-publisher", url: portal.url, basis: "LINKED" as const, evidence: portal.url,
        detail: "Portal linked by the government's own saved page.",
        via: { page: authority.url, artifactId: authority.artifactId } }] : []), ...attempt.leads],
    };
  }
  const { attempt: platformAttempt, review, doors } = reviewPlatformAttempt({ attempt, registered: input.registered, held, reviewer: input.reviewer, now: runtime.now() });
  if (!input.readonly) {
    await input.repos.discoveryAttempts.append(input.need.jurisdictionId, attempt.attemptId, platformAttempt, attempt.finishedAt);
    // A deadline between writes must never mark the government checked before its verified doors exist.
    await openPlatformMeetingDoors(input.repos.doors, review.accepted.map(({ row }) => row), attempt.finishedAt);
    const entries = [...discoveryFieldManualEntries(platformAttempt), newFieldManualEntry("platform-government", input.need.jurisdictionId, {
      role: "SHARED", kind: "PLATFORM_CENSUS_CHECK", title: input.need.name, states: [input.need.stateCode.toLowerCase()],
      platforms: [...new Set(platformAttempt.platformCensus?.matches.map(match => match.platform) ?? [])], recordClasses: ["meetings"],
      summary: `${review.accepted.length} calendar connections verified; ${review.held.length} remain open.`,
      observedAt: attempt.finishedAt, outcome: review.accepted.length ? "YIELDED" : "ZERO",
      payload: { jurisdictionId: input.need.jurisdictionId, nextCheck: runtime.budget.spent() ? attempt.finishedAt
        : attempt.steps.some(step => step.purpose === "endpoint" && (step.transportError || step.status === 429 || (step.status ?? 0) >= 500))
          ? new Date(Date.parse(attempt.finishedAt) + 3_600_000).toISOString() : attempt.recheckAfter,
        reviewer: input.reviewer,
        registrationVersion: input.need.addressSource?.source === "REGISTRATION" ? input.need.addressSource.versionId : "input" in input.registered && input.registered.input.kind === "PROMOTED_VERSION" ? input.registered.input.versionId : null,
        requests: attempt.requestCount, checkedCalendars, accepted: review.accepted.map(({ row }) => ({ bodyId: row.bodyId, route: row.route })), held: review.held },
    })];
    const saved = await writeFieldManual(input.repos, entries, attempt.finishedAt);
    if (saved.error) throw new Error(saved.error);
  }
  return { attempt: platformAttempt, review, doors, held };
}
