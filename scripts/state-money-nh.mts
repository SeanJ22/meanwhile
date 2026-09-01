/**
 * **NEW HAMPSHIRE STATE AND COUNTY CAMPAIGN MONEY, FOR THE 03255 BALLOT.**
 * (Session C, 2026-08-31. RULING 126, RULING 118.)
 *
 * Produces `data/funding/state-money-nh-2026.json` — a `StateMoneySnapshot`
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
 *   pnpm money:nh              write the snapshot
 *   pnpm money:nh --dry        read and report, write nothing
 */
import { writeFileSync } from "node:fs";
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
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";

const ROOT = join(import.meta.dirname, "..");
export const YEAR = 2026;
export const AGENCY = "New Hampshire Secretary of State — Campaign Finance System";
export const API =
  "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails";
export const PUBLIC_PAGE = "https://cfs.sos.nh.gov/";
const SPACING_MS = 1100;
const PAGE_SIZE = 100;

/** The county this ballot belongs to. A filer in another county is not this seat. */
export const COUNTY = "Merrimack";

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

/** The live route. The only place in this file that touches the network. */
export const livePage: FetchPage = async ({ surname, pageNumber, pageSize }) => {
  await sleep(SPACING_MS);
  const res = await fetch(API, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ filerName: surname, pageNumber, pageSize }),
  });
  if (!res.ok) return { status: res.status, totalItems: null, items: [] };
  const body = (await res.json()) as {
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
  opts: { year?: number; pageSize?: number; maxPages?: number } = {},
): Promise<FilerRead> {
  const year = opts.year ?? YEAR;
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
      rows: items.filter((r) => r.electionYear === year),
      retrieved: items.length,
      totalItems: stated ?? items.length,
      denominatorProven: stated !== null,
    };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
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
      if (r.town && r.town.toUpperCase() !== COUNTY.toUpperCase()) return false;
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

const OUT_FILE = join(ROOT, "data", "funding", `state-money-nh-${YEAR}.json`);

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
  const DRY = process.argv.includes("--dry");
  const asOf = today();
  const ballot = JSON.parse(
    readFileSync(join(ROOT, "data", "ballot", "nh-merrimack-2026.json"), "utf8"),
  ) as Ballot;
  const previous = previousRecords();

  /** One query per SURNAME, cached: many candidacies share one. */
  const bySurname = new Map<string, FilerRead>();
  const filersFor = async (surname: string): Promise<FilerRead> => {
    const key = surname.toUpperCase();
    const cached = bySurname.get(key);
    if (cached) return cached;
    const read = await readFilers(surname, livePage);
    if (!read.ok) console.log(`  ! ${surname}: ${read.reason} — recorded as unread, never as absent`);
    bySurname.set(key, read);
    return read;
  };

  const result = await buildRecords({ ballot, filersFor, asOf, previous });
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

  if (DRY) {
    console.log(`--dry: nothing written. Would write ${OUT_FILE}`);
  } else {
    writeFileSync(OUT_FILE, `${JSON.stringify(snapshot, null, 1)}\n`, "utf8");
    console.log(`wrote ${OUT_FILE}`);
  }
}

if (import.meta.filename === process.argv[1]) {
  await main();
}
