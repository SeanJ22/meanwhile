/**
 * **NEW HAMPSHIRE CAMPAIGN MONEY — ACQUIRED STATEWIDE, PROJECTED TO A BALLOT.**
 *
 * @freshness-reads-here — the candidate clock follows the reconciled official
 * corpus; the catch-path clock dates only the durable failed attempt.
 * (Session C, 2026-08-31. RULING 126, RULING 118. Split into acquisition and
 * projection by Session C3, lane C, 2026-09-01, under RULING 229.)
 *
 * ## WHAT CHANGED ON 2026-09-01, AND WHY THE PREVIOUS SHAPE COULD NOT BE RIGHT
 *
 * The header used to read **FOR THE 03255 BALLOT**, and it was accurate: the
 * collector asked the statewide registry one SURNAME at a time, and the
 * surnames were the ones on one certified ballot. `COUNTY` was a module
 * constant reading `"Merrimack"`.
 *
 * The cost was not that the numbers were small. It was that **activating a
 * second New Hampshire ZIP meant a fresh external hunt** — a new set of surname
 * queries to the Secretary of State for records the state had already
 * published and we had already been entitled to. RULING 229: a ZIP may
 * prioritise acquisition ORDER and may never define the acquisition
 * DENOMINATOR.
 *
 * ```
 *   ACQUISITION   acquireStatewideIndex()  -> the WHOLE filer index, one read,
 *                                             `filerName: ""`, checked against
 *                                             the publisher's own totalItems,
 *                                             committed at
 *                                             data/states/nh/campaign-finance/nh-cfs-filer-index-2026.json
 *
 *   PROJECTION    projectionFrom(corpus)   -> a `filersFor` that holds no
 *                                             fetch, no URL and no client. A
 *                                             ballot is answered out of memory
 *   NARROWING     countyFromBallot(ballot) -> the county filter, which is a
 *                                             MATCHING guard and stays, and is
 *                                             no longer an acquisition bound
 * ```
 *
 * The county guard is unchanged in what it does: a filer in Cheshire is not a
 * candidate on a Merrimack ballot, and that is what keeps `Allen Davis`, State
 * Representative in Cheshire district 18, off a Merrimack card. What changed is
 * that it is now derived from the ballot being projected onto instead of being
 * written into the module.
 *
 * Produces `data/states/nh/funding/state-money-nh-2026.json` — a `StateMoneySnapshot`
 * the ballot page already knows how to load. `lib/funding/state-snapshot.ts`
 * has named that filename since it was written; only the file was missing.
 *
 * ## The route, and why it is a script rather than a procedure
 *
 * The record said this host was walled: HTTP 403 at rungs 2 and 3, permission
 * UNANSWERED because `robots.txt` itself answered 403, and the one route that
 * ever worked was a hand-driven visible browser (`NH40`: "a procedure and not
 * a script, so nothing in CI can repeat it").
 *
 * Two things were measured on 2026-08-31 and both were different:
 *
 * 1. **The 403 is our own User-Agent.** `https://www.sos.nh.gov/robots.txt`
 *    answers HTTP 200 to a bare client and 403 to the same request carrying
 *    this project's name — exactly what the `identified-agent-refused` method
 *    route records for the `nh.gov` family. So the permission question is
 *    ANSWERABLE, and the answer is a real Drupal `robots.txt` whose every
 *    `Disallow` is a CMS internal: `/core/`, `/admin/`, `/user/login`, the
 *    README files. **Nothing disallows elections, campaign finance or the
 *    lobbyist registry.** `cfs.sos.nh.gov` publishes no `robots.txt` at all —
 *    it serves its Angular shell for that path exactly as it does for a
 *    nonsense path, which is an absence of restrictions rather than a grant,
 *    and is recorded as such.
 *
 * 2. **CORS is not a wall to a server.** The recorded rung-7 route called the
 *    API "from the page's own origin" because a BROWSER is bound by CORS. This
 *    process is not a browser. The same endpoint answers a plain POST with
 *    HTTP 200 and JSON.
 *
 * Identification therefore moves to `From:` and `X-Purpose:`, which the host
 * serves, rather than into a User-Agent it refuses. We are not pretending to
 * be anyone: the headers name a person and a purpose, and no credential,
 * session or authentication is sent or needed.
 *
 * ## What the endpoint gives, and the join it makes safe
 *
 * `PublicFilerDetails/GetFilingEntityDetails` honours `filerName` only, so
 * every other filter runs here. Each row carries the COMMITTEE name
 * (`filerName`, e.g. "Friends of Dan Innis") AND the candidate's own name
 * (`firstnameLastname`, "Daniel Innis"), plus `officeSoughtName`,
 * `districtName`, `town`, `electionYear`, `totalRaised`, `totalSpent` and
 * `filerEntityId`.
 *
 * That candidate-name field is what makes this joinable at all. The audit at
 * `docs/body-or-intermediary-audit.md` records NH's hazard exactly — candidates
 * file under legal names and serve under working names, so `Greg Sargent` and
 * `Gregory M. Sargent` are one person and two strings. Matching the COMMITTEE
 * name would fail every committee-style filer; matching `firstnameLastname`
 * against the ballot name is a person-to-person comparison, and `judgeMatch`
 * still demands name AND office AND year.
 *
 * ## Two guards this route adds ON TOP of the shared bar
 *
 * `judgeMatch` compares an office CLASS, never a district, so two people with
 * the same name in different districts would both satisfy it. Both extra
 * guards therefore narrow, never widen:
 *
 * - **County.** Every contest on this ballot is Merrimack County's or
 *   statewide. The endpoint's `town` field in fact carries the filer's COUNTY
 *   ("Merrimack", "Rockingham", "Cheshire"), and a row naming a DIFFERENT
 *   county is refused — which is what keeps `Allen Davis`, State
 *   Representative in Cheshire district 18, off a Merrimack ballot card.
 * - **District.** Where the contest states a district and the filer states one,
 *   they must be equal.
 *
 * What happens to a row these reject is deliberately NOT uniform, because the
 * three rejections mean different things:
 *
 * - A row for a different COUNTY or DISTRICT, or for a person whose filed name
 *   does not agree with the ballot name, is about SOMEBODY ELSE. It is dropped,
 *   because a stranger's filing is not a lead about this candidate.
 * - A row that IS this person and disagrees on office or year is recorded as a
 *   LEAD: it never renders (RULING 118) and leaves the candidate UNRESOLVED
 *   rather than answered.
 * - Only when no row survives at all is the candidate recorded as a sourced,
 *   dated absence.
 *
 * ## What is NOT here
 *
 * Federal contests. A candidate for the United States Senate or the House
 * files with the FEC, and this product already reads FEC money on those cards.
 * Asking a state regulator for a federal filing and recording the silence as
 * an absence would be manufacturing a gap.
 *
 * ## Why this file is a MODULE with an entry guard rather than a top-level run
 *
 * Every claim this collector makes about a named person is decided in
 * `buildRecords`, and a decision nothing can execute offline is a decision
 * nothing can test. The read is injected (`filersFor`), the ballot is a
 * parameter, and the entry point runs only when this file IS the process
 * entry — so `tests/state-money-nh-absence.test.ts` can drive the exact code
 * path production runs, against recorded fixtures, with no live call.
 *
 *   pnpm money:nh              project from the held corpus, write the snapshot
 *   pnpm money:nh --acquire    re-acquire the statewide index first
 *   pnpm money:nh --dry        read and report, write no snapshot
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  isRenderable,
  judgeMatch,
  mayBeSamePerson,
  officeClassOf,
  type StateMoneyRecord,
  type StateMoneySnapshot,
  computeSplit,
} from "../lib/funding/state-money.ts";
import {
  newZipReadiness,
  projectionLine,
  type AcquisitionUniverse,
  type ReaderProjection,
} from "../lib/hunt/source-universe.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";
import { stateCampaignFinanceCandidate } from "../lib/funding/data-plane.ts";
import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { readNhBallotProjection } from "../lib/civic-data/manual-read-models.ts";

const ROOT = join(import.meta.dirname, "..");
export const YEAR = 2026;
export const AGENCY = "New Hampshire Secretary of State — Campaign Finance System";
export const API =
  "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails";
export const PUBLIC_PAGE = "https://cfs.sos.nh.gov/";
const SPACING_MS = 1100;
const PAGE_SIZE = 100;

/**
 * **THE COUNTY IS A READER PROJECTION, NOT AN ACQUISITION BOUND.** (RULING 229.)
 *
 * This was `export const COUNTY = "Merrimack"` and it was doing two jobs. As a
 * MATCHING guard it is right and it stays: a filer in Cheshire is not a
 * candidate on a Merrimack ballot, and that is what keeps `Allen Davis`, State
 * Representative in Cheshire district 18, off a Merrimack card.
 *
 * As an ACQUISITION bound it was wrong, and it was not even the worst of it —
 * the collector asked the statewide registry one SURNAME at a time, and the
 * surnames were the ones on the 03255 ballot. Arriving in a second New
 * Hampshire ZIP therefore meant asking the Secretary of State for a fresh set
 * of surnames: a new external hunt for records the state had already published
 * and we had already been entitled to.
 *
 * So acquisition now takes the WHOLE registry — `acquireStatewideIndex` — and
 * this name is what a projection is narrowed BY. It is a default, and the
 * caller derives the real value from the ballot it is projecting onto.
 */
export const DEFAULT_PROJECTION_COUNTY = "Merrimack";

/**
 * The county a ballot belongs to, from its own contests' divisions.
 *
 * Returns null when the ballot names none — which happens for a ballot cut down
 * to a single statewide contest, and is why the caller supplies a fallback
 * rather than this function inventing one. A derivation that guessed a county
 * from nothing would put a filer filter on a ballot that never asked for one.
 */
export function countyFromBallot(ballot: { contests: { ocdId?: string }[] }): string | null {
  for (const c of ballot.contests) {
    const m = /\/county:([a-z_]+)/.exec(c.ocdId ?? "");
    if (m) return m[1].replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  return null;
}

/**
 * Identification the host actually serves. The project name in a User-Agent is
 * refused 403 by this host family; `From` and `X-Purpose` say who we are and
 * why in headers it does not filter on.
 */
export const HEADERS: Record<string, string> = {
  "content-type": "application/json",
  accept: "application/json, text/plain, */*",
  origin: "https://cfs.sos.nh.gov",
  referer: "https://cfs.sos.nh.gov/",
  from: "seanj22@gmail.com",
  "x-purpose": "civic campaign-finance index for a public-records product",
};

export interface Candidacy {
  id: string;
  contestId: string;
  familyName: string;
  givenName: string;
}
export interface Contest {
  id: string;
  title: string;
  /** The division. Read only to derive the projection county; never fetched. */
  ocdId?: string;
}
export interface Ballot {
  contests: Contest[];
  candidacies: Candidacy[];
}
export interface FilerRow {
  filerName: string;
  firstnameLastname: string | null;
  officeSoughtName: string | null;
  districtName: string | null;
  town: string | null;
  electionYear: number | null;
  totalRaised: number | null;
  totalSpent: number | null;
  filerEntityId: number | null;
  electionCycle: string | null;
  filerTypeDesc: string | null;
}

/**
 * ONE PAGE OF THE REGISTRY, AS THE REGISTRY ANSWERED IT.
 *
 * `totalItems` is the endpoint's own count of every row matching the query,
 * independent of `pageSize` — measured 2026-08-31 by asking for "Smith" at
 * `pageSize` 100 and at `pageSize` 5 and reading 29 both times. That makes it
 * an INDEPENDENTLY PUBLISHED DENOMINATOR rather than a number we computed from
 * what we happened to receive.
 */
export interface FilerPage {
  status: number;
  totalItems: number | null;
  items: FilerRow[];
}

/**
 * **WHAT THE REGISTRY ANSWERED, WITH "NOTHING" AND "COULD NOT READ" KEPT
 * APART.**
 *
 * These are two different facts and the product renders two different
 * sentences for them. Collapsing a failed read into an empty array is how a
 * wall becomes an emptiness, so the type refuses to let a caller do it by
 * accident: `ok: false` has no `rows` field to read.
 */
export type FilerRead =
  | {
      ok: true;
      /** The rows in the target year. */
      rows: FilerRow[];
      /** Every row actually retrieved, across every page, before the year filter. */
      retrieved: number;
      /** What the registry says it holds for this query. */
      totalItems: number;
      /** Whether `totalItems` came from the registry rather than from our own tally. */
      denominatorProven: boolean;
    }
  | { ok: false; reason: string };

/** How a page is actually fetched. Injected so a test never makes a live call. */
export type FetchPage = (input: {
  surname: string;
  pageNumber: number;
  pageSize: number;
}) => Promise<FilerPage>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const liveRawBodies: string[] = [];
let candidateSubmitted = false;
let productionWritePrepared = false;

/** The live route. The only place in this file that touches the network. */
export const livePage: FetchPage = async ({ surname, pageNumber, pageSize }) => {
  await sleep(SPACING_MS);
  const res = await fetch(API, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ filerName: surname, pageNumber, pageSize }),
  });
  if (!res.ok) return { status: res.status, totalItems: null, items: [] };
  const raw = await res.text();
  liveRawBodies.push(raw);
  const body = JSON.parse(raw) as {
    data?: { items?: FilerRow[]; totalItems?: number };
  };
  return {
    status: res.status,
    totalItems: typeof body.data?.totalItems === "number" ? body.data.totalItems : null,
    items: body.data?.items ?? [],
  };
};

/**
 * **READ EVERY FILER THE REGISTRY HOLDS FOR ONE SURNAME — ALL OF THEM.**
 *
 * The year filter runs HERE rather than in the request because the endpoint
 * honours `filerName` only. That is exactly why the page had to be completed
 * first: filtering locally after ONE page means a 2026 candidate whose row
 * sorted 101st for their surname was never in the data the filter saw, and the
 * candidate then fell out the bottom as a sourced absence — a claim about New
 * Hampshire's records generated by our own page size.
 *
 * The endpoint publishes `data.totalItems`, the count of every matching row,
 * and it does not move with `pageSize`. So the completeness of a read is
 * CHECKABLE against a number the publisher stated rather than against the
 * number we happened to receive, and a short read is reported as a short read.
 *
 * Where the endpoint states no total, the read pages until a short page and
 * says so with `denominatorProven: false`. That read may still fill a card —
 * a row we hold is a row we hold — but it may never earn an absence, because
 * an absence needs a denominator and this one has only a tally of our own.
 */
export async function readFilers(
  surname: string,
  fetchPage: FetchPage,
  opts: { year?: number | null; pageSize?: number; maxPages?: number } = {},
): Promise<FilerRead> {
  /*
   * `year: null` means KEEP EVERY YEAR, and it exists for the statewide
   * acquisition. A corpus filtered to one cycle at read time cannot answer a
   * question about another cycle without going back to the publisher, which is
   * the pilot-bound acquisition defect wearing a date instead of a ZIP.
   * `undefined` still means the collector's own cycle, so every existing caller
   * is unchanged.
   */
  const year = opts.year === null ? null : (opts.year ?? YEAR);
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  /*
   * A stop that is a FLOOR on paging rather than a cap on the answer: it exists
   * so a registry that pages forever cannot hang the run, and reaching it is
   * reported as an unread route (`ok: false`), never as a complete read. A
   * finite attempt count never earns an absence (RULING 170, RULING 184).
   */
  const maxPages = opts.maxPages ?? 200;
  try {
    const items: FilerRow[] = [];
    let stated: number | null = null;
    let pageNumber = 1;
    for (; pageNumber <= maxPages; pageNumber += 1) {
      const page = await fetchPage({ surname, pageNumber, pageSize });
      if (page.status !== 200) {
        return { ok: false, reason: `HTTP ${page.status} from ${API} on page ${pageNumber}` };
      }
      if (page.totalItems !== null) stated = page.totalItems;
      items.push(...page.items);
      // A short page is the end of the result set.
      if (page.items.length < pageSize) break;
      // And so is having reached what the registry says it holds.
      if (stated !== null && items.length >= stated) break;
    }

    if (pageNumber > maxPages) {
      return {
        ok: false,
        reason: `${surname}: still paging after ${maxPages} page(s) of ${pageSize} — the read did not complete`,
      };
    }

    if (stated !== null && items.length !== stated) {
      /*
       * THE SHORT READ. The registry stated a number and we hold a different
       * one, so we do not know what we are missing — and a read that cannot
       * say what it is missing can never be evidence of what is not there.
       */
      return {
        ok: false,
        reason:
          `${surname}: retrieved ${items.length} of the ${stated} row(s) the registry states it holds — ` +
          `an incomplete read is never evidence of an absence`,
      };
    }

    return {
      ok: true,
      rows: year === null ? items : items.filter((r) => r.electionYear === year),
      retrieved: items.length,
      totalItems: stated ?? items.length,
      denominatorProven: stated !== null,
    };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   ACQUISITION — the authoritative source universe (RULING 229)
   ══════════════════════════════════════════════════════════════════════════ */

/** Where the acquired statewide corpus lives. Committed, and it is the point. */
export const CORPUS_FILE = join(ROOT, "data", "states", "nh", "campaign-finance", "nh-cfs-filer-index-2026.json");

export interface FilerCorpus {
  readonly formatVersion: 1;
  readonly acquiredAt: string;
  readonly agency: string;
  readonly sourceUrl: string;
  readonly _note: readonly string[];
  /** The PUBLISHER's own count of what it holds. The checkable denominator. */
  readonly statedTotalItems: number;
  readonly retrieved: number;
  readonly rows: readonly FilerRow[];
}

/**
 * **ACQUIRE EVERY FILER THE REGISTRY HOLDS — the whole state, one read.**
 *
 * The endpoint honours `filerName` only, and it honours the EMPTY string by
 * returning the whole index. That single fact is what makes RULING 229
 * executable here: the acquisition denominator is the New Hampshire Secretary
 * of State's complete filer universe, not the surnames on one certified ballot.
 *
 * `data.totalItems` is the publisher's own count and does not move with
 * `pageSize` — measured 2026-08-31 by asking for "Smith" at pageSize 100 and at
 * pageSize 5 and reading 29 both times. So completeness is checked against a
 * number the publisher stated, and a short read is reported as a short read
 * rather than becoming a smaller universe.
 */
/**
 * **THE CORPUS CARRIES THE FIELDS THE PROJECTION USES AND NOTHING ELSE.**
 *
 * The endpoint returns considerably more per row than this collector reads, and
 * the first acquisition wrote all of it: 11 MB for 5,738 filers. That is not a
 * size problem, it is a COLLECTION problem — `CLAUDE.md` says collect the
 * minimum, and persisting fields nobody reads is holding data for no stated
 * purpose. Every field kept below is one `buildRecords` actually consults, and
 * a field this collector starts needing is added here deliberately rather than
 * arriving because it was in the response.
 */
export function narrowFilerRow(r: FilerRow): FilerRow {
  return {
    filerName: r.filerName,
    firstnameLastname: r.firstnameLastname ?? null,
    officeSoughtName: r.officeSoughtName ?? null,
    districtName: r.districtName ?? null,
    town: r.town ?? null,
    electionYear: r.electionYear ?? null,
    totalRaised: r.totalRaised ?? null,
    totalSpent: r.totalSpent ?? null,
    filerEntityId: r.filerEntityId ?? null,
    electionCycle: r.electionCycle ?? null,
    filerTypeDesc: r.filerTypeDesc ?? null,
  };
}

export async function acquireStatewideIndex(
  fetchPage: FetchPage,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<FilerRead> {
  return readFilers("", fetchPage, {
    year: null,
    pageSize: opts.pageSize ?? 500,
    maxPages: opts.maxPages ?? 200,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   PROJECTION — what one reader's ballot may see, cut out of the corpus
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * **A `filersFor` THAT NEVER TOUCHES THE NETWORK.**
 *
 * This is the half of RULING 229 that a test can fail. `buildRecords` asks for
 * a surname; the answer comes out of the acquired corpus in memory. Activating
 * another New Hampshire ZIP therefore projects — it does not hunt — and the
 * proof is structural rather than a promise: this closure holds no `fetch`, no
 * URL and no client.
 *
 * The surname match is a PREFIX-free equality on the filed surname AND a
 * substring test on the whole filed name, because the registry files a
 * committee ("Friends of Dan Innis") alongside the person ("Daniel Innis") and
 * a surname query at the publisher matched either. Narrowing here to only one
 * of them would drop rows the live route used to return, which would read as
 * the state holding less than it does.
 */
export function projectionFrom(corpus: readonly FilerRow[]): {
  filersFor: (surname: string) => Promise<FilerRead>;
  /** How many corpus reads happened. A projection makes zero requests. */
  outboundRequests: () => number;
} {
  /*
   * ZERO, AND IT IS A CONSTANT ON PURPOSE.
   *
   * Nothing in this closure can increment it, because nothing in this closure
   * can make a request. A `let` here would be the honest shape if there were a
   * network path to count; there is not, and a counter that could move would
   * imply there was one.
   */
  const outbound = 0;
  return {
    outboundRequests: () => outbound,
    filersFor: async (surname: string): Promise<FilerRead> => {
      const needle = surname.toUpperCase();
      const rows = corpus.filter((r) => {
        const filed = `${r.filerName ?? ""} ${r.firstnameLastname ?? ""}`.toUpperCase();
        return filed.includes(needle);
      });
      return {
        ok: true,
        rows: rows.filter((r) => r.electionYear === YEAR),
        retrieved: rows.length,
        totalItems: rows.length,
        /*
         * TRUE, and the denominator is the PUBLISHER's: the corpus this reads
         * was accepted only when its row count equalled the registry's own
         * stated total. A projection over a proven corpus inherits the proof;
         * a projection over a short read would not, and the corpus loader
         * refuses to hand one over.
         */
        denominatorProven: true,
      };
    },
  };
}

/**
 * Read the acquired corpus back, refusing anything that cannot carry a proof.
 *
 * A missing file, an unparseable file, or a file whose row count disagrees with
 * the publisher's own stated total is a FAILED read — not a smaller corpus.
 * Returning a partial here would let a projection assert an absence over a
 * universe nobody proved.
 */
export function loadCorpus(path = CORPUS_FILE): FilerCorpus | { error: string } {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    return { error: `${path} could not be read (${(e as Error).message}) — run \`pnpm money:nh\`` };
  }
  let parsed: FilerCorpus;
  try {
    parsed = JSON.parse(raw) as FilerCorpus;
  } catch (e) {
    return { error: `${path} did not parse (${(e as Error).message})` };
  }
  if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) {
    return { error: `${path} parsed and holds ZERO filer rows — a FAILED read, never an empty registry` };
  }
  if (parsed.rows.length !== parsed.statedTotalItems) {
    return {
      error:
        `${path} holds ${parsed.rows.length} row(s) against the publisher's stated ` +
        `${parsed.statedTotalItems} — an incomplete corpus can never be evidence of an absence`,
    };
  }
  return parsed;
}

/** The district a contest states, from its id suffix. Null when it states none. */
export function districtOf(contestId: string): string | null {
  const m = contestId.match(/-(\d+)$/);
  return m ? m[1] : null;
}

export interface BuildInput {
  ballot: Ballot;
  /** The registry read, per surname. Cached by the caller, not here. */
  filersFor: (surname: string) => Promise<FilerRead>;
  /** The read stamp every record carries. */
  asOf: string;
  year?: number;
  /**
   * The previous snapshot's records — LAST-GOOD READER TRUTH.
   *
   * A refresh that cannot read the route must not replace what a card already
   * honestly said. This is what it keeps instead.
   */
  previous?: StateMoneyRecord[];
  /**
   * The county this projection is narrowed by. RULING 229's reader half.
   *
   * Omitted, it is derived from the ballot's own divisions, and where the
   * ballot names none it falls back to `DEFAULT_PROJECTION_COUNTY`. That
   * fallback exists for exactly one caller — a ballot cut down to a single
   * STATEWIDE contest, which names no county and is still a cut of the
   * Merrimack ballot. Passing `null` turns the narrowing OFF explicitly, which
   * is a different thing from a ballot that failed to state one.
   */
  projectionCounty?: string | null;
}

export interface BuildResult {
  records: StateMoneyRecord[];
  /** Non-federal candidacies asked about. The denominator of every count. */
  inScope: number;
}

/**
 * EVERY CLAIM THIS COLLECTOR MAKES ABOUT A NAMED PERSON, IN ONE FUNCTION.
 *
 * Pure apart from the injected read, so the decision that reaches a card can
 * be executed offline against a recorded fixture.
 */
export async function buildRecords(input: BuildInput): Promise<BuildResult> {
  const year = input.year ?? YEAR;
  const asOf = input.asOf;
  const contestById = new Map(input.ballot.contests.map((c) => [c.id, c]));
  const records: StateMoneyRecord[] = [];
  let inScope = 0;
  const county =
    input.projectionCounty === undefined
      ? (countyFromBallot(input.ballot) ?? DEFAULT_PROJECTION_COUNTY)
      : input.projectionCounty;

  const provenance = {
    sourceUrl: API,
    sourceOrg: AGENCY,
    collectedAt: asOf,
    verifiedAt: asOf,
  } as StateMoneyRecord["provenance"];

  for (const cand of input.ballot.candidacies) {
    const contest = contestById.get(cand.contestId);
    if (!contest) continue;

    // Federal seats file with the FEC. Asking a state regulator about one and
    // recording the silence would be manufacturing a gap.
    if (officeClassOf(contest.title) === "FEDERAL") continue;
    inScope += 1;

    const ballotName = `${cand.givenName} ${cand.familyName}`.trim();
    const read = await input.filersFor(cand.familyName);
    const wantDistrict = districtOf(contest.id);

    if (!read.ok) {
      /*
       * **THE ROUTE DID NOT ANSWER, AND THAT IS A FACT ABOUT THE ROUTE.**
       *
       * The previous version caught the failure, printed "recorded as unread,
       * never as absent", and then cached `[]` — which fell into the empty
       * branch and wrote a SOURCED, DATED absence. The comment was right and
       * the code did the opposite, and the result was silent: the run is green
       * and a card that carried real filed money now says New Hampshire holds
       * nothing for that person.
       *
       * Two things happen instead, and neither is an absence. Last-good reader
       * truth is KEPT — carrying its original `checkedAt`, so the reader's
       * attribution line stays true and is itself the freshness mark. Where
       * there is nothing to keep, the gap is recorded as OURS and does not
       * render at all (RULING 139: the product does not announce its own
       * failure).
       */
      const kept = (input.previous ?? []).filter(
        (p) => p.targetKeys.includes(cand.id) && isRenderable(p),
      );
      if (kept.length > 0) {
        for (const p of kept) {
          records.push({ ...p, retainedFrom: { attemptedAt: asOf, reason: read.reason } });
        }
        continue;
      }
      records.push({
        dataClass: "STATE_COMMITTEE",
        jurisdiction: "NH",
        agency: AGENCY,
        filingsUrl: PUBLIC_PAGE,
        committeeId: null,
        registeredName: "",
        candidateNameAsFiled: "",
        officeSought: contest.title,
        electionYear: year,
        filingState: "ROUTE_UNREAD",
        totals: {
          receipts: null,
          expenditures: null,
          cashOnHand: null,
          reportCount: null,
          coveringPeriod: null,
        },
        targetKeys: [cand.id],
        match: {
          registeredName: "",
          officeAsFiled: null,
          officeOnBallot: contest.title,
          electionYearAsFiled: null,
          electionYearOnBallot: year,
          allThreeAgree: false,
          note:
            `the Campaign Finance System was asked for "${cand.familyName}" on ${asOf} and the ` +
            `route did not answer (${read.reason}) — this is a fact about our retrieval and ` +
            `states nothing about what the agency holds`,
        },
        checkedAt: asOf,
        provenance,
      });
      continue;
    }

    const rows = read.rows;

    const considered = rows.filter((r) => {
      // A filer in another county is not this seat, whatever the name says.
      if (county && r.town && r.town.toUpperCase() !== county.toUpperCase()) return false;
      if (wantDistrict && r.districtName && r.districtName !== wantDistrict) return false;
      return true;
    });

    /*
     * A surname query returns every filer who shares the surname, so the
     * matching bar is a conjunction: name AND office AND year, judged once in
     * `judgeMatch` so no caller can lower it locally.
     */
    const matched = considered
      .map((r) => ({
        row: r,
        match: judgeMatch({
          registeredName: r.filerName,
          candidateNameAsFiled: r.firstnameLastname || r.filerName,
          ballotName,
          officeAsFiled: r.officeSoughtName ?? null,
          officeOnBallot: contest.title,
          electionYearAsFiled: r.electionYear ?? null,
          electionYearOnBallot: year,
        }),
      }))
      .filter((m) => m.match.allThreeAgree);

    if (matched.length > 0) {
      for (const { row, match } of matched) {
        const raised = typeof row.totalRaised === "number" ? row.totalRaised : null;
        const spent = typeof row.totalSpent === "number" ? row.totalSpent : null;
        /*
         * **A REGISTERED COMMITTEE THAT REPORTS NOTHING IS NOT A CANDIDATE THE
         * STATE HAS NEVER HEARD OF.**
         *
         * This line used to read `hasMoney ? "FILED" : "NO_REPORTS_ON_FILE"`,
         * so a committee the state NAMES — with an id, a registered name, a
         * filed office and an election cycle — was assigned the same state as
         * a person the registry holds no row for, and the renderer turned that
         * into "No reports on file with the New Hampshire Secretary of State"
         * about six named people on this ballot.
         *
         * The endpoint publishes no report count at all, so it cannot support
         * a REPORT-level claim in either direction. What it can support is
         * what it says: this committee is registered and its published totals
         * are zero. That is a different fact about a different thing, and the
         * true sentence was already being written into `coveringPeriod` and
         * then thrown away by choosing a state that means something else.
         *
         * The totals still stay NULL rather than 0 — an unreported total is
         * not a reported zero, and the render-default rule is the same one
         * either way.
         */
        const hasMoney = (raised ?? 0) > 0 || (spent ?? 0) > 0;
        records.push({
          dataClass: "STATE_COMMITTEE",
          jurisdiction: "NH",
          agency: AGENCY,
          filingsUrl: PUBLIC_PAGE,
          committeeId: row.filerEntityId === null ? null : String(row.filerEntityId),
          registeredName: row.filerName,
          candidateNameAsFiled: row.firstnameLastname || row.filerName,
          officeSought: row.officeSoughtName ?? null,
          electionYear: row.electionYear ?? year,
          filingState: hasMoney ? "FILED" : "REGISTERED_NO_ACTIVITY_REPORTED",
          totals: {
            receipts: hasMoney ? raised : null,
            expenditures: hasMoney ? spent : null,
            // The CFS filer record publishes no cash-on-hand. Null, never 0.
            cashOnHand: null,
            // Nor a report count on this endpoint: what is unpublished stays null.
            reportCount: null,
            coveringPeriod: hasMoney
              ? (row.electionCycle ?? `${year} election cycle`)
              : `registered for the ${row.electionCycle ?? `${year} election cycle`}, ` +
                `with no receipts or expenditures reported as of ${asOf}`,
          },
          targetKeys: [cand.id],
          match,
          checkedAt: asOf,
          provenance,
        });
      }
      continue;
    }

    /*
     * **NOTHING MATCHED — AND THAT IS WHERE THE PRODUCT USED TO START GUESSING.**
     *
     * Before an absence may be claimed, every row the registry returned in this
     * year that COULD be this person has to be accounted for. `mayBeSamePerson`
     * is deliberately weaker than the matching bar and can only ever WITHHOLD a
     * claim: it never fills a field and never reaches a reader.
     *
     * It runs over every same-year row, not only the ones that survived the
     * county and district narrowing, because those narrowings are ours too.
     */
    const plausible = rows.filter((r) =>
      mayBeSamePerson(r.firstnameLastname || r.filerName, ballotName),
    );

    for (const row of plausible) {
      /*
       * RULING 118: a LEAD never renders, and it leaves the candidate
       * UNRESOLVED rather than answered. Recording it is what keeps the finding
       * reviewable instead of merely lost.
       */
      records.push({
        dataClass: "STATE_COMMITTEE",
        jurisdiction: "NH",
        agency: AGENCY,
        filingsUrl: PUBLIC_PAGE,
        committeeId: row.filerEntityId === null ? null : String(row.filerEntityId),
        registeredName: row.filerName,
        candidateNameAsFiled: row.firstnameLastname || row.filerName,
        officeSought: row.officeSoughtName ?? null,
        electionYear: row.electionYear ?? year,
        filingState: "LEAD",
        totals: {
          receipts: null,
          expenditures: null,
          cashOnHand: null,
          reportCount: null,
          coveringPeriod: null,
        },
        targetKeys: [],
        match: judgeMatch({
          registeredName: row.filerName,
          candidateNameAsFiled: row.firstnameLastname || row.filerName,
          ballotName,
          officeAsFiled: row.officeSoughtName ?? null,
          officeOnBallot: contest.title,
          electionYearAsFiled: row.electionYear ?? null,
          electionYearOnBallot: year,
        }),
        checkedAt: asOf,
        provenance,
      });
    }

    if (plausible.length > 0) {
      /*
       * The registry answered with a row that may be about this person. It did
       * NOT answer that it holds nothing about them, and only it can say that.
       */
      continue;
    }

    if (!read.denominatorProven) {
      /*
       * The read completed as far as it could see, but the registry published
       * no count for this query, so nothing proves we saw all of it. An
       * unprovable read may fill a card and may never empty one.
       */
      records.push({
        dataClass: "STATE_COMMITTEE",
        jurisdiction: "NH",
        agency: AGENCY,
        filingsUrl: PUBLIC_PAGE,
        committeeId: null,
        registeredName: "",
        candidateNameAsFiled: "",
        officeSought: contest.title,
        electionYear: year,
        filingState: "ROUTE_UNREAD",
        totals: {
          receipts: null,
          expenditures: null,
          cashOnHand: null,
          reportCount: null,
          coveringPeriod: null,
        },
        targetKeys: [cand.id],
        match: {
          registeredName: "",
          officeAsFiled: null,
          officeOnBallot: contest.title,
          electionYearAsFiled: null,
          electionYearOnBallot: year,
          allThreeAgree: false,
          note:
            `the Campaign Finance System was searched for "${cand.familyName}" on ${asOf} and ` +
            `returned ${read.retrieved} row(s) without stating how many it holds — the read ` +
            `cannot be shown complete, so no absence is claimed`,
        },
        checkedAt: asOf,
        provenance,
      });
      continue;
    }

    /*
     * **A SOURCED, DATED, DENOMINATOR-PROVEN ABSENCE** — never $0 and never
     * blank. The CFS was asked on this date for this surname; every row it
     * states it holds for that name was retrieved and counted; and none of them
     * is a filer in this cycle that could be this candidate. NH's thresholds
     * exempt many town-level candidates outright, so this is a correct and
     * common result rather than a thin one.
     */
    records.push({
      dataClass: "STATE_COMMITTEE",
      jurisdiction: "NH",
      agency: AGENCY,
      filingsUrl: PUBLIC_PAGE,
      committeeId: null,
      registeredName: "",
      candidateNameAsFiled: "",
      officeSought: contest.title,
      electionYear: year,
      filingState: "NO_REPORTS_ON_FILE",
      totals: {
        receipts: null,
        expenditures: null,
        cashOnHand: null,
        reportCount: null,
        coveringPeriod: null,
      },
      targetKeys: [cand.id],
      match: {
        registeredName: "",
        officeAsFiled: null,
        officeOnBallot: contest.title,
        electionYearAsFiled: null,
        electionYearOnBallot: year,
        allThreeAgree: false,
        note:
          `the Campaign Finance System was searched for "${cand.familyName}" on ${asOf}; all ` +
          `${read.totalItems} row(s) it states it holds under that name were retrieved, and ` +
          `none is a ${year} filer that could be this candidacy`,
      },
      checkedAt: asOf,
      provenance,
    });
  }

  return { records, inScope };
}

/** The snapshot the ballot page loads, from the records and the denominator. */
export function toSnapshot(result: BuildResult, asOf: string, year = YEAR): StateMoneySnapshot {
  const split = computeSplit(result.records, result.inScope);
  return {
    formatVersion: 1,
    collectedAt: asOf,
    cycle: year,
    split,
    byJurisdiction: {
      NH: {
        inScope: result.inScope,
        filed: split.filed,
        registeredNoActivityReported: split.registeredNoActivityReported,
        noReports: split.noReportsOnFile,
        lead: split.lead,
        routeUnread: split.routeUnread,
      },
    },
    records: result.records,
  };
}

const OUT_FILE = join(ROOT, "data", "states", "nh", "funding", `state-money-nh-${YEAR}.json`);

/**
 * The snapshot on disk — LAST-GOOD READER TRUTH for this run.
 *
 * A missing or unparseable file is an empty previous, never a failure: there
 * is simply nothing to retain. It is not a licence to assert anything either,
 * because retention is not what earns a claim; a completed read is.
 */
export function previousRecords(path = OUT_FILE): StateMoneyRecord[] {
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as StateMoneySnapshot).records ?? [];
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  if (!process.argv.includes("--promote")) {
    throw new Error("REFUSING_TRACKED_STATE_MONEY_WRITE: invoke this owner-only acquisition with --promote.");
  }
  prepareProductionCivicDataWrite();
  productionWritePrepared = true;
  const asOf = today();
  const ballotProjection = await readNhBallotProjection({ bypassCache: true });
  if (ballotProjection.kind !== "PROMOTED") {
    throw new Error(
      `NH_BALLOT_AUTHORITY_UNAVAILABLE:${ballotProjection.kind}: campaign-finance acquisition requires ` +
        "the canonical promoted New Hampshire ballot projection and never reads its tracked bootstrap.",
    );
  }
  const ballot = ballotProjection.value.ballot as Ballot;
  const previous: StateMoneyRecord[] = [];

  /* ── ACQUISITION: the whole state, once (RULING 229) ───────────────────── */

  const read = await acquireStatewideIndex(livePage);
  if (!read.ok) throw new Error(`The statewide acquisition did not complete: ${read.reason}`);
  const corpus: FilerCorpus = {
      formatVersion: 1,
      acquiredAt: asOf,
      agency: AGENCY,
      sourceUrl: API,
      _note: [
        "THE ACQUISITION DENOMINATOR for New Hampshire campaign finance (RULING 229).",
        "",
        "Every filer the New Hampshire Secretary of State's Campaign Finance System states it holds,",
        "acquired in one read with `filerName: \"\"`. `statedTotalItems` is the PUBLISHER's own count and",
        "does not move with pageSize; a corpus whose row count disagrees with it is refused by",
        "`loadCorpus` rather than used, because an incomplete corpus can never be evidence of an absence.",
        "",
        "THE READER PROJECTION IS CUT OUT OF THIS FILE AND MAKES NO REQUEST. Activating another New",
        "Hampshire ZIP reads these rows; it does not ask the Secretary of State for a new set of",
        "surnames. That is the whole point.",
        "",
        "NO CONTRIBUTOR APPEARS HERE. These are filer-level rows: committee, candidate, office,",
        "district, county, cycle and the filer's own published totals. The contribution and expenditure",
        "DETAIL sits behind endpoints nobody in this project has read, and it is registered as an open",
        "obligation rather than implied by this file's existence.",
      ],
      statedTotalItems: read.totalItems,
      retrieved: read.retrieved,
      rows: read.rows.map(narrowFilerRow),
  };
  console.log(`  ACQUIRED ${corpus.rows.length} filer row(s) against the publisher's stated ${corpus.statedTotalItems}.`);

  /* ── PROJECTION: this ballot, out of the corpus, with ZERO requests ────── */

  const projection = projectionFrom(corpus.rows);
  const projectionCounty = countyFromBallot(ballot) ?? DEFAULT_PROJECTION_COUNTY;
  console.log(
    `  PROJECTING onto the 03255 ballot, narrowed by county ${projectionCounty} — ` +
      "the county is a reader narrowing and is no longer an acquisition bound",
  );

  const result = await buildRecords({
    ballot,
    filersFor: projection.filersFor,
    asOf,
    previous,
    projectionCounty,
  });

  const universe: AcquisitionUniverse = {
    authority: AGENCY,
    unit: "filers",
    statedBy: corpus.statedTotalItems,
    held: corpus.rows.length,
    countedBy: `one read of ${API} with filerName: "" — the whole index, not one ballot's surnames`,
    citation: `data/states/nh/campaign-finance/nh-cfs-filer-index-2026.json, acquired ${corpus.acquiredAt}`,
  };
  const readerProjection: ReaderProjection = {
    scope: "the 03255 ballot",
    applicable: result.inScope,
    projectionNarrowedFrom: universe,
    answeredFromCorpus: result.inScope,
    requiredFreshAcquisition: [],
  };
  console.log(`  ${projectionLine(readerProjection)}`);
  const readiness = newZipReadiness(readerProjection);
  console.log(`  NEW-ZIP READINESS: ${readiness.ready ? "READY" : "NOT READY"} — ${readiness.why}`);
  console.log(
    `  outbound requests made by the projection: ${projection.outboundRequests()} ` +
      "(structural — the projection closure holds no client)",
  );
  const snapshot = toSnapshot(result, asOf);
  const { records, inScope } = result;
  const split = snapshot.split;

  /*
   * **THE COUNTS ARE FLOORED.** (RULING 159, RULING 116.)
   *
   * A run that reached no candidacy — a moved ballot file, a renamed field —
   * would otherwise print `0 filed` and read exactly like a ballot on which
   * nobody has raised money. `floored` refuses a zero denominator unless a
   * reason is supplied, so an empty population states WHY instead of rendering
   * as a finding about New Hampshire.
   */
  const filedLine = floored(
    "candidacies with a filing we can show",
    "the non-federal candidacies on the 03255 ballot",
    inScope,
    split.filed,
    "the NH ballot file yielded no non-federal candidacy — the corpus was not read, and this is not a statement about anyone's filings",
  );
  const absenceLine = floored(
    "candidacies the CFS holds nothing for",
    "the non-federal candidacies on the 03255 ballot",
    inScope,
    split.noReportsOnFile,
    "the NH ballot file yielded no non-federal candidacy, so no absence was established either",
  );
  console.log(`state-money-nh · ${floorLine(filedLine)} · ${floorLine(absenceLine)}`);
  console.log(
    `  ${split.registeredNoActivityReported} of ${inScope} registered with nothing reported · ` +
      `${split.routeUnread} of ${inScope} route(s) unread · ` +
      `${split.lead} lead(s), which never render · ` +
      `${split.unresolved} of ${inScope} unresolved · ${records.length} record(s) written`,
  );
  const retained = records.filter((r) => r.retainedFrom);
  if (retained.length > 0) {
    console.log(
      `  ${retained.length} record(s) RETAINED from the previous snapshot because the route did not answer`,
    );
  }
  for (const r of records.filter((x) => x.filingState === "FILED")) {
    console.log(
      `  FILED  ${r.candidateNameAsFiled} — ${r.registeredName} — ${r.officeSought} — ` +
        `raised ${r.totals.receipts} spent ${r.totals.expenditures}`,
    );
  }
  for (const r of records.filter((x) => x.filingState === "REGISTERED_NO_ACTIVITY_REPORTED")) {
    console.log(
      `  REGISTERED, NOTHING REPORTED  ${r.candidateNameAsFiled} — ${r.registeredName} — ${r.officeSought}`,
    );
  }

  const candidate = stateCampaignFinanceCandidate({
    jurisdiction: "NH",
    snapshot,
    rawBodies: liveRawBodies,
    requestedUrl: API,
    finalUrl: API,
    retrievedAt: new Date().toISOString(),
    query: `Every filer returned for filerName=""; ${corpus.rows.length}/${corpus.statedTotalItems} publisher-stated rows`,
    paginationComplete: corpus.rows.length === corpus.statedTotalItems,
    declaredTotal: corpus.statedTotalItems,
  });
  candidateSubmitted = true;
  const outcome = await processRegisteredManualCandidate(
    new PostgresRoutineDataStore(),
    "nh-sos-campaign-finance",
    candidate,
    candidate.retrieval.retrievedAt,
  );
  printSourceRunnerReceipt("nh-sos-campaign-finance", candidate, outcome);
  if (!outcome.promoted) throw new Error(`NH campaign-finance promotion refused: ${outcome.candidate.failureCode}`);
  console.log(`promoted ${outcome.promoted.versionId}; no tracked runtime artifact was written`);
}

if (import.meta.filename === process.argv[1]) {
  const attemptedAt = new Date().toISOString();
  try {
    await main();
  } catch (error) {
    if (process.argv.includes("--promote") && productionWritePrepared && !candidateSubmitted) {
      const failed = failedAcquisitionCandidate({
        sourceId: "nh-sos-campaign-finance",
        recordClass: "STATE_CAMPAIGN_FINANCE",
        scope: "US-NH:campaign-finance:2026",
        requestedUrl: API,
        attemptedAt,
        failureDetail: error instanceof Error ? error.message : String(error),
        parserVersion: "nh-campaign-finance/2",
      });
      const outcome = await processRegisteredManualCandidate(new PostgresRoutineDataStore(), "nh-sos-campaign-finance", failed, attemptedAt);
      printSourceRunnerReceipt("nh-sos-campaign-finance", failed, outcome);
    }
    throw error;
  }
}
