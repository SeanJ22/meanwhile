import { escribeCalendarRequest } from "../../sources/escribe/index.ts";
import { readCivicClerkPages, type CivicClerkPage, type CivicClerkEvent } from "../../sources/civicclerk/index.ts";
import { officialLinkingPageFromAsync, type LazyOfficialPage } from "../../sources/official-page-events/index.ts";
import { observePlatformCensus, platformCensusEntry, type PlatformCensusObservation } from "./platform-census.ts";
import { createHash } from "node:crypto";
import { websiteRequestLimit, type WebsiteSizeForUrl } from "../scheduler/host-supervision.ts";

import { accessControlIn } from "../../hunt/access-control.ts";
import { assertPublicUrl } from "../../hunt/egress.ts";
import type { MeetingsDiscoveryNeed } from "../../hunt/meetings-discovery.ts";
import {
  failureStands,
  identityFor,
  recipeCandidates,
  recipeFromSearchFind,
  recipesFor,
  type MeetingsRecipe,
  type RecipeCandidate,
} from "../../hunt/meetings-recipes.ts";
import { namesItself, routeHintsFingerprint, routeHintsFor, type JurisdictionRouteHints } from "../../hunt/meetings-route-hints.ts";
import { hitStanding, plannedQueries, requestPrice, type SearchProvider } from "../../hunt/discovery-search.ts";
import { DISCOVERY_SEARCH_ROLE, type CostEntry } from "../cost.ts";
import { fingerprint } from "../ids.ts";
import type { SearchHit } from "../../hunt/search.ts";
import {
  CIVICPLUS_CALENDAR_INDEX_PATH,
  civicPlusCategoryFeeds,
  decideOutcome,
  meetingEndpointCandidates,
  recheckAfter,
  siteOrigins,
  verifyEndpointBody,
  type DiscoveryFind,
  type DiscoveryOutcome,
  type DiscoveryStep,
  type EndpointCandidate,
  type MeetingsDiscoveryAttempt,
  type OfficialPageIdentity,
  type StepPermission,
  type VerifiableVendor,
} from "../../hunt/meetings-site-discovery.ts";
import type { PermissionState, TransportState } from "../../workstate/types.ts";
import { FRESHNESS_PROJECT } from "../scheduler/durable.ts";
import { deriveSanitized, recordAcquisition, type Artifact } from "../evidence/artifact.ts";
import { fieldManualEntryId, type FieldManualEntry } from "../field-manual.ts";
import { DEFAULT_ROBOTS_TOKEN, evaluatePermission } from "../scheduler/robots.ts";
import { DEFAULT_USER_AGENT, type VaultPut } from "../scheduler/route-executor.ts";
import { boardDocsListUrl, parseBoardDocsCommittees } from "../../sources/boarddocs/index.ts";
import { parsePrimeGovCommittees, primeGovBase } from "../../sources/primegov/index.ts";
import { categoryBodyOf } from "./auto-crosswalk.ts";
import type { OfficialLinkingPage } from "../../civic-data/source-authority.ts";

/** One HTTP hop. It never follows a redirect: the executor asks permission of every new host first. */
export type DiscoveryOpen = (input: {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly method?: "GET" | "POST";
  readonly body?: string;
}) => Promise<{
  readonly status: number | null;
  readonly body: string;
  readonly bytes: number;
  readonly contentType: string;
  /** The redirect target of a 3xx; null otherwise. */
  readonly location: string | null;
  readonly transportError: string | null;
  readonly retrievedAt?: string;
}>;

export interface DiscoveryRuntime {
  /** Previously saved, readable publisher pages; never inferred from a hostname. */
  readonly readOfficialPages?: () => Promise<readonly (LazyOfficialPage | { canonicalUrl: string; text: string })[]>;
  /** Reload a fresh walk capture's original bytes instead of retaining its HTML. */
  readonly readOfficialPageTextFor?: (artifact: Artifact) => Promise<string>;
  /** Saved official-page links establish authority for government and vendor hosts. */
  readonly officialLinkingPageFor?: (url: string) => OfficialLinkingPage | null | Promise<OfficialLinkingPage | null>;
  readonly open: DiscoveryOpen;
  /** The runner's shared per-host spacing. */
  readonly spaceOut: (host: string) => Promise<void>;
  readonly websiteSize?: WebsiteSizeForUrl;
  readonly vault: VaultPut;
  readonly now: () => string;

  readonly budget: { readonly spent: () => boolean; readonly remainingMs?: () => number };
  readonly maxRequestsPerWalk?: number;
  /** Actual prior source reads; unvisited routes precede previously read ones. */
  readonly priorAttempts?: readonly MeetingsDiscoveryAttempt[];
  readonly timeoutMs?: number;

  readonly recipes?: readonly MeetingsRecipe[];
  readonly fingerprints?: readonly FieldManualEntry[];

  readonly routeHints?: readonly JurisdictionRouteHints[];

  readonly search?: DiscoverySearch;
  /** Exact scope membership from the runner; no dollar admission or token reservation. */
  readonly searchScopeFor?: (jurisdictionId: string) => { readonly assignmentKeys: readonly string[]; readonly assignmentRefs?: readonly { readonly key: string; readonly ref: string }[]; readonly hold: string | null };
  /** Writes one CostEntry per provider request actually sent (role DISCOVERY_SEARCH). */
  readonly recordCost?: (entry: CostEntry) => Promise<void>;
  readonly maxQueriesPerWalk?: number;
}

/** One provider request the search seam made, refused, or lost in transport. */
export interface SearchRequestRecord {
  readonly provider: SearchProvider;
  readonly status: "DELIVERED" | "BUDGET_REFUSED" | "FAILED";
  readonly error: string | null;
  readonly bytes: number;
  readonly hitCount: number;
}

/** Search for pointers. Restricting to the government's own domain is the seam's to express per provider. */
export type DiscoverySearch = ((input: {
  readonly query: string;
  readonly ownSiteDomain: string | null;
}) => Promise<{ readonly hits: readonly SearchHit[]; readonly requests: readonly SearchRequestRecord[] }>) & {
  /** The longest one query can take, every provider at its timeout. The walk starts a query only with this much time left. */
  readonly worstCaseMs?: number;
};

const MAX_HITS_FOLLOWED_PER_QUERY = 2;
const DEFAULT_MAX_QUERIES_PER_WALK = 2;
/** A seam that does not state its worst case is given this much: two providers at eight seconds each, and the budget ledger's calls. */
const DEFAULT_SEARCH_WORST_CASE_MS = 20_000;

/** The cost-ledger row for one search request: role DISCOVERY_SEARCH, never mixed with model spend. */
export function searchCostEntry(input: {
  readonly attemptId: string;
  readonly jurisdictionId: string;
  readonly routeId: string;
  readonly host: string;
  readonly usd: number | null;
  readonly bytes: number;
  readonly recordedAt: string;
  readonly assignmentKeys?: readonly string[];
  readonly assignmentRefs?: readonly { readonly key: string; readonly ref: string }[];
}): CostEntry {
  return {
    attemptId: input.attemptId,
    workItemId: discoveryWorkId(input.jurisdictionId),
    routeTaskId: null,
    routeId: input.routeId,
    source: input.host,
    jurisdiction: input.jurisdictionId,
    project: FRESHNESS_PROJECT,
    role: DISCOVERY_SEARCH_ROLE,
    ...(input.assignmentKeys?.length ? { assignmentKeys: [...input.assignmentKeys] } : {}),
    ...(input.assignmentRefs?.length ? { assignmentRefs: [...input.assignmentRefs] } : {}),
    cost: {
      inputTokens: null,
      outputTokens: null,
      usd: input.usd,
      durationMs: null,
      bytesFetched: input.bytes,
      requestCount: 1,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      cacheCreation5mInputTokens: null,
      cacheCreation1hInputTokens: null,
      uncachedInputTokens: null,
      batch: false,
    },
    recordedAt: input.recordedAt,
  };
}

export { RECORDED_WALLS } from "../../hunt/recorded-walls.ts";
import { RECORDED_WALLS } from "../../hunt/recorded-walls.ts";

// A busy source cannot consume the whole pass; unfinished routes remain due.
export const DEFAULT_MAX_REQUESTS_PER_WALK = 24;
const DEFAULT_TIMEOUT_MS = 20_000;
/** Less time than this left, and a request is not sent: it could not come back inside the budget. */
const MIN_REQUEST_MS = 2_000;
const MAX_REDIRECT_HOPS = 4;
/** RFC 9309 §2.3.1.2: at least five consecutive redirects are followed for robots.txt. */
const MAX_ROBOTS_REDIRECTS = 5;
const ACCEPT_PAGE = "text/html,application/xhtml+xml,application/json,text/calendar,*/*;q=0.8";
const ACCEPT_ROBOTS = "text/plain,*/*;q=0.5";
const SOURCE_ID = "meetings-discovery";

export function discoveryWorkId(jurisdictionId: string): string {
  return `discovery-meetings-${jurisdictionId.replace(/[^A-Za-z0-9._-]/g, "_")}-${fingerprint([jurisdictionId]).slice(0, 8)}`;
}

export function discoveryAttemptId(jurisdictionId: string, startedAt: string): string {
  return `da-${createHash("sha256").update(`${jurisdictionId}|${startedAt}`).digest("hex").slice(0, 24)}`;
}

/** Raised by a request the caller's time no longer covers. It never leaves the walk. */
class OutOfTime extends Error {}

export class DiscoveryTimeSpent extends Error {
  /* Explicit field declarations: a parameter property does not parse under --experimental-strip-types. */
  readonly jurisdictionId: string;
  readonly requestCount: number;
  /** The search queries the walk had sent. Their requests were charged, so they are reported with the cut walk. */
  readonly search: MeetingsDiscoveryAttempt["search"];

  constructor(jurisdictionId: string, requestCount: number, search: MeetingsDiscoveryAttempt["search"] = []) {
    super(
      `${jurisdictionId}: the discovery time ran out after ${requestCount} request(s), before the walk confirmed ` +
        "anything; nothing is recorded as a reading and the need stays due",
    );
    this.name = "DiscoveryTimeSpent";
    this.jurisdictionId = jurisdictionId;
    this.requestCount = requestCount;
    this.search = search;
  }
}

function transportOf(status: number | null, transportError: string | null): TransportState {
  if (transportError !== null) return /abort|timeout|timed out/i.test(transportError) ? "TIMEOUT" : "OTHER_NAMED_FAILURE";
  if (status === null) return "OTHER_NAMED_FAILURE";
  if (status >= 200 && status < 400) return "REACHABLE";
  return [401, 403, 429].includes(status) ? "CHALLENGED" : "FAILED_AT_RUNG";
}

/** A content type whose body is text. An unnamed type is taken as text: the walk cannot tell, and HTML servers often omit it. */
function textualType(contentType: string): boolean {
  const type = contentType.split(";")[0].trim().toLowerCase();
  return type === "" || type.startsWith("text/") || /^application\/([a-z0-9.+-]+\+)?(json|xml|javascript|ecmascript)$/.test(type) || type.endsWith("+xml") || type.endsWith("+json");
}

function permissionState(p: StepPermission): PermissionState {
  return p === "ALLOWED" ? "ALLOWED" : p === "NO_ROBOTS" ? "NOT_APPLICABLE" : p === "DISALLOWED" ? "DISALLOWED" : "CANNOT_TELL";
}

const officialPageSets = new WeakMap<NonNullable<DiscoveryRuntime["readOfficialPages"]>, Promise<LazyOfficialPage[]>>();

function officialPagesFor(runtime: DiscoveryRuntime): Promise<LazyOfficialPage[]> {
  const read = runtime.readOfficialPages;
  if (!read) return Promise.resolve([]);
  let pages = officialPageSets.get(read);
  if (!pages) {
    pages = read().then(rows => rows.map(row => "readText" in row ? row : {
      canonicalUrl: row.canonicalUrl, readText: async () => row.text,
    }));
    officialPageSets.set(read, pages);
  }
  return pages;
}

function lazyWalkCapture(artifact: Artifact, readText: NonNullable<DiscoveryRuntime["readOfficialPageTextFor"]>): LazyOfficialPage {
  return { canonicalUrl: artifact.canonicalUrl, readText: () => readText(artifact) };
}

/** Walk one need; expired work uses DiscoveryTimeSpent and stays owed. */
export async function walkMeetingsDiscoveryNeed(
  need: MeetingsDiscoveryNeed,
  runtime: DiscoveryRuntime,
): Promise<MeetingsDiscoveryAttempt> {
  const startedAt = runtime.now();
  let officialPages: LazyOfficialPage[];
  try { officialPages = await officialPagesFor(runtime); }
  catch (error) {
    if (runtime.budget.spent() || (runtime.budget.remainingMs?.() ?? Infinity) <= 0) {
      throw new DiscoveryTimeSpent(need.jurisdictionId, 0, []);
    }
    throw error;
  }
  const attemptId = discoveryAttemptId(need.jurisdictionId, startedAt);
  const workId = discoveryWorkId(need.jurisdictionId);
  const maxRequests = runtime.maxRequestsPerWalk ?? DEFAULT_MAX_REQUESTS_PER_WALK;
  const timeoutMs = runtime.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const steps: DiscoveryStep[] = [];
  const searchScope = runtime.search === undefined ? null : runtime.searchScopeFor?.(need.jurisdictionId) ?? null;
  const robotsByHost = new Map<string, { readonly verdict: StepPermission; readonly detail: string; readonly rateLimited?: true }>();
  let requests = 0;
  const requestsByHost = new Map<string, number>();
  const hostKey = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, "");
  const hostLimit = (url: URL) => websiteRequestLimit(runtime.websiteSize?.(url.toString()));
  const hostSpent = (url: URL) => {
    const limit = hostLimit(url);
    return limit !== null && (requestsByHost.get(hostKey(url)) ?? 0) >= limit;
  };

  const skipped = (purpose: DiscoveryStep["purpose"], url: string, permission: StepPermission, note: string): void => {
    steps.push({ purpose, url, permission, status: null, transportError: null, bytes: 0, artifactId: null, rung: null, note });
  };

  async function vaultBody(
    url: string,
    status: number,
    contentType: string,
    body: string,
    permission: StepPermission,
    retrievedAt?: string,
  ): Promise<{ readonly artifactId: string | null; readonly readable: string; readonly note: string | null }> {
    if (body.length === 0) return { artifactId: null, readable: body, note: null };
    const put = async (artifact: Artifact, bytes: string): Promise<{ readonly id: string | null; readonly why: string | null }> => {
      try {
        const stored = await runtime.vault(artifact, bytes);
        if (stored.stored && artifact.tier !== "RESTRICTED_RAW" && status >= 200 && status < 300) {
          officialPages.push(runtime.readOfficialPageTextFor
            ? lazyWalkCapture(artifact, runtime.readOfficialPageTextFor)
            : { canonicalUrl: artifact.canonicalUrl, readText: async () => bytes });
        }
        return stored.stored ? { id: artifact.id, why: null } : { id: null, why: stored.why };
      } catch (error) {
        return { id: null, why: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
      }
    };
    const { artifact } = recordAcquisition(
      {
        canonicalUrl: url,
        retrievedAt: retrievedAt ?? runtime.now(),
        httpStatus: status,
        contentType,
        sourceId: SOURCE_ID,
        methodRouteId: `discovery:meetings`,
        workItemId: workId,
        attemptId,
        permission: permissionState(permission),
        transport: transportOf(status, null),
      },
      body,
    );
    const exact = await put(artifact, body);
    if (artifact.tier !== "RESTRICTED_RAW") {
      return { artifactId: exact.id, readable: body, note: exact.why === null ? null : `not vaulted: ${exact.why}` };
    }
    const unkept = exact.id === null ? `; its exact bytes were not kept (${exact.why})` : "";
    let derived: ReturnType<typeof deriveSanitized>;
    try {
      derived = deriveSanitized(artifact, body, runtime.now());
    } catch (error) {
      /* A body the sanitizer cannot make safe is not read at all. */
      return {
        artifactId: exact.id,
        readable: "",
        note: `the body carries a confirmed credential and could not be sanitized, so the walk read none of it${unkept} (${error instanceof Error ? error.message.slice(0, 200) : String(error)})`,
      };
    }
    const kept = await put(derived.artifact, derived.text);
    return {
      artifactId: exact.id ?? kept.id,
      readable: derived.text,
      note: `the body carries a confirmed credential, so the walk read its sanitized derivative${unkept}` +
        (kept.id === null ? `; the derivative was not vaulted (${kept.why})` : ""),
    };
  }

  const timeLeftMs = (): number => runtime.budget.remainingMs?.() ?? Number.POSITIVE_INFINITY;

  /* The time is asked before the host's spacing and again after it, and the request's timeout never outlasts it. */
  async function hop(url: URL, accept: string, form?: Readonly<Record<string, string>>) {
    const json = url.pathname === "/MeetingsCalendarView.aspx/GetCalendarMeetings" && /^pub-[a-z0-9-]+\.escribemeetings\.com$/i.test(url.hostname) ? escribeCalendarRequest({}, new Date(runtime.now())) : null;
    if (timeLeftMs() < MIN_REQUEST_MS) throw new OutOfTime();
    if (hostLimit(url) !== null) await runtime.spaceOut(url.host.toLowerCase());
    const left = timeLeftMs();
    if (left < MIN_REQUEST_MS) throw new OutOfTime();
    if (hostSpent(url)) return { status: null, body: "", bytes: 0, contentType: "", location: null, transportError: "shared per-website request bound reached" };
    requestsByHost.set(hostKey(url), (requestsByHost.get(hostKey(url)) ?? 0) + 1);
    requests += 1;
    return runtime.open({
      url: url.toString(),
      headers: { "user-agent": DEFAULT_USER_AGENT, accept, ...(json ? { "content-type": "application/json; charset=utf-8" } : form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
      timeoutMs: Math.min(timeoutMs, Math.floor(left)),
      ...(json ? { method: "POST" as const, body: JSON.stringify(json) } : form ? { method: "POST" as const, body: new URLSearchParams(form).toString() } : {}),
    });
  }

  /** The robots verdict for a URL's host, read once per walk and recorded; `rateLimited` when the host answered 429. */
  async function permissionFor(url: URL): Promise<{ readonly verdict: StepPermission; readonly detail: string; readonly rateLimited?: true }> {
    const host = url.host.toLowerCase();
    const wall = RECORDED_WALLS.find((w) => w.host === url.hostname.toLowerCase());
    if (wall) return { verdict: "RECORDED_WALL", detail: wall.why };
    const known = robotsByHost.get(host);
    if (known) return known;
    const robotsUrl = new URL(`${url.protocol}//${url.host}/robots.txt`);
    if (requests >= maxRequests) {
      const capped = { verdict: "CANNOT_TELL" as const, detail: `the walk reached its ${maxRequests}-request bound before robots.txt could be read` };
      skipped("robots", robotsUrl.toString(), "CANNOT_TELL", capped.detail);
      return capped;
    }

    let got = await hop(robotsUrl, ACCEPT_ROBOTS);
    let at = robotsUrl;
    const via: string[] = [];
    while (got.status !== null && got.status >= 300 && got.status < 400 && got.location !== null && via.length < MAX_ROBOTS_REDIRECTS && requests < maxRequests) {
      let next: URL;
      try {
        next = assertPublicUrl(new URL(got.location, at).toString());
      } catch {
        break;
      }
      via.push(next.toString());
      at = next;
      got = await hop(next, ACCEPT_ROBOTS);
    }
    const reading = evaluatePermission(
      { robotsText: got.transportError === null ? got.body : null, status: got.status, transportError: got.transportError, contentType: got.contentType },
      url.toString(),
      DEFAULT_ROBOTS_TOKEN,
    );
    const verdict: StepPermission = reading.verdict;
    const kept = got.status !== null && got.transportError === null
      ? await vaultBody(at.toString(), got.status, got.contentType, got.body, "ALLOWED", got.retrievedAt)
      : null;
    steps.push({
      purpose: "robots", url: robotsUrl.toString(), permission: verdict, status: got.status, transportError: got.transportError,
      bytes: got.bytes, artifactId: kept?.artifactId ?? null, rung: 2,
      note: (via.length === 0 ? reading.detail : `${reading.detail} (followed ${via.length} redirect(s): ${via.join(" → ")})`) +
        (kept?.note ? `; ${kept.note}` : ""),
    });
    /* A 429 is a rate limit, an access control: honoured for the rest of the walk, never pushed through. */
    const entry = got.status === 429 ? { verdict, detail: reading.detail, rateLimited: true as const } : { verdict, detail: reading.detail };
    robotsByHost.set(host, entry);
    return entry;
  }

  /** GET one URL, one hop at a time, reading and recording every host's robots.txt first. Null when nothing usable came back. */
  async function get(start: string, purpose: DiscoveryStep["purpose"], accept: string, form?: Readonly<Record<string, string>>) {
    let current = start;
    /* Each redirect this request followed: the chain a derived wiring row's attestation cites. */
    const redirects: { from: string; to: string; status: number }[] = [];
    for (let hops = 0; hops <= MAX_REDIRECT_HOPS; hops += 1) {
      let url: URL;
      try {
        url = assertPublicUrl(current);
      } catch (error) {
        skipped(purpose, current, "CANNOT_TELL", `not a public http(s) URL: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
      const permission = await permissionFor(url);
      /* Only a recorded access-control wall stops the request; a robots.txt verdict is recorded and never refuses a public page. */
      if (permission.verdict === "RECORDED_WALL") {
        skipped(purpose, url.toString(), permission.verdict, `not requested: a recorded access-control wall (${permission.detail})`);
        return null;
      }
      if (permission.rateLimited) {
        skipped(purpose, url.toString(), permission.verdict, "not requested: the host answered HTTP 429 to robots.txt; a rate limit is honoured, never pushed through");
        return null;
      }
      if (requests >= maxRequests || hostSpent(url)) {
        skipped(purpose, url.toString(), permission.verdict, hostSpent(url)
          ? `not requested: the website reached its ${hostLimit(url)}-request bound; source remains owed`
          : `not requested: the walk reached its ${maxRequests}-request bound`);
        return null;
      }
      const got = await hop(url, accept, form);
      if (got.status !== null && got.status >= 300 && got.status < 400 && got.location !== null) {
        steps.push({
          purpose, url: url.toString(), permission: permission.verdict, status: got.status, transportError: null, bytes: got.bytes,
          artifactId: null, rung: 2, note: `redirected to ${got.location}`,
        });
        const to = new URL(got.location, url).toString();
        redirects.push({ from: url.toString(), to, status: got.status });
        current = to;
        continue;
      }

      const challenge = got.transportError === null && got.status !== null && textualType(got.contentType)
        ? accessControlIn({ status: got.status, text: got.body })
        : null;
      const walled = challenge !== null && challenge.kind === "CHALLENGE";
      const ok = got.status !== null && got.status >= 200 && got.status < 300 && got.transportError === null && !walled;
      /* A 404 or 410 is the only evidence that withdraws a derived wiring row, so its body is vaulted. Nothing else is read from it. */
      const gone = got.transportError === null && (got.status === 404 || got.status === 410);
      /* The body reaches the walk as decoded text, so a binary one (a PDF) would be vaulted as something it is not. */
      const binary = (ok || gone) && !textualType(got.contentType);
      const kept = (ok || gone || walled) && !binary ? await vaultBody(url.toString(), got.status!, got.contentType, got.body, permission.verdict, got.retrievedAt) : null;
      const artifactId = kept?.artifactId ?? null;
      steps.push({
        purpose, url: url.toString(), permission: permission.verdict, status: got.status, transportError: got.transportError, bytes: got.bytes,
        artifactId, rung: 2,
        ...(walled ? { accessControl: challenge.detail } : {}),
        note: walled
          ? `${challenge.detail}; never solved or evaded${artifactId === null ? "" : "; the challenge page is vaulted as its evidence"}`
          : binary
          ? `read ${got.bytes} bytes of ${got.contentType}; not vaulted: a binary body does not survive the text decode`
          : ok ? `read ${got.bytes} bytes${kept?.note ? `; ${kept.note}` : ""}`
            : gone ? `HTTP ${got.status}${artifactId === null ? "" : "; its body is vaulted as withdrawal evidence"}`
            : got.transportError !== null ? `transport failure: ${got.transportError}` : `HTTP ${got.status ?? "none"}`,
      });
      /* What the walk reads of a body is what it may keep: a credential-bearing page is read as its sanitized derivative. */
      const hintUrl = hintSources.get(start);
      if (hintUrl) hintSources.set(url.toString(), hintUrl);
      return ok ? { finalUrl: url.toString(), status: got.status!, body: kept?.readable ?? got.body, bytes: got.bytes, contentType: got.contentType, artifactId, redirects } : null;
    }
    skipped(purpose, current, "ALLOWED", `not requested: more than ${MAX_REDIRECT_HOPS} redirects`);
    return null;
  }

  let candidates: readonly EndpointCandidate[] = [];
  /** A tenant page names its committees; each public form lookup keeps that naming page in its attestation. */
  async function readBoardDocs(candidate: EndpointCandidate, got: NonNullable<Awaited<ReturnType<typeof get>>>, via: Via): Promise<void> {
    const hintUrl = hintSource(candidate, via);
    const committees = parseBoardDocsCommittees(got.body);
    const lastRead = new Map<string, string>();
    for (const prior of runtime.priorAttempts ?? []) for (const step of prior.steps) {
      if (step.purpose === "endpoint" && step.status !== null && (lastRead.get(step.url) ?? "") < prior.finishedAt) lastRead.set(step.url, prior.finishedAt);
    }
    committees.sort((a, b) => (lastRead.get(boardDocsListUrl(got.finalUrl, a.id)) ?? "").localeCompare(lastRead.get(boardDocsListUrl(got.finalUrl, b.id)) ?? ""));
    leads.push({ vendor: "boarddocs", url: candidate.url, basis: candidate.basis, evidence: candidate.evidence,
      detail: committees.length ? `${committees.length} published BoardDocs committee selector(s)` : "the portal publishes no readable committee selector in this response", via });
    for (const committee of committees) {
      const route = boardDocsListUrl(got.finalUrl, committee.id);
      const list = await get(route, "endpoint", "application/json", { current_committee_id: committee.id });
      const check = list === null ? { verdict: "NOT_CONFIRMED", count: null, detail: "the committee list could not be read this walk" }
        : verifyEndpointBody({ vendor: "boarddocs", url: route }, { status: list.status, body: list.body, finalUrl: list.finalUrl });
      const base = { vendor: "boarddocs", url: route, basis: "LINKED" as const, evidence: `BoardDocs committee "${committee.name}" (${committee.id}) on ${got.finalUrl}`,
        detail: check.detail, via: { page: candidate.url, artifactId: got.artifactId }, bodyName: committee.name, ...(hintUrl ? { hintUrl } : {}) };
      if (check.verdict === "YIELDED" || check.verdict === "EMPTY") found.push({ ...base, count: check.count, artifactId: list?.artifactId ?? null });
      else leads.push(base);
    }
  }
  const enumeratedTenants = new Set<string>();
  async function readLegistarBodies(candidate: EndpointCandidate, via: Via): Promise<void> {
    const hintUrl = hintSource(candidate, via);
    const parsed = new URL(candidate.url);
    const client = /^\/v1\/([^/]+)\/events$/.exec(parsed.pathname)?.[1];
    if (!client || parsed.hostname !== "webapi.legistar.com" || enumeratedTenants.has(client)) return;
    enumeratedTenants.add(client);
    const listUrl = `${parsed.origin}/v1/${client}/bodies`;
    const list = await get(listUrl, "endpoint", "application/json");
    let bodies: { BodyId: number; BodyName: string; BodyActiveFlag?: number; BodyMeetFlag?: number }[] = [];
    try { bodies = list ? JSON.parse(list.body) : []; } catch { bodies = []; }
    if (!Array.isArray(bodies)) bodies = [];
    leads.push({ vendor: "legistar-api", url: listUrl, basis: "LINKED", evidence: candidate.evidence,
      detail: `${bodies.length} published Legistar bodies`, via });
    for (const body of bodies) {
      if (!Number.isInteger(body.BodyId) || typeof body.BodyName !== "string") continue;
      const route = new URL(`${parsed.origin}/v1/${client}/events`);
      const day = (delta: number) => new Date(Date.parse(runtime.now()) + delta * 86_400_000).toISOString().slice(0, 10);
      route.searchParams.set("$filter", `EventBodyId eq ${body.BodyId} and EventDate ge datetime'${day(-120)}' and EventDate le datetime'${day(120)}'`);
      const calendar = await get(route.href, "endpoint", "application/json");
      const check = calendar ? verifyEndpointBody(candidate, { status: calendar.status, body: calendar.body, finalUrl: calendar.finalUrl })
        : { verdict: "NOT_CONFIRMED", count: null, detail: "the body's calendar could not be read" };
      const result = { vendor: "legistar-api", url: route.href, basis: "LINKED" as const,
        evidence: `Legistar body ${body.BodyId}: ${body.BodyName}`, detail: check.detail,
        via: { page: listUrl, artifactId: list?.artifactId ?? null }, bodyName: body.BodyName, ...(hintUrl ? { hintUrl } : {}) };
      if (check.verdict === "YIELDED" || check.verdict === "EMPTY") found.push({ ...result, count: check.count, artifactId: calendar?.artifactId ?? null });
      else leads.push(result);
    }
  }
  async function readCivicClerkBodies(candidate: EndpointCandidate, via: Via): Promise<void> {
    const hintUrl = hintSource(candidate, via);
    const parsed = new URL(candidate.url);
    if (!parsed.hostname.endsWith(".api.civicclerk.com") || enumeratedTenants.has(parsed.hostname)) return;
    enumeratedTenants.add(parsed.hostname);
    const listUrl = `${parsed.origin}/v1/EventCategories`;
    type Category = { id: number; categoryDesc: string; isPublic?: boolean };
    const namingPages = new Map<number, { url: string; artifactId: string | null }>();
    let unread = listUrl;
    let categories: Category[];
    try {
      categories = await readCivicClerkPages<Category>(listUrl, async url => {
        unread = url;
        const list = await get(url, "endpoint", "application/json");
        if (!list) throw new Error("CIVICCLERK_CATEGORY_UNREAD");
        const page: CivicClerkPage<Category> = JSON.parse(list.body);
        if (!Array.isArray(page.value) || page.value.some(category => typeof category.categoryDesc !== "string")) throw new Error("CIVICCLERK_CATEGORY_SHAPE_CHANGED");
        for (const category of page.value) namingPages.set(category.id, { url, artifactId: list.artifactId });
        return page;
      });
    } catch {
      leads.push({ vendor: "civicclerk-api", url: unread, basis: "LINKED", evidence: candidate.evidence,
        detail: "The public category list remains owed; its pages could not be read completely", via });
      return;
    }
    leads.push({ vendor: "civicclerk-api", url: listUrl, basis: "LINKED", evidence: candidate.evidence,
      detail: `${categories.length} published CivicClerk categories`, via });
    const lastRead = new Map<string, string>();
    for (const prior of runtime.priorAttempts ?? []) for (const step of prior.steps) {
      if (step.purpose === "endpoint" && step.status !== null && (lastRead.get(step.url) ?? "") < prior.finishedAt) lastRead.set(step.url, prior.finishedAt);
    }
    const categoryRoute = (category: Category) => {
      const route = new URL(`${parsed.origin}/v1/Events`);
      route.searchParams.set("$filter", `categoryId eq ${category.id}`);
      route.searchParams.set("$top", "200");
      route.searchParams.set("$orderby", "id desc");
      return route.href;
    };
    categories.sort((a, b) => (lastRead.get(categoryRoute(a)) ?? "").localeCompare(lastRead.get(categoryRoute(b)) ?? ""));
    for (const category of categories) {
      const name = category.categoryDesc;
      if (category.isPublic === false || typeof name !== "string" || !name.trim()) continue;
      const naming = namingPages.get(category.id)!;
      unread = categoryRoute(category);
      try {
        await readCivicClerkPages<CivicClerkEvent>(unread, async url => {
          unread = url;
          const calendar = await get(url, "endpoint", "application/json");
          if (!calendar) throw new Error("CIVICCLERK_CALENDAR_UNREAD");
          const page: CivicClerkPage<CivicClerkEvent> = JSON.parse(calendar.body);
          if (!Array.isArray(page.value) || page.value.some(event => event.categoryId !== category.id)) throw new Error("CIVICCLERK_CATEGORY_MISMATCH");
          const check = verifyEndpointBody(candidate, { status: calendar.status, body: calendar.body, finalUrl: calendar.finalUrl });
          const result = { vendor: "civicclerk-api", url, basis: "LINKED" as const,
            evidence: `CivicClerk category ${category.id}: ${name}`, detail: check.detail,
            via: { page: naming.url, artifactId: naming.artifactId }, bodyName: name, ...(hintUrl ? { hintUrl } : {}) };
          if (check.verdict === "YIELDED" || check.verdict === "EMPTY") found.push({ ...result, count: check.count, artifactId: calendar.artifactId });
          else leads.push(result);
          return page;
        });
      } catch {
        leads.push({ vendor: "civicclerk-api", url: unread, basis: "LINKED", evidence: `CivicClerk category ${category.id}: ${name}`,
          detail: "The public category calendar remains owed; its pages could not be read completely", via: { page: naming.url, artifactId: naming.artifactId } });
      }
    }
  }
  let proposals: readonly RecipeCandidate[] = [];
  const primeGovSelectors = new Map<string, NonNullable<Awaited<ReturnType<typeof get>>> | null>();
  async function readPrimeGov(candidate: EndpointCandidate, got: NonNullable<Awaited<ReturnType<typeof get>>>, via: Via): Promise<void> {
    const selectorUrl = `${primeGovBase(got.finalUrl)}/api/committee/GetCommitteeesListByShowInPublicPortal`;
    if (!primeGovSelectors.has(selectorUrl)) {
      const selector = await get(selectorUrl, "endpoint", "application/json");
      primeGovSelectors.set(selectorUrl, selector);
      leads.push({ vendor: "primegov", url: selectorUrl, basis: candidate.basis, evidence: candidate.evidence, detail: "Public committee identities and names", via });
    }
    const selector = primeGovSelectors.get(selectorUrl);
    try {
      if (!selector) throw new Error("the public committee selector could not be read");
      parsePrimeGovCommittees(selector.body);
      const check = verifyEndpointBody(candidate, { status: got.status, body: got.body, finalUrl: got.finalUrl });
      const base = { vendor: "primegov", url: candidate.url, basis: candidate.basis, evidence: candidate.evidence, detail: check.detail,
        via: { page: selectorUrl, artifactId: selector.artifactId } };
      if (check.verdict === "YIELDED") found.push({ ...base, count: check.count, artifactId: got.artifactId });
      else leads.push(base);
    } catch (error) {
      leads.push({ vendor: "primegov", url: candidate.url, basis: candidate.basis, evidence: candidate.evidence, detail: String(error), via });
    }
  }
  let homeOrigin: string | null = null;
  let homeHtml: string | null = null;
  const recipeSkips: { recipeId: string; why: string }[] = [];

  const hints = routeHintsFor(need.jurisdictionId, runtime.routeHints ?? []);
  const hintSources = new Map((hints?.routes ?? []).map(route => [route.url, route.url]));
  if (hints?.officialSite) hintSources.set(`${hints.officialSite.origin}/`, hints.officialSite.origin);
  function hintSource(candidate: EndpointCandidate, via: Via): string | undefined {
    const source = candidate.basis === "HINT" ? candidate.url : hintSources.get(candidate.url) ?? (via ? hintSources.get(via.page) : undefined);
    if (source) hintSources.set(candidate.url, source);
    return source;
  }
  const hintedSite = hints?.officialSite ?? null;
  const hintedOrigins = new Set(hintedSite === null ? [] : siteOrigins(hintedSite.origin));
  const origins = [...new Set([...hintedOrigins, ...siteOrigins(need.ownWebAddress)])];
  /* Why a hinted site that answered was not walked as the government's own; null when it was, or never answered. */
  let hintedSiteRefused: string | null = null;
  /* Whether the homepage the walk read came from the hinted site (directly or by its own redirect). */
  let homeFromHint = false;

  const pageIdentity = async (pageLabel: string | null, pageUrl: string): Promise<OfficialPageIdentity> => {
    let linkingPage;
    try {
      linkingPage = await officialLinkingPageFromAsync(pageUrl, officialPages) ?? await runtime.officialLinkingPageFor?.(pageUrl);
    } catch (error) {
      if (runtime.budget.spent() || timeLeftMs() < MIN_REQUEST_MS) throw new OutOfTime();
      throw error;
    }
    return {
    bodyId: need.jurisdictionId,
    name: need.name,
    pageLabel,
    linkingPage,
    officialHost: new URL(homeOrigin ?? origins[0] ?? "https://invalid.invalid").host,
    stateCode: need.stateCode,
    countyFips: need.countyFips,
    now: runtime.now(),
    };
  };
  const found: DiscoveryFind[] = [];
  const leads: Omit<DiscoveryFind, "count" | "artifactId">[] = [];
  const recipeApplied: MeetingsDiscoveryAttempt["recipes"]["applied"][number][] = [];
  /* `via`: the read page whose link the route came from, which its host attestation chains through. */
  type Via = { readonly page: string; readonly artifactId: string | null } | null;
  const planned: { candidate: EndpointCandidate; recipeIds: string[]; label: string | null; via: Via }[] = [];
  /* The pages step 3 read, kept so step 3b can read the routes they link. */
  const readPages: { url: string; body: string; finalUrl: string; artifactId: string | null }[] = [];
  /* The homepage read as the government's own, and how the walk got there. */
  let homePage: Via = null;
  let homeProvenance: NonNullable<MeetingsDiscoveryAttempt["site"]>["homepage"] = null;
  let platformCensus: PlatformCensusObservation | undefined;
  const queryTrail: MeetingsDiscoveryAttempt["search"][number][] = [];
  const learned: MeetingsRecipe[] = [];
  let checked = 0;
  const checks = new Map<string, { check: ReturnType<typeof verifyEndpointBody> | null; read: boolean }>();
  async function checkCandidate({ candidate, recipeIds, label, via }: typeof planned[number]) {
    const previous = checks.get(candidate.url);
    if (previous) {
      if (previous.check) for (const recipeId of recipeIds) recipeApplied.push({ recipeId, url: candidate.url,
        verdict: previous.read ? previous.check.verdict : "NOT_READ", detail: previous.check.detail });
      return;
    }
    const hintUrl = hintSource(candidate, via);
    const got = await get(candidate.url, "endpoint", ACCEPT_PAGE);
    checked += 1;
    if (got !== null && /html/i.test(got.contentType)) readPages.push({ url: candidate.url, body: got.body, finalUrl: got.finalUrl, artifactId: got.artifactId });
    if (candidate.verifiable && candidate.vendor === "boarddocs" && got !== null) {
      await readBoardDocs(candidate, got, via);
      checks.set(candidate.url, { check: null, read: true });
      return;
    }
    if (candidate.vendor === "primegov" && got !== null) {
      await readPrimeGov(candidate, got, via);
      checks.set(candidate.url, { check: null, read: true });
      return;
    }
    const hint = candidate.basis === "HINT" && !candidate.verifiable ? hints?.routes.find((r) => r.url === candidate.url) : undefined;
    const check = got === null
      ? { verdict: "NOT_CONFIRMED" as const, count: null, detail: "the route could not be read this walk" }
      : hint !== undefined
        ? {
            verdict: "NOT_CONFIRMED" as const,
            count: null,
            detail: `answered HTTP ${got.status} with ${got.bytes} bytes of ${got.contentType || "an unnamed type"}; ` +
              (hint.kind === "WITNESS"
                ? "a witness corroborates a sitting and is never one on its own"
                : `no content check covers a ${hint.kind.toLowerCase()} yet: a lead, not a route`),
          }
        : verifyEndpointBody(candidate, { status: got.status, body: got.body, finalUrl: got.finalUrl }, await pageIdentity(label, got.finalUrl));
    const base = { vendor: candidate.vendor, url: candidate.url, basis: candidate.basis, evidence: candidate.evidence, detail: check.detail, via, ...(hintUrl ? { hintUrl } : {}) };
    if (check.verdict === "YIELDED") found.push({ ...base, count: check.count, artifactId: got?.artifactId ?? null });
    else if (candidate.basis !== "RECIPE") leads.push(base);
    checks.set(candidate.url, { check, read: got !== null });
    if (candidate.verifiable && candidate.vendor === "legistar-api") await readLegistarBodies(candidate, via);
    if (candidate.verifiable && candidate.vendor === "civicclerk-api") await readCivicClerkBodies(candidate, via);
    for (const recipeId of recipeIds) {
      recipeApplied.push({ recipeId, url: candidate.url, verdict: got === null ? "NOT_READ" : check.verdict, detail: check.detail });
    }
  }
  try {
    /* 1–2. The homepage, on each origin in turn (a hinted current site first), until one is read. */
    for (const origin of origins) {
      const home = await get(`${origin}/`, "homepage", ACCEPT_PAGE);

      if (home !== null && hintedSite !== null && hintedOrigins.has(origin) && !namesItself(home.body, hintedSite.selfName)) {
        hintedSiteRefused = `its homepage no longer names ${hintedSite.selfName}`;
        skipped("homepage", home.finalUrl, "ALLOWED", `read, but not walked as ${need.name}'s own site: ${hintedSiteRefused}`);
        continue;
      }
      if (home !== null) {
        homeOrigin = new URL(home.finalUrl).origin;
        homeFromHint = hintedOrigins.has(origin);
        homePage = { page: home.finalUrl, artifactId: home.artifactId };
        homeProvenance = {
          url: home.finalUrl,
          artifactId: home.artifactId,
          basis: homeFromHint ? "ROUTE_HINT" : "RECORDED_ADDRESS",
          hintFingerprint: homeFromHint && hints !== null ? routeHintsFingerprint(hints) : null,
          startedAt: `${origin}/`,
          redirects: home.redirects,
        };
        homeHtml = home.body;
        platformCensus = observePlatformCensus(home.body, home.finalUrl, home.artifactId, runtime.now(), runtime.fingerprints);
        candidates = meetingEndpointCandidates(home.body, home.finalUrl, runtime.now(), runtime.fingerprints);
        /* The saved methods whose precondition this homepage shows (lib/hunt/meetings-recipes.ts). */
        const proposed = recipeCandidates({
          recipes: runtime.recipes ?? [],
          need,
          origin: homeOrigin,
          homepageHtml: home.body,
          nowIso: runtime.now(),
        });
        proposals = proposed.candidates;
        recipeSkips.push(...proposed.skipped);
        break;
      }
    }

    for (const h of hints?.routes ?? []) {
      planned.push({
        candidate: { vendor: h.verifyAs ?? h.platform, url: h.url, basis: "HINT", evidence: `route hint (${h.kind.toLowerCase()}, observed ${h.observed.at} by ${h.observed.by}): ${h.evidence}`, verifiable: h.kind !== "WITNESS" && h.verifyAs !== null },
        recipeIds: [],
        label: h.body,
        via: null,
      });
    }
    for (const candidate of planned) await checkCandidate(candidate);

    if (homeOrigin !== null) {
      const observed = new Map(platformCensus?.matches.map(match => [`${match.platform}|${match.tenant}`, match]));
      for (const path of ["/agendas", "/meetings", "/calendar", "/sitemap.xml"]) {
        const page = await get(`${homeOrigin}${path}`, "endpoint", ACCEPT_PAGE);
        if (!page) continue;
        readPages.push({ url: page.finalUrl, ...page });
        const html = page.body.replace(/<loc>([^<]+)<\/loc>/gi, '<a href="$1"></a>');
        for (const candidate of meetingEndpointCandidates(html, page.finalUrl, runtime.now(), runtime.fingerprints)) {
          if (!candidates.some(existing => existing.url === candidate.url)) candidates = [...candidates, candidate];
        }
        for (const match of observePlatformCensus(html, page.finalUrl, page.artifactId, runtime.now(), runtime.fingerprints).matches) {
          observed.set(`${match.platform}|${match.tenant}`, match);
        }
      }
      if (platformCensus) platformCensus = { ...platformCensus, matches: [...observed.values()] };
    }

    const civicPlusFeeds: { candidate: EndpointCandidate; via: Via }[] = [];
    // Retain the linked public portal itself before using its API: the exact
    // body name and the official site's link are required for automatic review.
    for (const portal of candidates.filter(c => c.vendor === "diligent" && !c.verifiable)) {
      const got = await get(portal.url, "endpoint", ACCEPT_PAGE);
      leads.push({ vendor: portal.vendor, url: portal.url, basis: portal.basis, evidence: portal.evidence, detail: got ? "public portal retained for body identity and service discovery" : "portal could not be read", via: homePage });
      if (got) {
        readPages.push({ url: portal.url, body: got.body, finalUrl: got.finalUrl, artifactId: got.artifactId });
        for (const c of meetingEndpointCandidates(got.body, got.finalUrl, runtime.now(), runtime.fingerprints).filter(c => c.vendor === "diligent" && c.verifiable)) civicPlusFeeds.push({ candidate: c, via: { page: got.finalUrl, artifactId: got.artifactId } });
      }
    }
    let civicPlusIndex: string | null = null;
    if (homeOrigin !== null && candidates.some((c) => c.vendor === "civicplus-agendacenter")) {
      civicPlusIndex = `${homeOrigin}${CIVICPLUS_CALENDAR_INDEX_PATH}`;
      const index = await get(civicPlusIndex, "endpoint", ACCEPT_PAGE);
      const evidence = "CivicPlus markup on the government's own domain: its iCalendar index lists one feed per calendar category";
      const indexOrigin = index === null ? null : new URL(index.finalUrl).origin;
      if (index === null) {
        leads.push({ vendor: "civicplus-icalendar", url: civicPlusIndex, basis: "SERVED_BY", evidence, detail: "the route could not be read this walk", via: homePage });
      } else if (indexOrigin !== homeOrigin) {
        leads.push({ vendor: "civicplus-icalendar", url: civicPlusIndex, basis: "SERVED_BY", evidence, detail: `it answered from ${indexOrigin}, off the homepage's origin, so no feed it lists is proposed`, via: homePage });
      } else {
        const feeds = civicPlusCategoryFeeds(index.body, index.finalUrl);
        const proposed: string[] = [];
        const unmatched: string[] = [];
        for (const feed of feeds) {
          const named = categoryBodyOf(feed.name, need.jurisdictionId);
          if ("unmatched" in named) unmatched.push(`${named.unmatched} (catID ${feed.catId})`);
          else proposed.push(`"${feed.name}" (catID ${feed.catId})`);
          civicPlusFeeds.push({
            candidate: {
              vendor: "ical",
              url: feed.url,
              basis: "LINKED",
              evidence: `CivicPlus calendar category "${feed.name}" (catID ${feed.catId}), listed on ${index.finalUrl}: ` +
                ("unmatched" in named ? "read each event for its own body; the category is not a body attribution" : `it names the government's ${named.role === "GOVERNING" ? "governing body" : "sub-body"}, "${named.name}"`),
              verifiable: true,
            },
            via: { page: index.finalUrl, artifactId: index.artifactId },
          });
        }
        leads.push({
          vendor: "civicplus-icalendar",
          url: index.finalUrl,
          basis: "SERVED_BY",
          evidence,
          detail: feeds.length === 0
            ? "the index lists no category calendar feed"
            : `${feeds.length} category feed(s); proposed bodies: ${proposed.length === 0 ? "none" : proposed.join(", ")}; ` +
              `left unmatched: ${unmatched.length === 0 ? "none" : unmatched.join("; ")}`,
          via: homePage,
        });
      }
    }

    /* The category feeds a CivicPlus index proposed, after the hints and before the homepage's own links. */
    for (const { candidate, via } of civicPlusFeeds.filter((f) => !planned.some((p) => p.candidate.url === f.candidate.url))) {
      planned.push({ candidate, recipeIds: [], label: null, via });
    }
    /* A homepage link to the CivicPlus index itself is not a feed, and the index was already read. */
    const isIndex = (url: string): boolean => civicPlusIndex !== null && url.toLowerCase() === civicPlusIndex.toLowerCase();
    for (const candidate of candidates.filter((c) => (c.verifiable || c.vendor === "own-site-meetings-page") && !isIndex(c.url) && !planned.some((p) => p.candidate.url === c.url))) {
      planned.push({ candidate, recipeIds: [], label: null, via: homePage });
    }
    for (const p of proposals) {
      const same = planned.find((x) => x.candidate.url === p.url);
      if (same) {
        same.recipeIds.push(p.recipeId);
        continue;
      }
      planned.push({
        candidate: { vendor: p.extractorId, url: p.url, basis: "RECIPE", evidence: `saved method ${p.recipeId}`, verifiable: true },
        recipeIds: [p.recipeId],
        label: p.label,
        /* A saved method proposes a path on the homepage's own origin, or a link the homepage carries. */
        via: homePage,
      });
    }
    const lastRead = new Map<string, string>();
    for (const prior of runtime.priorAttempts ?? []) for (const step of prior.steps) {
      if (step.purpose !== "endpoint" || step.status === null) continue;
      if ((lastRead.get(step.url) ?? "") < prior.finishedAt) lastRead.set(step.url, prior.finishedAt);
    }
    planned.sort((a, b) => Number(b.candidate.basis === "HINT") - Number(a.candidate.basis === "HINT") ||
      (lastRead.get(a.candidate.url) ?? "").localeCompare(lastRead.get(b.candidate.url) ?? ""));
    for (const candidate of planned) await checkCandidate(candidate);


    {
      const tried = new Set([...planned.map((p) => p.candidate.url), ...candidates.map((c) => c.url), ...(civicPlusIndex === null ? [] : [civicPlusIndex])]);
      const nextHop: { candidate: EndpointCandidate; via: Via }[] = [];
      for (const page of readPages) {
        const pageVia: Via = { page: page.finalUrl, artifactId: page.artifactId };
        for (const c of meetingEndpointCandidates(page.body, page.finalUrl, runtime.now(), runtime.fingerprints)) {
          if (tried.has(c.url)) continue;
          tried.add(c.url);
          const linked = { ...c, evidence: `linked from ${page.url} (${c.evidence})` };
          if (c.verifiable) nextHop.push({ candidate: linked, via: pageVia });
          else leads.push({ vendor: c.vendor, url: c.url, basis: c.basis, evidence: linked.evidence, detail: "recognised but not readable by any content check yet", via: pageVia });
        }
      }
      for (const { candidate, via } of nextHop) {
        const hintUrl = hintSource(candidate, via);
        const got = await get(candidate.url, "endpoint", ACCEPT_PAGE);
        checked += 1;
        if (candidate.vendor === "boarddocs" && got !== null) {
          await readBoardDocs(candidate, got, via);
          continue;
        }
        if (candidate.vendor === "primegov" && got !== null) {
          await readPrimeGov(candidate, got, via);
          continue;
        }
        const check = got === null
          ? { verdict: "NOT_CONFIRMED" as const, count: null, detail: "the route could not be read this walk" }
          : verifyEndpointBody(candidate, { status: got.status, body: got.body, finalUrl: got.finalUrl }, await pageIdentity(null, got.finalUrl));
        const base = { vendor: candidate.vendor, url: candidate.url, basis: candidate.basis, evidence: candidate.evidence, detail: check.detail, via, ...(hintUrl ? { hintUrl } : {}) };
        if (check.verdict === "YIELDED") found.push({ ...base, count: check.count, artifactId: got?.artifactId ?? null });
        else leads.push(base);
      }
    }

    if (runtime.search !== undefined && !searchScope?.hold && origins.length > 0) {
      const search = runtime.search;
      const identity = identityFor(need, homeOrigin ?? origins[0], new Date(startedAt).getUTCFullYear());
      /* A saved method searches only where its precondition shows (or it has none) and no failure of it stands here. */
      const applicable = recipesFor(runtime.recipes ?? [], { bodyClass: need.govClass, state: need.stateCode }).filter(
        (r) =>
          (r.precondition === null || (homeHtml !== null && new RegExp(r.precondition, "i").test(homeHtml))) &&
          failureStands(r, need.jurisdictionId, startedAt) === null,
      );
      const tried = new Set(planned.map((p) => p.candidate.url));
      for (const q of plannedQueries(applicable, identity, runtime.maxQueriesPerWalk ?? DEFAULT_MAX_QUERIES_PER_WALK)) {
        /* A query starts only with time left for its worst case: the time never cuts off a request already paid for. */
        if (timeLeftMs() < (search.worstCaseMs ?? DEFAULT_SEARCH_WORST_CASE_MS)) throw new OutOfTime();
        const res = await search({ query: q.query, ownSiteDomain: q.ownSiteOnly ? identity.domain : null });
        const requests = res.requests.map((r) => {
          const { usd, price } = requestPrice(r.provider, r.status === "DELIVERED");
          return {
            provider: r.provider, host: price.host, status: r.status, error: r.error, hitCount: r.hitCount,
            usd: r.status === "BUDGET_REFUSED" ? null : usd, priceSource: price.source, priceReadOn: price.readOn, bytes: r.bytes,
          };
        });
        for (const r of requests) {
          if (r.status === "BUDGET_REFUSED") continue;
          await runtime.recordCost?.(searchCostEntry({
            attemptId, jurisdictionId: need.jurisdictionId, routeId: q.recipeId ?? `discovery-search:${q.templateId}`,
            host: r.host, usd: r.usd, bytes: r.bytes, recordedAt: runtime.now(), assignmentKeys: searchScope?.assignmentKeys,
            assignmentRefs: searchScope?.assignmentRefs,
          }));
        }
        /* Recorded before its results are followed, so a query the time cuts off still reports what it cost. */
        const followed: string[] = [];
        queryTrail.push({
          templateId: q.templateId, recipeId: q.recipeId, query: q.query, ownSiteOnly: q.ownSiteOnly,
          requests: requests.map(({ bytes: _bytes, ...rest }) => rest), followed,
        });
        for (const hit of res.hits) {
          if (followed.length >= MAX_HITS_FOLLOWED_PER_QUERY) break;
          const standing = hitStanding(hit.url, identity.domain, homePage && homeHtml ? { url: homePage.page, html: homeHtml } : null);
          if (standing === null || tried.has(hit.url)) continue;
          tried.add(hit.url);
          const page = await get(hit.url, "endpoint", ACCEPT_PAGE);
          /* Listed once asked for: a result the time cut off before its request is not "followed". */
          followed.push(hit.url);
          if (page === null) continue;
          /* The result may itself be a route; otherwise it is read as a page for the routes it evidences. */
          const direct = meetingEndpointCandidates(`<a href="${hit.url.replace(/"/g, "%22")}"></a>`, page.finalUrl).filter((c) => c.verifiable);
          const onPage = meetingEndpointCandidates(page.body, page.finalUrl).filter((c) => c.verifiable && !tried.has(c.url));
          /* A result on the government's own domain may itself be the page that dates its sessions: checked from the body already read. */
          const selfPage = standing === "OWN_SITE"
            ? [{ vendor: "official-page-events", url: hit.url, basis: "SEARCH" as const, evidence: hit.url, verifiable: true }]
            : [];
          for (const c of [...direct, ...selfPage, ...onPage].slice(0, 3)) {
            const body = c.url === hit.url ? page : (tried.add(c.url), await get(c.url, "endpoint", ACCEPT_PAGE));
            if (body === null) continue;
            const via: Via = onPage.includes(c) ? { page: page.finalUrl, artifactId: page.artifactId } : null;
            if (c.vendor === "boarddocs") {
              await readBoardDocs(c, body, via);
              continue;
            }
            if (c.vendor === "primegov") {
              await readPrimeGov(c, body, via);
              continue;
            }
            const check = verifyEndpointBody(c, { status: body.status, body: body.body, finalUrl: body.finalUrl }, await pageIdentity(null, body.finalUrl));
            const base = { vendor: c.vendor, url: c.url, basis: "SEARCH" as const, evidence: `search "${q.query}" found ${hit.url}`, detail: check.detail, via };
            if (check.verdict !== "YIELDED") {
              leads.push(base);
              continue;
            }
            found.push({ ...base, count: check.count, artifactId: body.artifactId });
            if (q.recipeId !== null) recipeApplied.push({ recipeId: q.recipeId, url: c.url, verdict: "YIELDED", detail: check.detail });
            else learned.push(recipeFromSearchFind({ templateId: q.templateId, template: q.template, vendor: c.vendor as VerifiableVendor, need, attemptId }));
            break;
          }
        }
        if (q.recipeId !== null && found.length === 0) {
          recipeApplied.push({ recipeId: q.recipeId, url: `search:${q.query}`, verdict: "NOT_CONFIRMED", detail: followed.length === 0 ? "the search returned no result on the government's own domain or a known publisher" : "no result the search pointed to was confirmed by content" });
        }
        if (found.length > 0) break;
      }
    }
  } catch (error) {
    if (!(error instanceof OutOfTime)) throw error;
    /* A route already confirmed by content stands. Anything less concludes nothing about the site. */
    if (found.length === 0) throw new DiscoveryTimeSpent(need.jurisdictionId, requests, queryTrail);

    for (const { candidate, via } of planned.slice(checked)) {
      if (candidate.basis === "RECIPE") continue;
      leads.push({ vendor: candidate.vendor, url: candidate.url, basis: candidate.basis, evidence: candidate.evidence, detail: "not checked: the cycle's discovery time ran out first", via });
    }
  }
  for (const candidate of candidates.filter((c) => !c.verifiable).slice(0, 8)) {
    if (leads.some(lead => lead.vendor === candidate.vendor && lead.url === candidate.url)) continue;
    leads.push({ vendor: candidate.vendor, url: candidate.url, basis: candidate.basis, evidence: candidate.evidence, detail: "recognised but not readable by any content check yet", via: homePage });
  }

  const finishedAt = runtime.now();
  const outcome: DiscoveryOutcome = decideOutcome({ found, leads, steps });
  return {
    formatVersion: 1,
    attemptId,
    jurisdictionId: need.jurisdictionId,
    stateCode: need.stateCode,
    ownWebAddress: need.ownWebAddress,
    startedAt,
    finishedAt,
    outcome,
    found,
    leads,
    steps,
    recipes: { applied: recipeApplied, skipped: recipeSkips, learned },
    search: queryTrail,
    requestCount: requests,
    recheckAfter: steps.some(step => step.status === null && /request bound/.test(step.note)) ? finishedAt : recheckAfter(finishedAt),
    site: { address: need.addressSource ?? null, homepage: homeProvenance },
    ...(platformCensus ? { platformCensus } : {}),
    note: noteFor(need, outcome, found, leads, origins.length) + siteNote(hintedSite, homeFromHint, hintedSiteRefused) + (searchScope?.hold ? ` ${searchScope.hold}` : ""),
    ...(hints === null
      ? {}
      : {
          routeHints: {
            fingerprint: routeHintsFingerprint(hints),
            officialSite: hintedSite?.origin ?? null,
            replaces: hintedSite?.replaces ?? null,
            homepageRead: homeOrigin,
            routes: hints.routes.map((r) => r.url),
          },
        }),
  };
}

/** What the walk says about a stale recorded address it walked past. Empty when no official-site hint applied. */
function siteNote(hinted: JurisdictionRouteHints["officialSite"], readFromHint: boolean, refused: string | null): string {
  if (hinted === null) return "";
  const stale = `the recorded ${hinted.replaces} is stale (${hinted.recordedState})`;
  if (readFromHint) return ` It walked the current official site, ${hinted.origin}; ${stale}.`;
  if (refused !== null) return ` The current official site a route hint records, ${hinted.origin}, answered but was not walked as the government's own: ${refused}; ${stale}.`;
  return ` The current official site a route hint records, ${hinted.origin}, could not be read this walk; ${stale}.`;
}

function noteFor(
  need: MeetingsDiscoveryNeed,
  outcome: DiscoveryOutcome,
  found: readonly DiscoveryFind[],
  leads: readonly unknown[],
  origins: number,
): string {
  const who = `${need.name} (${need.jurisdictionId})`;
  switch (outcome) {
    case "FOUND":
      return `${who}: meetings route confirmed by content — ${found.map((f) => `${f.vendor} ${f.url}`).join("; ")}. A candidate for wiring, not yet wired.`;
    case "LEAD":
      return `${who}: ${leads.length} lead(s) evidenced by the site, none confirmed as a meetings route this walk.`;
    case "NOTHING_DETECTED":
      return `${who}: the homepage was read and shows no route this walk recognises. Not an absence; due again at the recheck date.`;
    case "BLOCKED":
      return `${who}: every origin walled this client by an access control (a recorded wall, or its own 401, 403 or 429). Never bypassed; not an absence; a wall, recorded.`;
    default:
      return origins === 0
        ? `${who}: no usable website is recorded, so there was nothing to walk.`
        : `${who}: the site could not be read this walk (a transport failure or a server error). Not a wall; due again at the recheck date.`;
  }
}

/* ---------------------------------------------------------------- the pass */

export function discoveryFieldManualEntries(attempt: MeetingsDiscoveryAttempt): readonly FieldManualEntry[] {
  const states = [attempt.stateCode.toLowerCase()];
  const entry = (kind: string, outcome: FieldManualEntry["outcome"], vendor: string, url: string | null, summary: string, payload: unknown): FieldManualEntry => ({
    id: fieldManualEntryId("cp_log_discovery_attempts", `${attempt.jurisdictionId}|${kind}|${url ?? ""}`),
    role: "SHARED",
    kind,
    title: `${attempt.jurisdictionId} meetings: ${vendor}`,
    summary,
    states,
    recordClasses: ["meetings"],
    platforms: vendor === "own-site-meetings-page" ? [] : [vendor],
    ...(attempt.jurisdictionId.startsWith("ocd-division/") ? { ocdIds: [attempt.jurisdictionId.split("#")[0]!] } : {}),
    outcome,
    url,
    source: "cp_log_discovery_attempts",
    observedAt: attempt.finishedAt,
    tier: "B",
    payload,
  });
  const entries: FieldManualEntry[] = [];
  if (attempt.platformCensus) entries.push(platformCensusEntry(attempt, attempt.platformCensus));
  for (const f of attempt.found) {
    entries.push(entry("MEETINGS_ROUTE", "YIELDED", f.vendor, f.url,
      `${attempt.jurisdictionId}: ${f.vendor} route ${f.url} confirmed by content (${f.detail}); evidenced ${f.basis}.`,
      { attemptId: attempt.attemptId, ...f }));
  }
  for (const l of attempt.leads) {
    entries.push(entry("MEETINGS_LEAD", "REFERENCE", l.vendor, l.url,
      `${attempt.jurisdictionId}: lead ${l.vendor} ${l.url} (${l.detail}).`,
      { attemptId: attempt.attemptId, ...l }));
  }
  if (attempt.outcome === "BLOCKED") {
    /* What walled each origin: a recorded wall (the step's permission), or its own 401, 403 or 429 to this client. A step an older walk skipped for robots.txt still names its verdict. */
    /* An access control only: a recorded wall, the site's own 401/403/429, or a bot challenge. Never a robots line. */
    const walls = attempt.steps.filter((s) =>
      s.purpose === "homepage" &&
      (s.accessControl !== undefined || (s.status === null ? s.permission === "RECORDED_WALL" : [401, 403, 429].includes(s.status))));
    const why = [...new Set(walls.map((s) => (s.accessControl !== undefined ? "a bot challenge" : s.status === null ? s.permission : `HTTP ${s.status}`)))].join(", ");
    entries.push(entry("DEAD_DOOR", "BLOCKED", "own-site", walls[0]?.url ?? attempt.ownWebAddress,
      `${attempt.jurisdictionId}: the site's own origins walled this client by an access control (${why}); never bypassed.`,
      { attemptId: attempt.attemptId, steps: walls }));
  }
  return entries;
}

/** Whether the free walk can walk a need at all: its site is owed and recorded at an address it can open. */
export function walkableByFreeWalk(need: Pick<MeetingsDiscoveryNeed, "basis" | "ownWebAddress">): boolean {
  return need.basis === "SOURCE_DISCOVERY_OWED" && siteOrigins(need.ownWebAddress).length > 0;
}
