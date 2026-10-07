/**
 * New Hampshire campaign money: acquires the Secretary of State's whole filer
 * index in one read, then projects it onto the promoted ballot.
 *
 * @freshness-reads-here — the candidate clock follows the reconciled official
 * corpus; the catch-path clock dates only the durable failed attempt.
 *
 * Matching is name AND office AND year (`judgeMatch`), narrowed further by the
 * ballot's county and the contest's district. A stranger's row is dropped; a
 * row that is this person but disagrees on office or year is a LEAD that never
 * renders; only when nothing survives is a sourced, dated absence recorded.
 * Federal contests are skipped (they file with the FEC).
 *
 *   pnpm money:nh --promote
 */
import {
  isRenderable,
  judgeMatch,
  mayBeSamePerson,
  officeClassOf,
  type StateMoneyRecord,
  type StateMoneySnapshot,
  computeSplit,
} from "../lib/funding/state-money.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";
import { stateCampaignFinanceCandidate } from "../lib/funding/data-plane.ts";
import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { readNhBallotProjection } from "../lib/civic-data/manual-read-models.ts";

export const YEAR = 2026;
export const AGENCY = "New Hampshire Secretary of State — Campaign Finance System";
export const API =
  "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails";
export const PUBLIC_PAGE = "https://cfs.sos.nh.gov/";
const SPACING_MS = 1100;
const PAGE_SIZE = 100;

/** The county a ballot belongs to, from its own contests' divisions, or null when it names none. */
export function countyFromBallot(ballot: { contests: { ocdId?: string }[] }): string | null {
  for (const c of ballot.contests) {
    const m = /\/county:([a-z_]+)/.exec(c.ocdId ?? "");
    if (m) return m[1].replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  return null;
}

/** The project name in a User-Agent is refused 403 by this host, so identification goes in `From` and `X-Purpose`. */
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

/** One page as the registry answered it. `totalItems` does not move with `pageSize`. */
export interface FilerPage {
  status: number;
  totalItems: number | null;
  items: FilerRow[];
}

/** A failed read (`ok: false`) has no rows, so it can never be mistaken for an empty answer. */
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
 * Reads every filer the registry holds for one surname. Completeness is checked
 * against the publisher's own `totalItems`; a read with no stated total reports
 * `denominatorProven: false` and may never earn an absence.
 */
export async function readFilers(
  surname: string,
  fetchPage: FetchPage,
  opts: { year?: number | null; pageSize?: number; maxPages?: number } = {},
): Promise<FilerRead> {
  // `year: null` keeps every year, for the statewide acquisition.
  const year = opts.year === null ? null : (opts.year ?? YEAR);
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  // Reaching the page cap is an unread route, never a complete read.
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
      // A short page, or reaching the registry's stated total, ends the result set.
      if (page.items.length < pageSize) break;
      if (stated !== null && items.length >= stated) break;
    }

    if (pageNumber > maxPages) {
      return {
        ok: false,
        reason: `${surname}: still paging after ${maxPages} page(s) of ${pageSize} — the read did not complete`,
      };
    }

    if (stated !== null && items.length !== stated) {
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
   ACQUISITION — the whole state, one read
   ══════════════════════════════════════════════════════════════════════════ */
export interface FilerCorpus {
  readonly formatVersion: 1;
  readonly acquiredAt: string;
  readonly agency: string;
  readonly sourceUrl: string;
  readonly _note: readonly string[];
  /** The publisher's own count of what it holds. */
  readonly statedTotalItems: number;
  readonly retrieved: number;
  readonly rows: readonly FilerRow[];
}

/** Keeps only the fields `buildRecords` consults. */
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
 * A `filersFor` over the acquired corpus that never touches the network. It
 * matches the surname anywhere in the filed committee or candidate name, as the
 * publisher's own surname query did.
 */
export function projectionFrom(corpus: readonly FilerRow[]): {
  filersFor: (surname: string) => Promise<FilerRead>;
  /** How many corpus reads happened. A projection makes zero requests. */
  outboundRequests: () => number;
} {
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
        denominatorProven: true,
      };
    },
  };
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
  /** The previous snapshot's records, kept when the route cannot be read. */
  previous?: StateMoneyRecord[];
  /** The county this projection is narrowed by. Omitted, it is derived from the ballot; null turns narrowing off. */
  projectionCounty?: string | null;
}

export interface BuildResult {
  records: StateMoneyRecord[];
  /** Non-federal candidacies asked about. The denominator of every count. */
  inScope: number;
}

/** Every claim this collector makes about a named person. Pure apart from the injected read. */
export async function buildRecords(input: BuildInput): Promise<BuildResult> {
  const year = input.year ?? YEAR;
  const asOf = input.asOf;
  const contestById = new Map(input.ballot.contests.map((c) => [c.id, c]));
  const records: StateMoneyRecord[] = [];
  let inScope = 0;
  const county =
    input.projectionCounty === undefined
      ? countyFromBallot(input.ballot)
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

    // Federal seats file with the FEC.
    if (officeClassOf(contest.title) === "FEDERAL") continue;
    inScope += 1;

    const ballotName = `${cand.givenName} ${cand.familyName}`.trim();
    const read = await input.filersFor(cand.familyName);
    const wantDistrict = districtOf(contest.id);

    if (!read.ok) {
      // A failed read keeps last-good records (with their original checkedAt);
      // with nothing to keep it records ROUTE_UNREAD, never an absence.
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

    // A surname query returns every filer who shares the surname, so the bar is name AND office AND year.
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
        // The endpoint publishes no report count, so a registered committee with
        // zero totals is REGISTERED_NO_ACTIVITY_REPORTED, never "no reports on file".
        // Unreported totals stay null, never 0.
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

    // Before an absence may be claimed, every same-year row that could be this
    // person is recorded as a lead. `mayBeSamePerson` can only withhold a claim.
    const plausible = rows.filter((r) =>
      mayBeSamePerson(r.firstnameLastname || r.filerName, ballotName),
    );

    for (const row of plausible) {
      // A lead never renders, and leaves the candidate unresolved rather than answered.
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
      // A row may be about this person, so the registry has not said it holds nothing about them.
      continue;
    }

    if (!read.denominatorProven) {
      // An unprovable read may fill a card and may never empty one.
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

    // A sourced, dated, denominator-proven absence: never $0 and never blank.
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

  const read = await acquireStatewideIndex(livePage);
  if (!read.ok) throw new Error(`The statewide acquisition did not complete: ${read.reason}`);
  const corpus: FilerCorpus = {
      formatVersion: 1,
      acquiredAt: asOf,
      agency: AGENCY,
      sourceUrl: API,
      _note: [
        "THE ACQUISITION DENOMINATOR for New Hampshire campaign finance.",
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

  const projection = projectionFrom(corpus.rows);
  const projectionCounty = countyFromBallot(ballot);
  console.log(`  PROJECTING onto the New Hampshire ballot${projectionCounty ? `, narrowed by county ${projectionCounty}` : ""}`);

  const result = await buildRecords({
    ballot,
    filersFor: projection.filersFor,
    asOf,
    previous,
    projectionCounty,
  });

  console.log(
    `  outbound requests made by the projection: ${projection.outboundRequests()} ` +
      "(structural — the projection closure holds no client)",
  );
  const snapshot = toSnapshot(result, asOf);
  const { records, inScope } = result;
  const split = snapshot.split;

  // A run that reached no candidacy states why instead of printing "0 filed".
  const filedLine = floored(
    "candidacies with a filing we can show",
    "the non-federal candidacies on the New Hampshire ballot",
    inScope,
    split.filed,
    "the NH ballot file yielded no non-federal candidacy — the corpus was not read, and this is not a statement about anyone's filings",
  );
  const absenceLine = floored(
    "candidacies the CFS holds nothing for",
    "the non-federal candidacies on the New Hampshire ballot",
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
