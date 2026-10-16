import { readGenericBallotProjection, type GenericBallotProjection } from "../../../ballot/generic-projection.ts";
/**
 * Candidate enrichment fields (campaign site, positions, bios, photos, contact) as standing obligations against
 * each tracked state's canonical promoted ballot projection, so the work is owed before a reader arrives. Every
 * route is its own scheduled unit, walls are registered so they are re-walked, nothing is registered for a
 * field already held, and positions come only from the candidate's own site.
 */

import { currentExtraction, type CandidateCorpus } from "../../../candidates/corpus.ts";
import {
  ENRICHMENT_FIELDS,
  deriveCandidateUniverse,
  type BallotDocument,
  type CandidateUniverse,
  type CanonicalCandidacy,
  type EnrichmentStores,
  type EnrichmentField,
} from "../../../hunt/candidate-universe.ts";
import type { BallotSet } from "../../../ballot/types.ts";
import type {
  AzBallotProjection,
  CandidateProfilesProjection,
  NhBallotProjection,
} from "../../../civic-data/manual-projections.ts";
import { requiredManualProductionContract } from "../../../civic-data/manual-contracts.ts";
import { requiredRoutineContract } from "../../../civic-data/contracts.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../../../civic-data/read-model.ts";
import { readDerivedCampaignSites, composeCampaignLinks } from "../../../civic-data/derived-campaign-sites.ts";
import type { NjMorrisReadModel } from "../../../sources/ballot-nj-morris/index.ts";
import type {
  ObligationProvider,
  ProvidedObligation,
  ProviderContext,
  ProviderYield,
  RouteDescriptor,
} from "../registry.ts";
import { trackedStatesFromOperationalReference, type TrackedStatesSource } from "../provider-inputs.ts";

export const CANDIDATE_ENRICHMENT_PROVIDER_ID = "candidate-enrichment";

/** The states whose canonical candidate ballot authority is registered in the civic-data contracts. A tracked state outside this list is named as a dataset gap every cycle. */
const LEGACY_BALLOT_AUTHORITY_STATES = ["az", "nh", "nj"] as const;
/** Legacy path retained until the generic authority is checked live. */
export const BALLOT_AUTHORITY_STATES = LEGACY_BALLOT_AUTHORITY_STATES;
type BallotAuthorityState = (typeof BALLOT_AUTHORITY_STATES)[number];
const hasBallotAuthority = (state: string): state is BallotAuthorityState =>
  (BALLOT_AUTHORITY_STATES as readonly string[]).includes(state);
export const CYCLE = 2026;

/** Identification headers: a person and a purpose, never a credential. */
function identifiedHeaders(): Record<string, string> {
  const from = process.env.INGEST_CONTACT_EMAIL;
  return {
    "user-agent": "we-the-people/1.0 (civic data for a public-records product)",
    "x-purpose": "civic candidate record index for a public-records product",
    ...(from ? { from } : {}),
  };
}

/** The identified User-Agent with a contact that the Wikimedia API policy requires (a generic one is throttled). */
function wikimediaHeaders(): Record<string, string> {
  const from = process.env.INGEST_CONTACT_EMAIL;
  const agent =
    "we-the-people-civic/1.0 (https://github.com/SeanJ22/meanwhile; civic public-records product; contact via repository)";
  return {
    "user-agent": agent,
    "api-user-agent": agent,
    "x-purpose": "civic candidate record discovery for a public-records product",
    accept: "application/json",
    ...(from ? { from } : {}),
  };
}

function displayName(c: CanonicalCandidacy): string {
  return `${c.givenName} ${c.familyName}`.replace(/\s+/g, " ").trim();
}

/** The query the visible-candidate hunt used: the person AND the office. */
function query(c: CanonicalCandidacy): string {
  return `${displayName(c)} ${c.officeTitle} ${c.stateCode}`;
}

function siteRoute(c: CanonicalCandidacy, url: string): RouteDescriptor {
  return {
    routeId: "candidate-site-recorded",
    label: `${displayName(c)} — the campaign site already recorded, re-walked`,
    executorClass: "DETERMINISTIC",
    executorReason:
      "the address is held, so opening it is a replay. Spending a model to re-find a URL we already " +
      "wrote down is spending tokens on a known answer",
    open: { kind: "HTTP_GET", url, headers: identifiedHeaders() },
    citation:
      "canonical CANDIDATE_PROFILE promotion receipt — the recorded campaign site for this exact candidacy",
  };
}

/**
 * Wikipedia via the Wikimedia REST API (`api.wikimedia.org`, robots-permitted), a discovery route only: a
 * result may point at a candidate's own page, and the record is proved at the origin. A 429 is a wall and
 * disposes BLOCKED_CURRENTLY.
 */
export function wikipediaRoute(c: CanonicalCandidacy): RouteDescriptor {
  return {
    routeId: "candidate-wikipedia-api",
    label: `${displayName(c)} — Wikipedia via the Wikimedia REST search API, DISCOVERY ONLY`,
    executorClass: "DETERMINISTIC",
    executorReason:
      "the Wikimedia REST search API is a documented public endpoint built for automated access; " +
      "replaying a search with a fixed shape is deterministic and spends no model",
    open: {
      kind: "HTTP_GET",
      url: `https://api.wikimedia.org/core/v1/wikipedia/en/search/page?q=${encodeURIComponent(query(c))}&limit=5`,
      headers: wikimediaHeaders(),
    },
    yieldContract: {
      describe: "a Wikimedia REST search response carrying a pages array",
      requireAll: ["pages"],
      rowsAt: "pages",
      zeroRowsIsMiss: true,
    },
    citation:
      "api.wikimedia.org/core/v1/wikipedia/en/search/page, permission read + walked 2026-09-17: " +
      "api.wikimedia.org/robots.txt permits /core/v1/ (no matching Disallow for `User-agent: *`), and " +
      "the endpoint answered HTTP 200 application/json with a populated `pages` array to the identified " +
      "User-Agent. The en.wikipedia.org search API path stays robots-Disallowed and unused " +
      "(WIKI_API_DISALLOWED; tests/wikipedia-permission.test.ts); this is Wikimedia's published " +
      "automated door on a separate host. CC BY-SA — facts are not copyrightable, and this " +
      "route is DISCOVERY ONLY: it points at a page and is never a source of record. Wikimedia 2026 API " +
      "policy honoured: descriptive User-Agent with contact (generic UAs are throttled to the lowest " +
      "tier), per-host spacing under the 3-request guideline, and a 429 backs off via WALL_STATUSES.",
  };
}

function marginaliaRoute(c: CanonicalCandidacy): RouteDescriptor {
  return {
    routeId: "candidate-marginalia-index",
    label: `${displayName(c)} — Marginalia keyword index, DISCOVERY ONLY`,
    executorClass: "DETERMINISTIC",
    executorReason: "a documented public endpoint with a measured control; replaying it needs no model",
    open: {
      kind: "HTTP_GET",
      url: `https://api.marginalia.nu/public/search/${encodeURIComponent(query(c))}`,
      headers: identifiedHeaders(),
    },
    yieldContract: {
      describe: "a Marginalia response carrying its licence declaration and a results array",
      requireAll: ["license", "results"],
      rowsAt: "results",
      zeroRowsIsMiss: true,
    },
    citation:
      "source registry — api.marginalia.nu/public/search, walked 2026-08-24, control: an impossible " +
      "term returns a `license` field and an empty `results` array. CC-BY-NC-SA 4.0 — DISCOVERY ONLY, " +
      "so it may point at a URL and may never be a source of record here. PERMISSION RE-READ " +
      "2026-09-01 BEFORE THIS ROUTE WAS REGISTERED: `https://marginalia.nu/robots.txt` answers 301 " +
      "then HTTP 404 — the publisher serves NO robots document, which is an absence of restrictions " +
      "and never a grant. `https://api.marginalia.nu/robots.txt` answers HTTP 401 to a bare client " +
      "and to an identified one alike, which is a TRANSPORT answer and not a permission verdict " +
      "(CANNOT_TELL). The endpoint itself answered HTTP 200 with a `license` field and a " +
      "populated `results` array on the same date, and that licence is the publisher's own statement " +
      "of the terms it is served under.",
  };
}

/** The general-index wall, registered as NOT_MACHINE_EXECUTABLE so it is re-walked rather than forgotten. */
function generalIndexWall(stateCode: string): RouteDescriptor {
  return {
    routeId: "candidate-web-index-4get",
    label: `${stateCode.toUpperCase()} — general web index (4get.ca), recorded as a WALL`,
    executorClass: "BOUNDED_MODEL_WORKER",
    executorReason:
      "there is nothing graduated to replay: the route answers and returns nothing. Establishing " +
      "whether that changed is an observation, not a fetch with a fixed shape",
    open: {
      kind: "NOT_MACHINE_EXECUTABLE",
      target: "https://4get.ca/web",
      reason:
        "GENERAL WEB SEARCH IS A WALL FOR THIS PROJECT, dated 2026-08-26. `4get.ca` is the only " +
        "general index whose robots.txt permits the query path — an empty `Disallow:` — and rung 2 " +
        "answers HTTP 200 with a page that is INTERFACE ONLY: 7,154 B against a 7,274 B control, with " +
        "ZERO result links. The 2026-08-25 reading that recorded it working counted eight ECHOES of " +
        "the query in the page's own furniture. Mojeek, Brave and Ecosia carry `Disallow: /search` and " +
        "are DISALLOWED, which is a different fact and is never re-walked on a clock. This row is the " +
        "WALL, and its dated reading expires and sends a session back to it.",
    },
    citation: "source registry — the search pool, re-measured 2026-08-26",
  };
}

/** The whole portfolio for one candidacy, given the fields it still owes. Positions and bios come only from the candidate's own statement, so with no site held they are blocked on the campaign-site question. */
function routesForCandidacy(
  c: CanonicalCandidacy,
  owed: readonly EnrichmentField[],
): RouteDescriptor[] {
  const site = c.enrichment.campaignSite.sourceUrl;
  const owedList = owed.join(", ");
  const out: RouteDescriptor[] = [];

  if (site) {
    const r = siteRoute(c, site);
    out.push({ ...r, label: `${r.label} — owed: ${owedList}` });
  }

  const needsDiscovery = owed.some((f) => f === "campaignSite" || f === "photo" || f === "contact");
  if (needsDiscovery || !site) {
    const w = wikipediaRoute(c);
    const m = marginaliaRoute(c);
    out.push(
      { ...w, label: `${w.label} — owed: ${owedList}` },
      { ...m, label: `${m.label} — owed: ${owedList}` },
    );
  }

  const authoredOwed = owed.filter((f) => f === "positions" || f === "bio");
  if (authoredOwed.length > 0 && !site) {
    out.push({
      routeId: "candidate-authored-awaits-site",
      label: `${displayName(c)} — ${authoredOwed.join(" and ")} await this candidate's own publication`,
      executorClass: "BOUNDED_MODEL_WORKER",
      executorReason:
        "no deterministic client applies: the only permitted source for these fields is the " +
        "candidate's own publication, and we do not hold its address",
      open: {
        kind: "NOT_MACHINE_EXECUTABLE",
        target: `${displayName(c)} — the candidate's own publication`,
        reason:
          `${authoredOwed.join(" and ").toUpperCase()} IS ONLY EVER TAKEN FROM THE CANDIDATE'S OWN ` +
          "STATEMENT. Every position rendered to a reader carries a source record pointing " +
          "at a specific statement by that candidate, and a general index may point at a page but may " +
          "never be the page. This is BLOCKED ON the campaign-site routes on this same record, which " +
          "is a named dependency and is never an absence about this person.",
      },
      citation: "CLAUDE.md — never generate a candidate position",
    });
  }

  return out;
}

export interface CandidateEnrichmentAuthorities {
  readonly az: AzBallotProjection;
  readonly nh: NhBallotProjection;
  readonly nj: NjMorrisReadModel;
  readonly profiles: CandidateProfilesProjection;
  readonly corpus: CandidateCorpus;
}

export interface CandidateEnrichmentAuthorityHoldings {
  readonly az: AzBallotProjection | null;
  readonly nh: NhBallotProjection | null;
  readonly nj: NjMorrisReadModel | null;
  readonly profiles: CandidateProfilesProjection | null;
  readonly corpus: CandidateCorpus | null;
  readonly failures: readonly string[];
  readonly general?: GenericBallotProjection | null;
}

let loadedAuthorities: CandidateEnrichmentAuthorityHoldings | null = null;
const AZ_BALLOT = requiredManualProductionContract("az-sos-ballot");
const NH_BALLOT = requiredManualProductionContract("nh-curated-ballot");
const PROFILES = requiredManualProductionContract("candidate-profiles");
const PUBLICATIONS = requiredManualProductionContract("candidate-corpus");
const NJ_BALLOT = requiredRoutineContract("nj-morris-filing");

function requiredValue<T>(
  result: { readonly kind: string; readonly value: T | null },
  name: string,
): T {
  if (result.kind === "PROMOTED" && result.value !== null) {
    return result.value;
  }
  throw new Error(`${name} canonical projection is ${result.kind}.`);
}

/**
 * Load every authority before the synchronous obligation registry is built.
 * This standing path deliberately bypasses every bundled first-seed helper:
 * only proof-validated promoted pointers may create a production clock.
 */
export async function preloadCandidateEnrichmentAuthorities(
  options: PromotedCivicDataReadOptions = {},
): Promise<void> {
  const results = await Promise.allSettled([
    readPromotedCivicData<AzBallotProjection>(AZ_BALLOT.recordClass, AZ_BALLOT.scope, options),
    readPromotedCivicData<NhBallotProjection>(NH_BALLOT.recordClass, NH_BALLOT.scope, options),
    readPromotedCivicData<NjMorrisReadModel>(NJ_BALLOT.recordClass, NJ_BALLOT.scope, options),
    readPromotedCivicData<CandidateProfilesProjection>(PROFILES.recordClass, PROFILES.scope, options),
    readPromotedCivicData<CandidateCorpus>(PUBLICATIONS.recordClass, PUBLICATIONS.scope, options),
    readDerivedCampaignSites(options),
    readGenericBallotProjection(options),
  ]);
  const failures: string[] = [];
  const held = <T>(result: PromiseSettledResult<{ readonly kind: string; readonly value: T | null }>, name: string): T | null => {
    if (result.status === "rejected") {
      failures.push(`${name} canonical projection read rejected (${result.reason instanceof Error ? result.reason.message : String(result.reason)}).`);
      return null;
    }
    try { return requiredValue(result.value, name); }
    catch (error) {
      failures.push(error instanceof Error ? error.message : `${name} canonical projection is unavailable.`);
      return null;
    }
  };
  loadedAuthorities = {
    az: held(results[0]!, "Arizona ballot"),
    nh: held(results[1]!, "New Hampshire ballot"),
    nj: held(results[2]!, "New Jersey ballot"),
    profiles: held(results[3]!, "Candidate profile"),
    corpus: held(results[4]!, "Candidate publication"),
    failures,
    general: results[6]?.status === "fulfilled" && results[6].value.kind === "PROMOTED" ? results[6].value.value : null,
  };
  const general = results[6];
  if (general?.status === "rejected" || general?.status === "fulfilled" && general.value.kind === "STORE_UNREACHABLE") {
    failures.push("General ballot records could not be read; retained legacy authorities remain usable.");
  }
  // The worker inherits the same delivered links and page text the Reader sees.
  const derived = results[5];
  if (derived.status === "fulfilled" && derived.value.kind === "PROMOTED") {
    const records = derived.value.value.records;
    const profiles = loadedAuthorities.profiles;
    const corpus = loadedAuthorities.corpus;
    const documents = new Map(corpus?.documents.map(document => [document.id, document]) ?? []);
    for (const record of records) for (const { document } of record.publications ?? []) {
      if (!documents.has(document.id)) documents.set(document.id, document);
    }
    loadedAuthorities = { ...loadedAuthorities,
      profiles: profiles ? { ...profiles, links: { ...profiles.links, links: composeCampaignLinks(profiles.links.links, records).links } } : null,
      corpus: corpus ? { ...corpus, documents: [...documents.values()], attempted: Math.max(corpus.attempted,
        new Set([...documents.values()].map(document => document.candidateKey).concat(corpus.failures.map(failure => failure.candidateKey))).size) } : null };
  } else if (derived.status === "rejected" || derived.value.kind !== "NOT_RECORDED") {
    // Keep usable prior holdings; failed reconciliation cannot mean no sites.
    failures.push("Automatically published candidate evidence is unavailable; retained profile/corpus evidence remains usable and reconciliation is still owed.");
  }
}

/**
 * The authorities this process preloaded, or null before the preload ran. The
 * standing runner's campaign-site pass joins its leads to the same canonical
 * candidacies this provider enumerates, from the same promoted pointers.
 */
export function candidateEnrichmentHoldings(): CandidateEnrichmentAuthorityHoldings | null {
  return loadedAuthorities;
}

function ballotDocument(path: string, ballot: BallotSet): BallotDocument {
  return { path, contests: ballot.contests, candidacies: ballot.candidacies };
}

function profileStores(
  profiles: CandidateProfilesProjection,
  corpus: CandidateCorpus,
): EnrichmentStores {
  const huntState: EnrichmentStores["huntState"] = {};
  for (const document of currentExtraction(corpus.documents)) {
    if (document.extraction !== "html" || !document.text) continue;
    huntState[document.candidateKey] = {
      ...(huntState[document.candidateKey] ?? {}),
      blurb: { state: "FOUND", checkedAt: document.retrievedAt },
    };
  }
  return {
    huntState,
    cards: profiles.cards.cards as unknown as Record<string, Record<string, unknown>>,
    links: Object.fromEntries(Object.entries(profiles.links.links).map(([key, links]) => [
      key,
      links.campaign?.url ?? null,
    ])),
    linkHunts: profiles.links.hunts,
  };
}

/** Pure derivation used by the provider. */
export function candidateUniversesFromPromoted(
  authorities: CandidateEnrichmentAuthorities,
  nowIso: string,
): Readonly<Record<BallotAuthorityState, CandidateUniverse>> {
  const stores = profileStores(authorities.profiles, authorities.corpus);
  const azDocuments: BallotDocument[] = [
    ballotDocument("civic-data:BALLOT_CANDIDACY:US-AZ:2026-general:supported-ballot", authorities.az.ballot),
  ];
  const filings = authorities.az.candidateFilings as Partial<BallotDocument> | null;
  if (filings && Array.isArray(filings.contests) && Array.isArray(filings.candidacies)) {
    azDocuments.push({
      path: "civic-data:BALLOT_CANDIDACY:US-AZ:2026-general:official-filing-corpus",
      contests: filings.contests,
      candidacies: filings.candidacies,
    });
  }
  const derive = (stateCode: "az" | "nh" | "nj", documents: readonly BallotDocument[]) =>
    deriveCandidateUniverse({
      stateCode: stateCode.toUpperCase(),
      cycle: CYCLE,
      generatedBy: "canonical civic-data ballot/profile projections",
      generatedOn: nowIso.slice(0, 10),
      documents,
      stores,
    });
  return {
    az: derive("az", azDocuments),
    nh: derive("nh", [ballotDocument("civic-data:BALLOT_CANDIDACY:US-NH:merrimack:2026-general", authorities.nh.ballot)]),
    nj: derive("nj", [ballotDocument("civic-data:BALLOT_FILING:US-NJ:morris:2026", authorities.nj.ballot)]),
  };
}

/** Derive one state's universe without acquiring either sibling ballot. */
export function candidateUniverseFromPromoted(
  stateCode: BallotAuthorityState,
  ballot: AzBallotProjection | NhBallotProjection | NjMorrisReadModel,
  profiles: CandidateProfilesProjection,
  corpus: CandidateCorpus,
  nowIso: string,
): CandidateUniverse {
  const stores = profileStores(profiles, corpus);
  const derive = (documents: readonly BallotDocument[]) => deriveCandidateUniverse({
    stateCode: stateCode.toUpperCase(),
    cycle: CYCLE,
    generatedBy: "canonical civic-data ballot/profile projections",
    generatedOn: nowIso.slice(0, 10),
    documents,
    stores,
  });
  if (stateCode === "az") {
    const authority = ballot as AzBallotProjection;
    const documents: BallotDocument[] = [
      ballotDocument("civic-data:BALLOT_CANDIDACY:US-AZ:2026-general:supported-ballot", authority.ballot),
    ];
    const filings = authority.candidateFilings as Partial<BallotDocument> | null;
    if (filings && Array.isArray(filings.contests) && Array.isArray(filings.candidacies)) {
      documents.push({ path: "civic-data:BALLOT_CANDIDACY:US-AZ:2026-general:official-filing-corpus", contests: filings.contests, candidacies: filings.candidacies });
    }
    return derive(documents);
  }
  if (stateCode === "nh") {
    return derive([ballotDocument("civic-data:BALLOT_CANDIDACY:US-NH:merrimack:2026-general", (ballot as NhBallotProjection).ballot)]);
  }
  return derive([ballotDocument("civic-data:BALLOT_FILING:US-NJ:morris:2026", (ballot as NjMorrisReadModel).ballot)]);
}

export function candidateEnrichmentUniversesFromHoldings(
  holdings: CandidateEnrichmentAuthorityHoldings,
  nowIso: string,
): { readonly universes: Record<string, CandidateUniverse>; readonly failures: string[] } {
  const universes: Record<string, CandidateUniverse> = {};
  const failures = [...holdings.failures];
  if (!holdings.profiles || !holdings.corpus) return { universes, failures };
  for (const stateCode of LEGACY_BALLOT_AUTHORITY_STATES) {
    const ballot = holdings[stateCode];
    if (!ballot) continue;
    try {
      universes[stateCode] = candidateUniverseFromPromoted(stateCode, ballot, holdings.profiles, holdings.corpus, nowIso);
    } catch (error) {
      failures.push(`${stateCode.toUpperCase()} candidate enrichment derivation failed (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  if (holdings.general) {
    const documents = new Map<string, BallotDocument[]>();
    for (const [key, ballot] of Object.entries(holdings.general.ballots)) {
      if (!ballot.candidacies.length) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ballot.election.date ?? "")) {
        failures.push(`${ballot.election.name}: the election year is not held, so candidate work cannot be placed in a cycle.`);
        continue;
      }
      if (Number(ballot.election.date.slice(0,4)) !== CYCLE) continue;
      const state = ballot.election.state.toLowerCase();
      documents.set(state,[...documents.get(state) ?? [],ballotDocument(`civic-data:BALLOT_CANDIDACY:general:${key}`,ballot)]);
    }
    for (const [state, held] of documents) {
      try {
        // Include a retained legacy projection only when it belongs to this
        // state's same existing cycle. The canonical derivation joins IDs.
        const legacy = hasBallotAuthority(state) ? holdings[state] : null;
        const legacyDocuments = legacy ? [ballotDocument(`civic-data:legacy-ballot:${state}`,legacy.ballot)] : [];
        if (state === "az" && holdings.az?.candidateFilings) {
          const filings = holdings.az.candidateFilings as Partial<BallotDocument>;
          if (Array.isArray(filings.contests) && Array.isArray(filings.candidacies)) legacyDocuments.push({path:"civic-data:legacy-ballot:az:filings",contests:filings.contests,candidacies:filings.candidacies});
        }
        universes[state] = deriveCandidateUniverse({stateCode:state.toUpperCase(),cycle:CYCLE,generatedBy:"canonical civic-data general ballot/profile projections",generatedOn:nowIso.slice(0,10),documents:[...held,...legacyDocuments],stores:profileStores(holdings.profiles,holdings.corpus)});
      } catch {
        failures.push(`${state.toUpperCase()} general candidate records could not be derived; retained legacy records remain usable.`);
      }
    }
  }
  return { universes, failures };
}

export interface CandidateEnrichmentInput {
  /** Which states' candidate universes are enumerated. The coverage set, read as data; never a list in code. */
  readonly trackedStates?: TrackedStatesSource;
}

export function candidateEnrichmentProvider(input: CandidateEnrichmentInput = {}): ObligationProvider {
  const trackedStates = input.trackedStates ?? trackedStatesFromOperationalReference();
  return {
    id: CANDIDATE_ENRICHMENT_PROVIDER_ID,
    describe:
      "campaign sites, candidate-authored positions, bios, photos and published contact as STANDING " +
      "obligations against each state's canonical promoted ballot/profile denominator — never a " +
      "tracked hunt artifact and never the ZIPs that happen to be enabled",

    /* Identity: `freshness:candidate-enrichment:<state>:<cycle>:<division>:<office>:<person>`, with no ZIP or county, so every place reaching this candidacy finds the same row. */
    scheduledId: (record, route) =>
      `freshness:candidate-enrichment:${record.subjectId}#${route.routeId}`,

    enumerate(ctx: ProviderContext): ProviderYield {
      const records: ProvidedObligation[] = [];
      const failures: string[] = [];

      const settled = loadedAuthorities
        ? candidateEnrichmentUniversesFromHoldings(loadedAuthorities, ctx.nowIso)
        : { universes: {}, failures: ["canonical ballot/profile projections were not preloaded"] };
      failures.push(...settled.failures);

      /* Tracked states, read as data. A tracked state with no registered ballot authority is named, never skipped. */
      const tracked = trackedStates.read();
      const enumerated: string[] = [];
      if ("unreadable" in tracked) {
        failures.push(`the tracked states could not be read from ${tracked.source} (${tracked.unreadable})`);
      } else {
        for (const stateCode of tracked.states) {
          if (settled.universes[stateCode.toLowerCase()] || hasBallotAuthority(stateCode)) enumerated.push(stateCode.toLowerCase());
          else {
            failures.push(
              `${stateCode.toUpperCase()} is tracked (${tracked.source}) and no canonical candidate ballot authority is registered ` +
                "for it in the civic-data contracts, so its candidate enrichment cannot be enumerated — a dataset gap, never an election with no candidates",
            );
          }
        }
      }

      for (const stateCode of enumerated) {
        const universe = settled.universes[stateCode] ?? null;
        if (universe === null) continue;
        if (universe.candidacies.length === 0) {
          failures.push(
            `${stateCode.toUpperCase()} canonical ballot/profile projection produced ZERO candidacies — a FAILED read, never an election with no candidates`,
          );
          continue;
        }

        /* The record is the candidate's public record; each route is scheduled once and the fields are what it is read for. */
        for (const c of universe.candidacies) {
          const owed = ENRICHMENT_FIELDS.filter((f) => c.enrichment[f].state !== "FOUND");
          if (owed.length === 0) continue;
          const routes = routesForCandidacy(c, owed);
          if (routes.length === 0) continue;
          records.push({
            recordClass: "candidate-enrichment",
            subjectId: c.id,
            scopeDivisions: [c.ocdId],
            /* Null on both signals: a missing campaign site costs a reader today, and no publication cycle is held. */
            readerImpactAt: null,
            observedChangeRateHours: null,
            lastWorkedAt: owed
              .map((f) => c.enrichment[f].checkedAt)
              .filter((d): d is string => d !== null)
              .sort()
              .pop() ?? null,
            routes,
          });
        }

        /* The wall is one record, not one per person. */
        records.push({
          recordClass: "candidate-enrichment",
          subjectId: `${stateCode}:${CYCLE}:general-web-index-availability`,
          readerImpactAt: null,
          observedChangeRateHours: null,
          lastWorkedAt: "2026-08-26",
          routes: [generalIndexWall(stateCode)],
        });
      }

      return {
        obligations: records,
        readFailure: failures.length === 0 ? null : failures.join("; "),
        emptyReason:
          records.length === 0 && failures.length === 0
            ? "every canonical candidate universe was read and every enrichment field on every " +
              "candidacy is already FOUND. That would be a real and remarkable result; treat a zero " +
              "here as a defect in this provider until the promoted ballot/profile projections are inspected."
            : null,
      };
    },
  };
}
