/**
 * **THE UNPAID MEETINGS-DISCOVERY EXECUTOR.** (2026-09-23.)
 *
 * The gap ledger records every government whose meetings are still to be
 * discovered (`data/derived/gap-ledger.json` → `meetingsDiscovery.needs`).
 * Nothing walked that list: the local-jurisdictions provider opens no MEETINGS
 * route, and the only executor that walks a site is the paid Scout lane. This
 * is the deterministic one. It makes no model call.
 *
 * For one need it:
 *
 * 1. reads robots.txt for the government's own origin before any other
 *    request, following its redirects as RFC 9309 asks, and walks only what
 *    the verdict allows (DISALLOWED and CANNOT_TELL send nothing). Only a real
 *    wall makes the walk BLOCKED; rules that could not be read make it
 *    COULD_NOT_READ;
 * 2. reads the homepage, following redirects one hop at a time. Each new host
 *    is asked for permission before anything is requested from it;
 * 3. names the meeting routes the page itself evidences
 *    (`lib/hunt/meetings-site-discovery.ts`) and requests the verifiable ones,
 *    confirming each by content;
 * 4. appends the walk, found and not found alike, to `discoveryAttempts`, and
 *    writes found routes, leads and dead doors to the field manual.
 *
 * It keeps to the caller's time. Each request's timeout is cut to the time
 * left, and no request is sent once too little remains. A walk the time runs
 * out on concludes nothing unless it already confirmed a route: it is not
 * recorded as a reading, and the need stays due.
 *
 * It never promotes, never wires a body, and never writes reader truth: a find
 * is a candidate for the verification path. A walk that finds nothing is never
 * an absence (RULING 250); it is a reading with a recheck date.
 *
 * Every request goes through the caller's `open`. The runner builds it on its
 * own FleetSafety provider key, so a latch here cannot stop the routine lanes.
 * The host spacing is shared with every other lane.
 */

import { createHash } from "node:crypto";

import { assertPublicUrl } from "../../hunt/egress.ts";
import type { MeetingsDiscoveryNeed } from "../../hunt/meetings-discovery.ts";
import {
  failureStands,
  identityFor,
  recipeCandidates,
  recipeEntry,
  recipeFromSearchFind,
  recipesFor,
  recordRecipeOutcome,
  type MeetingsRecipe,
  type RecipeCandidate,
} from "../../hunt/meetings-recipes.ts";
import { hitStanding, plannedQueries, requestPrice, type SearchProvider } from "../../hunt/discovery-search.ts";
import { DISCOVERY_SEARCH_ROLE, type CostEntry } from "../cost.ts";
import type { SearchHit } from "../scheduler/scout-contract.ts";
import {
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
import { recordAcquisition } from "../evidence/artifact.ts";
import { fieldManualEntryId, type FieldManualEntry } from "../field-manual.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { writeFieldManualDiscoveries } from "../scheduler/field-manual-scout.ts";
import { DEFAULT_ROBOTS_TOKEN, evaluatePermission } from "../scheduler/robots.ts";
import { DEFAULT_USER_AGENT, type VaultPut } from "../scheduler/route-executor.ts";

/** One HTTP hop. It never follows a redirect: the executor asks permission of every new host first. */
export type DiscoveryOpen = (input: {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}) => Promise<{
  readonly status: number | null;
  readonly body: string;
  readonly bytes: number;
  readonly contentType: string;
  /** The redirect target of a 3xx; null otherwise. */
  readonly location: string | null;
  readonly transportError: string | null;
}>;

export interface DiscoveryRuntime {
  readonly open: DiscoveryOpen;
  /** The runner's shared per-host spacing. */
  readonly spaceOut: (host: string) => Promise<void>;
  readonly vault: VaultPut;
  readonly now: () => string;
  /**
   * Asked before each walk. Once spent, the remaining needs are deferred
   * untouched. `remainingMs`, when given, also bounds the walk in progress:
   * each request's timeout is cut to the time left, and no request is sent
   * with less than MIN_REQUEST_MS of it.
   */
  readonly budget: { readonly spent: () => boolean; readonly remainingMs?: () => number };
  readonly maxRequestsPerWalk?: number;
  readonly timeoutMs?: number;
  /**
   * The saved methods the runner knows (`knownRecipes` over the field manual).
   * Consulted on every walk; each application's outcome is written back.
   */
  readonly recipes?: readonly MeetingsRecipe[];
  /**
   * The search seam (Brave and Exa, pointers only). Absent, the walk never
   * searches. Every provider request it reports is charged to the cost ledger.
   */
  readonly search?: DiscoverySearch;
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

/**
 * Hosts whose owners refused us, measured and recorded, so no request is sent,
 * robots.txt included. Robots alone would also refuse these; the list keeps a
 * recorded refusal from costing another request per walk.
 */
export const RECORDED_WALLS: readonly { readonly host: string; readonly why: string }[] = [
  { host: "go.boarddocs.com", why: "robots-disallowed and 403 to an identified client (docs/source-ladder.md, MISS list)" },
  { host: "pima.granicus.com", why: "robots.txt Disallow: / (GRANICUS_LIVE_PROCEEDINGS_WALL, lib/sources/legistar-insite/horizon.ts)" },
];

export const DEFAULT_MAX_REQUESTS_PER_WALK = 12;
const DEFAULT_TIMEOUT_MS = 20_000;
/** Less time than this left, and a request is not sent: it could not come back inside the budget. */
const MIN_REQUEST_MS = 2_000;
const MAX_REDIRECT_HOPS = 4;
/** RFC 9309 §2.3.1.2: at least five consecutive redirects are followed for robots.txt. */
const MAX_ROBOTS_REDIRECTS = 5;
const MAX_ENDPOINTS_PER_WALK = 6;
const ACCEPT_PAGE = "text/html,application/xhtml+xml,application/json,text/calendar,*/*;q=0.8";
const ACCEPT_ROBOTS = "text/plain,*/*;q=0.5";
const SOURCE_ID = "meetings-discovery";

/** The work identity every artifact of a walk carries: the need, not a WorkItem. */
export function discoveryWorkId(jurisdictionId: string): string {
  return `discovery:meetings:${jurisdictionId}`;
}

export function discoveryAttemptId(jurisdictionId: string, startedAt: string): string {
  return `da-${createHash("sha256").update(`${jurisdictionId}|${startedAt}`).digest("hex").slice(0, 24)}`;
}

/** Raised by a request the caller's time no longer covers. It never leaves the walk. */
class OutOfTime extends Error {}

/**
 * Thrown by a walk the caller's time ran out on before it confirmed anything.
 * Nothing about the site was concluded, so nothing is recorded as a reading:
 * the need stays due, and the requests already made keep their evidence in the
 * vault under the walk's attempt id.
 */
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

function permissionState(p: StepPermission): PermissionState {
  return p === "ALLOWED" ? "ALLOWED" : p === "NO_ROBOTS" ? "NOT_APPLICABLE" : p === "DISALLOWED" ? "DISALLOWED" : "CANNOT_TELL";
}

/**
 * Walk one need's site. Never throws for a site-level failure; the attempt says
 * what happened. Throws DiscoveryTimeSpent when the caller's time ran out before
 * the walk confirmed anything.
 */
export async function walkMeetingsDiscoveryNeed(
  need: MeetingsDiscoveryNeed,
  runtime: DiscoveryRuntime,
): Promise<MeetingsDiscoveryAttempt> {
  const startedAt = runtime.now();
  const attemptId = discoveryAttemptId(need.jurisdictionId, startedAt);
  const workId = discoveryWorkId(need.jurisdictionId);
  const maxRequests = runtime.maxRequestsPerWalk ?? DEFAULT_MAX_REQUESTS_PER_WALK;
  const timeoutMs = runtime.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const steps: DiscoveryStep[] = [];
  const robotsByHost = new Map<string, { readonly verdict: StepPermission; readonly detail: string }>();
  let requests = 0;

  const skipped = (purpose: DiscoveryStep["purpose"], url: string, permission: StepPermission, note: string): void => {
    steps.push({ purpose, url, permission, status: null, transportError: null, bytes: 0, artifactId: null, rung: null, note });
  };

  async function vaultBody(url: string, status: number, contentType: string, body: string, permission: StepPermission): Promise<string | null> {
    if (body.length === 0) return null;
    const { artifact } = recordAcquisition(
      {
        canonicalUrl: url,
        retrievedAt: runtime.now(),
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
    const stored = await runtime.vault(artifact, body);
    return stored.stored ? artifact.id : null;
  }

  const timeLeftMs = (): number => runtime.budget.remainingMs?.() ?? Number.POSITIVE_INFINITY;

  /* The time is asked before the host's spacing and again after it, and the request's timeout never outlasts it. */
  async function hop(url: URL, accept: string) {
    if (timeLeftMs() < MIN_REQUEST_MS) throw new OutOfTime();
    await runtime.spaceOut(url.host.toLowerCase());
    const left = timeLeftMs();
    if (left < MIN_REQUEST_MS) throw new OutOfTime();
    requests += 1;
    return runtime.open({
      url: url.toString(),
      headers: { "user-agent": DEFAULT_USER_AGENT, accept },
      timeoutMs: Math.min(timeoutMs, Math.floor(left)),
    });
  }

  /** The permission verdict for a URL's host, read once per walk. */
  async function permissionFor(url: URL): Promise<{ readonly verdict: StepPermission; readonly detail: string }> {
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
    /*
     * RFC 9309 §2.3.1.2: robots.txt is followed through at least five consecutive
     * redirects, across hosts too, and the document found governs the host asked
     * about. Each hop is a request inside the walk's time and request bounds; a hop
     * to a non-public address is never taken. A chain that does not end on a robots
     * document leaves the verdict CANNOT_TELL.
     */
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
    const artifactId = got.status !== null && got.transportError === null
      ? await vaultBody(at.toString(), got.status, got.contentType, got.body, "ALLOWED")
      : null;
    steps.push({
      purpose: "robots", url: robotsUrl.toString(), permission: verdict, status: got.status, transportError: got.transportError,
      bytes: got.bytes, artifactId, rung: 2, note: via.length === 0 ? reading.detail : `${reading.detail} (followed ${via.length} redirect(s): ${via.join(" → ")})`,
    });
    const entry = { verdict, detail: reading.detail };
    robotsByHost.set(host, entry);
    return entry;
  }

  /** GET one URL, one hop at a time, asking permission of every host first. Null when nothing usable came back. */
  async function get(start: string, purpose: DiscoveryStep["purpose"], accept: string) {
    let current = start;
    for (let hops = 0; hops <= MAX_REDIRECT_HOPS; hops += 1) {
      let url: URL;
      try {
        url = assertPublicUrl(current);
      } catch (error) {
        skipped(purpose, current, "CANNOT_TELL", `not a public http(s) URL: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
      const permission = await permissionFor(url);
      if (permission.verdict === "DISALLOWED" || permission.verdict === "CANNOT_TELL" || permission.verdict === "RECORDED_WALL") {
        skipped(purpose, url.toString(), permission.verdict, `not requested: permission ${permission.verdict} (${permission.detail})`);
        return null;
      }
      if (requests >= maxRequests) {
        skipped(purpose, url.toString(), permission.verdict, `not requested: the walk reached its ${maxRequests}-request bound`);
        return null;
      }
      const got = await hop(url, accept);
      if (got.status !== null && got.status >= 300 && got.status < 400 && got.location !== null) {
        steps.push({
          purpose, url: url.toString(), permission: permission.verdict, status: got.status, transportError: null, bytes: got.bytes,
          artifactId: null, rung: 2, note: `redirected to ${got.location}`,
        });
        current = new URL(got.location, url).toString();
        continue;
      }
      const ok = got.status !== null && got.status >= 200 && got.status < 300 && got.transportError === null;
      const artifactId = ok ? await vaultBody(url.toString(), got.status!, got.contentType, got.body, permission.verdict) : null;
      steps.push({
        purpose, url: url.toString(), permission: permission.verdict, status: got.status, transportError: got.transportError, bytes: got.bytes,
        artifactId, rung: 2, note: ok ? `read ${got.bytes} bytes` : got.transportError !== null ? `transport failure: ${got.transportError}` : `HTTP ${got.status ?? "none"}`,
      });
      return ok ? { finalUrl: url.toString(), status: got.status!, body: got.body, contentType: got.contentType, artifactId } : null;
    }
    skipped(purpose, current, "ALLOWED", `not requested: more than ${MAX_REDIRECT_HOPS} redirects`);
    return null;
  }

  let candidates: readonly EndpointCandidate[] = [];
  let proposals: readonly RecipeCandidate[] = [];
  let homeOrigin: string | null = null;
  let homeHtml: string | null = null;
  const recipeSkips: { recipeId: string; why: string }[] = [];
  const origins = siteOrigins(need.ownWebAddress);
  /*
   * The body an official page is verified for. Its official host is the homepage's final host, which the walk
   * attested (the recorded address, or a host that address's own redirect named); before any homepage is read,
   * the recorded address itself.
   */
  const pageIdentity = (pageLabel: string | null): OfficialPageIdentity => ({
    bodyId: need.jurisdictionId,
    name: need.name,
    pageLabel,
    officialHost: new URL(homeOrigin ?? origins[0] ?? "https://invalid.invalid").host,
    stateCode: need.stateCode,
    now: runtime.now(),
  });
  const found: DiscoveryFind[] = [];
  const leads: Omit<DiscoveryFind, "count" | "artifactId">[] = [];
  const recipeApplied: MeetingsDiscoveryAttempt["recipes"]["applied"][number][] = [];
  const planned: { candidate: EndpointCandidate; recipeIds: string[]; label: string | null }[] = [];
  const queryTrail: MeetingsDiscoveryAttempt["search"][number][] = [];
  const learned: MeetingsRecipe[] = [];
  let checked = 0;
  try {
    /* 1–2. The homepage, on each recorded origin in turn, until one is read. */
    for (const origin of origins) {
      const home = await get(`${origin}/`, "homepage", ACCEPT_PAGE);
      if (home !== null) {
        homeOrigin = new URL(home.finalUrl).origin;
        homeHtml = home.body;
        candidates = meetingEndpointCandidates(home.body, home.finalUrl);
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

    /*
     * 3. The verifiable routes, confirmed by content: the page's own evidence
     * first, then the saved methods. A saved method that proposes a route the page
     * already links is credited with that route's outcome.
     */
    for (const candidate of candidates.filter((c) => c.verifiable)) planned.push({ candidate, recipeIds: [], label: null });
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
      });
    }
    for (const { candidate, recipeIds, label } of planned.slice(0, MAX_ENDPOINTS_PER_WALK)) {
      const got = await get(candidate.url, "endpoint", ACCEPT_PAGE);
      checked += 1;
      const check = got === null
        ? { verdict: "NOT_CONFIRMED" as const, count: null, detail: "the route could not be read this walk" }
        : verifyEndpointBody(candidate, { status: got.status, body: got.body, finalUrl: got.finalUrl }, pageIdentity(label));
      const base = { vendor: candidate.vendor, url: candidate.url, basis: candidate.basis, evidence: candidate.evidence, detail: check.detail };
      if (check.verdict === "YIELDED") found.push({ ...base, count: check.count, artifactId: got?.artifactId ?? null });
      else if (candidate.basis !== "RECIPE") leads.push(base);
      for (const recipeId of recipeIds) {
        recipeApplied.push({ recipeId, url: candidate.url, verdict: got === null ? "NOT_READ" : check.verdict, detail: check.detail });
      }
    }

    /*
     * 4. Search, only when nothing was confirmed and a search seam exists: the
     * saved methods' queries first, then the defaults. A result is a pointer: it
     * is followed only on the government's own domain or a known publisher host,
     * opened robots-first, and confirmed by content. Every request is charged.
     */
    if (found.length === 0 && runtime.search !== undefined && origins.length > 0) {
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
            host: r.host, usd: r.usd, bytes: r.bytes, recordedAt: runtime.now(),
          }));
        }
        /* Recorded before its results are followed, so a query the time cuts off still reports what it cost. */
        const followed: string[] = [];
        queryTrail.push({
          templateId: q.templateId, recipeId: q.recipeId, query: q.query, ownSiteOnly: q.ownSiteOnly,
          requests: requests.map(({ bytes: _bytes, ...rest }) => rest), followed,
        });
        for (const hit of res.hits) {
          if (found.length > 0 || followed.length >= MAX_HITS_FOLLOWED_PER_QUERY) break;
          if (hitStanding(hit.url, identity.domain) === null || tried.has(hit.url)) continue;
          tried.add(hit.url);
          const page = await get(hit.url, "endpoint", ACCEPT_PAGE);
          /* Listed once asked for: a result the time cut off before its request is not "followed". */
          followed.push(hit.url);
          if (page === null) continue;
          /* The result may itself be a route; otherwise it is read as a page for the routes it evidences. */
          const direct = meetingEndpointCandidates(`<a href="${hit.url.replace(/"/g, "%22")}"></a>`, page.finalUrl).filter((c) => c.verifiable);
          const onPage = meetingEndpointCandidates(page.body, page.finalUrl).filter((c) => c.verifiable && !tried.has(c.url));
          /* A result on the government's own domain may itself be the page that dates its sessions: checked from the body already read. */
          const selfPage = hitStanding(hit.url, identity.domain) === "OWN_SITE"
            ? [{ vendor: "official-page-events", url: hit.url, basis: "SEARCH" as const, evidence: hit.url, verifiable: true }]
            : [];
          for (const c of [...direct, ...selfPage, ...onPage].slice(0, 3)) {
            const body = c.url === hit.url ? page : (tried.add(c.url), await get(c.url, "endpoint", ACCEPT_PAGE));
            if (body === null) continue;
            const check = verifyEndpointBody(c, { status: body.status, body: body.body, finalUrl: body.finalUrl }, pageIdentity(null));
            const base = { vendor: c.vendor, url: c.url, basis: "SEARCH" as const, evidence: `search "${q.query}" found ${hit.url}`, detail: check.detail };
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
    /*
     * The routes the page evidenced but the walk did not reach are leads that say
     * so. A saved method not reached is neither credited nor charged: the time ran
     * out, not the method.
     */
    for (const { candidate } of planned.slice(checked, MAX_ENDPOINTS_PER_WALK)) {
      if (candidate.basis === "RECIPE") continue;
      leads.push({ vendor: candidate.vendor, url: candidate.url, basis: candidate.basis, evidence: candidate.evidence, detail: "not checked: the cycle's discovery time ran out first" });
    }
  }
  for (const candidate of candidates.filter((c) => !c.verifiable).slice(0, 8)) {
    leads.push({ vendor: candidate.vendor, url: candidate.url, basis: candidate.basis, evidence: candidate.evidence, detail: "recognised but not readable by any content check yet" });
  }

  const finishedAt = runtime.now();
  const outcome: DiscoveryOutcome = origins.length === 0 ? "COULD_NOT_READ" : decideOutcome({ found, leads, steps });
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
    recheckAfter: recheckAfter(outcome, finishedAt),
    note: noteFor(need, outcome, found, leads, origins.length),
  };
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
      return `${who}: permission refused every origin, so nothing was requested. Not an absence; a wall, recorded.`;
    default:
      return origins === 0
        ? `${who}: no usable website is recorded, so there was nothing to walk.`
        : `${who}: the site could not be read this walk (a transport failure, a server error, or permission rules that could not be read). Not a wall; due again at the recheck date.`;
  }
}

/* ---------------------------------------------------------------- the pass */

export interface MeetingsDiscoveryPass {
  readonly walked: readonly MeetingsDiscoveryAttempt[];
  /** Needs selected this cycle whose latest walk is not yet due again. */
  readonly notDue: readonly string[];
  /** Needs selected but not walked because the budget was spent. Walked in a later cycle. */
  readonly deferred: readonly string[];
  /**
   * Walks the time ran out on before they confirmed anything. Nothing was
   * recorded as a reading; each is also in `deferred`, and its need stays due.
   */
  readonly cutShort: readonly {
    readonly jurisdictionId: string;
    readonly requests: number;
    /** The search queries it had sent, with their charged requests. */
    readonly search: MeetingsDiscoveryAttempt["search"];
  }[];
  readonly appendFailures: readonly { readonly jurisdictionId: string; readonly why: string }[];
  /** Saved methods whose counts this pass moved, and how many applications it made. */
  readonly recipesUpdated: readonly string[];
  readonly recipeApplications: number;
  readonly fieldManual: { readonly written: number; readonly error?: string };
}

/**
 * Which needs this cycle looks at: a stateless rotation over the needs sorted
 * by id, starting at an offset the cycle's hour fixes, so every need comes
 * round in turn without any stored cursor. A need whose latest walk is not yet
 * due is passed over, and the rotation looks further, up to three times the
 * cycle's allowance.
 */
export function rotationWindow<T extends { readonly jurisdictionId: string }>(
  needs: readonly T[],
  cycleIndex: number,
  size: number,
): readonly T[] {
  if (needs.length === 0 || size <= 0) return [];
  const sorted = [...needs].sort((a, b) => (a.jurisdictionId < b.jurisdictionId ? -1 : a.jurisdictionId > b.jurisdictionId ? 1 : 0));
  const span = Math.min(sorted.length, size * 3);
  const start = ((cycleIndex * size) % sorted.length + sorted.length) % sorted.length;
  return Array.from({ length: span }, (_, i) => sorted[(start + i) % sorted.length]);
}

/** The field-manual entries a walk teaches: confirmed routes, leads, and dead doors. */
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
    outcome,
    url,
    source: "cp_log_discovery_attempts",
    observedAt: attempt.finishedAt,
    tier: "B",
    payload,
  });
  const entries: FieldManualEntry[] = [];
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
    /* What refused each origin: its rules or a recorded wall (the step's permission), or its own 401, 403 or 429 to this client. */
    const walls = attempt.steps.filter((s) =>
      s.purpose === "homepage" && (s.status === null ? s.permission !== "ALLOWED" && s.permission !== "NO_ROBOTS" : [401, 403, 429].includes(s.status)));
    const why = [...new Set(walls.map((s) => (s.status === null ? s.permission : `HTTP ${s.status}`)))].join(", ");
    entries.push(entry("DEAD_DOOR", "BLOCKED", "own-site", walls[0]?.url ?? attempt.ownWebAddress,
      `${attempt.jurisdictionId}: the site's own origins refused this client (${why}).`,
      { attemptId: attempt.attemptId, steps: walls }));
  }
  return entries;
}

/**
 * Walk the cycle's window of needs within the budget, append every walk, and
 * write what they taught to the field manual. Never throws for a site; an
 * append that fails is named, and the walk's evidence stays in the vault.
 */
export async function runMeetingsDiscovery(
  repos: Pick<ControlPlaneRepositories, "discoveryAttempts" | "fieldManual">,
  input: {
    readonly needs: readonly MeetingsDiscoveryNeed[];
    readonly runtime: DiscoveryRuntime;
    readonly cycleIndex: number;
    readonly maxWalks: number;
    /** Jurisdictions an owner dispatch materialized: walked before the rotation, in dispatch priority. */
    readonly firstIds?: ReadonlySet<string>;
    /** Jurisdictions another executor is working now (an open occurrence): never walked by this one too. */
    readonly skipIds?: ReadonlySet<string>;
  },
): Promise<MeetingsDiscoveryPass> {
  const skip = input.skipIds ?? new Set<string>();
  const walkable = input.needs.filter(
    (n) => n.basis === "SOURCE_DISCOVERY_OWED" && siteOrigins(n.ownWebAddress).length > 0 && !skip.has(n.jurisdictionId),
  );
  const first = walkable.filter((n) => input.firstIds?.has(n.jurisdictionId) === true);
  const rotation = rotationWindow(walkable.filter((n) => input.firstIds?.has(n.jurisdictionId) !== true), input.cycleIndex, input.maxWalks);
  const window = [...first, ...rotation];
  const walked: MeetingsDiscoveryAttempt[] = [];
  const notDue: string[] = [];
  const deferred: string[] = [];
  const cutShort: { jurisdictionId: string; requests: number; search: MeetingsDiscoveryAttempt["search"] }[] = [];
  const appendFailures: { jurisdictionId: string; why: string }[] = [];
  const nowMs = Date.parse(input.runtime.now());

  for (const need of window) {
    if (walked.length >= input.maxWalks) break;
    const [latest] = await repos.discoveryAttempts.readRecent(need.jurisdictionId, 1);
    if (latest !== undefined && Date.parse(latest.recheckAfter) > nowMs) {
      notDue.push(need.jurisdictionId);
      continue;
    }
    if (input.runtime.budget.spent()) {
      deferred.push(need.jurisdictionId);
      continue;
    }
    let attempt: MeetingsDiscoveryAttempt;
    try {
      attempt = await walkMeetingsDiscoveryNeed(need, input.runtime);
    } catch (error) {
      if (!(error instanceof DiscoveryTimeSpent)) throw error;
      deferred.push(need.jurisdictionId);
      cutShort.push({ jurisdictionId: need.jurisdictionId, requests: error.requestCount, search: error.search });
      continue;
    }
    walked.push(attempt);
    try {
      await repos.discoveryAttempts.append(need.jurisdictionId, attempt.attemptId, attempt, attempt.finishedAt);
    } catch (error) {
      appendFailures.push({ jurisdictionId: need.jurisdictionId, why: error instanceof Error ? error.message : String(error) });
    }
  }

  /*
   * Write back every saved method's outcome, success and failure alike, so the
   * next cycle ranks by what worked and does not pay again for a failure that
   * still stands (lib/hunt/meetings-recipes.ts).
   */
  const recipesById = new Map((input.runtime.recipes ?? []).map((r) => [r.recipeId, r] as const));
  const touched = new Set<string>();
  let recipeApplications = 0;
  for (const attempt of walked) {
    /* A method a search success taught: added, or credited when it is already known. */
    for (const fresh of attempt.recipes.learned) {
      const known = recipesById.get(fresh.recipeId) ?? fresh;
      const note = { at: attempt.finishedAt, jurisdictionId: attempt.jurisdictionId, url: attempt.found[0]?.url ?? "", conditions: `walk ${attempt.attemptId}: found by search` };
      recipesById.set(fresh.recipeId, recordRecipeOutcome(known, { succeeded: true, note }));
      touched.add(fresh.recipeId);
    }
    for (const a of attempt.recipes.applied) {
      const recipe = recipesById.get(a.recipeId);
      if (recipe === undefined) continue;
      recipeApplications += 1;
      const note = { at: attempt.finishedAt, jurisdictionId: attempt.jurisdictionId, url: a.url, conditions: `walk ${attempt.attemptId}: ${a.detail}` };
      recipesById.set(
        a.recipeId,
        a.verdict === "YIELDED"
          ? recordRecipeOutcome(recipe, { succeeded: true, note })
          : recordRecipeOutcome(recipe, {
              succeeded: false,
              note: {
                ...note,
                limit: a.verdict === "NOT_READ"
                  ? "the route was not read: permission, a wall, or transport"
                  : a.verdict === "EMPTY" ? "the route answered but held no meetings" : `content check: ${a.detail}`,
              },
            }),
      );
      touched.add(a.recipeId);
    }
  }
  const recipeEntries = [...touched].map((id) => recipeEntry(recipesById.get(id)!, input.runtime.now()));
  const fieldManual = await writeFieldManualDiscoveries(
    repos,
    [...walked.flatMap(discoveryFieldManualEntries), ...recipeEntries],
    input.runtime.now(),
  );
  return { walked, notDue, deferred, cutShort, appendFailures, recipesUpdated: [...touched], recipeApplications, fieldManual };
}
