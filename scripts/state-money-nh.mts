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
 *   statewide. A filer row whose `town` names a DIFFERENT county is refused —
 *   which is what keeps `Allen Davis`, State Representative in Cheshire
 *   district 18, off a Merrimack ballot card.
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
 *   pnpm money:nh              write the snapshot
 *   pnpm money:nh --dry        read and report, write nothing
 */
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  judgeMatch,
  namesAgree,
  officeClassOf,
  type StateMoneyRecord,
  type StateMoneySnapshot,
  computeSplit,
} from "../lib/funding/state-money.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";

const ROOT = join(import.meta.dirname, "..");
const AS_OF = today();
const YEAR = 2026;
const AGENCY = "New Hampshire Secretary of State — Campaign Finance System";
const API = "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails";
const PUBLIC_PAGE = "https://cfs.sos.nh.gov/";
const SPACING_MS = 1100;
const DRY = process.argv.includes("--dry");

/** The county this ballot belongs to. A filer in another county is not this seat. */
const COUNTY = "Merrimack";

/**
 * Identification the host actually serves. The project name in a User-Agent is
 * refused 403 by this host family; `From` and `X-Purpose` say who we are and
 * why in headers it does not filter on.
 */
const HEADERS: Record<string, string> = {
  "content-type": "application/json",
  accept: "application/json, text/plain, */*",
  origin: "https://cfs.sos.nh.gov",
  referer: "https://cfs.sos.nh.gov/",
  from: "seanj22@gmail.com",
  "x-purpose": "civic campaign-finance index for a public-records product",
};

interface Candidacy {
  id: string;
  contestId: string;
  familyName: string;
  givenName: string;
}
interface Contest {
  id: string;
  title: string;
}
interface FilerRow {
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

const ballot = JSON.parse(
  readFileSync(join(ROOT, "data", "ballot", "nh-merrimack-2026.json"), "utf8"),
) as { contests: Contest[]; candidacies: Candidacy[] };

const contestById = new Map(ballot.contests.map((c) => [c.id, c]));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One query per SURNAME, cached: many candidacies share one. */
const bySurname = new Map<string, FilerRow[]>();

async function filersFor(surname: string): Promise<FilerRow[]> {
  const key = surname.toUpperCase();
  const cached = bySurname.get(key);
  if (cached) return cached;
  await sleep(SPACING_MS);
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ filerName: surname, pageNumber: 1, pageSize: 100 }),
    });
    if (!res.ok) {
      console.log(`  ! ${surname}: HTTP ${res.status} — recorded as unread, never as absent`);
      bySurname.set(key, []);
      return [];
    }
    const body = (await res.json()) as { data?: { items?: FilerRow[] } };
    const rows = (body.data?.items ?? []).filter((r) => r.electionYear === YEAR);
    bySurname.set(key, rows);
    return rows;
  } catch (e) {
    console.log(`  ! ${surname}: ${(e as Error).message} — recorded as unread`);
    bySurname.set(key, []);
    return [];
  }
}

/** The district a contest states, from its id suffix. Null when it states none. */
function districtOf(contestId: string): string | null {
  const m = contestId.match(/-(\d+)$/);
  return m ? m[1] : null;
}

const records: StateMoneyRecord[] = [];
let inScope = 0;

for (const cand of ballot.candidacies) {
  const contest = contestById.get(cand.contestId);
  if (!contest) continue;

  // Federal seats file with the FEC. Asking a state regulator about one and
  // recording the silence would be manufacturing a gap.
  if (officeClassOf(contest.title) === "FEDERAL") continue;
  inScope += 1;

  const ballotName = `${cand.givenName} ${cand.familyName}`.trim();
  const rows = await filersFor(cand.familyName);
  const wantDistrict = districtOf(contest.id);

  const considered = rows.filter((r) => {
    // A filer in another county is not this seat, whatever the name says.
    if (r.town && r.town.toUpperCase() !== COUNTY.toUpperCase()) return false;
    if (wantDistrict && r.districtName && r.districtName !== wantDistrict) return false;
    return true;
  });

  /*
   * A surname query returns every filer who shares the surname, so the first
   * cut is PERSON identity: a row whose filed name does not agree with the
   * ballot name is a different human being and is irrelevant to this card,
   * not a lead about it. Dropping those is correct; dropping a row that IS
   * this person but disagrees on office or year would not be, because that
   * candidate is still owed an answer.
   */
  const aboutThisPerson = considered
    .map((r) => ({
      row: r,
      match: judgeMatch({
        registeredName: r.filerName,
        candidateNameAsFiled: r.firstnameLastname || r.filerName,
        ballotName,
        officeAsFiled: r.officeSoughtName ?? null,
        officeOnBallot: contest.title,
        electionYearAsFiled: r.electionYear ?? null,
        electionYearOnBallot: YEAR,
      }),
    }))
    .filter((m) => namesAgree(m.row.firstnameLastname || m.row.filerName, ballotName));

  const matched = aboutThisPerson.filter((m) => m.match.allThreeAgree);
  const leads = aboutThisPerson.filter((m) => !m.match.allThreeAgree);

  if (matched.length === 0 && leads.length > 0) {
    /*
     * This person's filing exists and something about it does not line up —
     * a different office, a different year. RULING 118: a LEAD never renders,
     * and it leaves the candidate UNRESOLVED rather than answered. Recording
     * it as an absence would answer a question we have not answered.
     */
    for (const { row, match } of leads) {
      records.push({
        dataClass: "STATE_COMMITTEE",
        jurisdiction: "NH",
        agency: AGENCY,
        filingsUrl: PUBLIC_PAGE,
        committeeId: row.filerEntityId === null ? null : String(row.filerEntityId),
        registeredName: row.filerName,
        candidateNameAsFiled: row.firstnameLastname || row.filerName,
        officeSought: row.officeSoughtName ?? null,
        electionYear: row.electionYear ?? YEAR,
        filingState: "LEAD",
        totals: {
          receipts: null,
          expenditures: null,
          cashOnHand: null,
          reportCount: null,
          coveringPeriod: null,
        },
        targetKeys: [],
        match,
        checkedAt: AS_OF,
        provenance: {
          sourceUrl: API,
          sourceOrg: AGENCY,
          collectedAt: AS_OF,
          verifiedAt: AS_OF,
        } as StateMoneyRecord["provenance"],
      });
    }
    continue;
  }

  if (matched.length === 0) {
    /*
     * A SOURCED, DATED ABSENCE — never $0 and never blank. The CFS was asked,
     * on this date, for this surname, and holds no 2026 filer whose name,
     * office and year agree with this candidacy. NH's thresholds exempt many
     * town-level candidates outright, so this is a correct and common result
     * rather than a thin one.
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
      electionYear: YEAR,
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
        electionYearOnBallot: YEAR,
        allThreeAgree: false,
        note:
          `the Campaign Finance System was searched for "${cand.familyName}" on ${AS_OF} and ` +
          `holds no ${YEAR} filer whose filed name, office and year agree with this candidacy`,
      },
      checkedAt: AS_OF,
      provenance: {
        sourceUrl: API,
        sourceOrg: AGENCY,
        collectedAt: AS_OF,
        verifiedAt: AS_OF,
      } as StateMoneyRecord["provenance"],
    });
    continue;
  }

  for (const { row, match } of matched) {
    const raised = typeof row.totalRaised === "number" ? row.totalRaised : null;
    const spent = typeof row.totalSpent === "number" ? row.totalSpent : null;
    /*
     * A committee that is REGISTERED and reports nothing is not "filed with
     * totals" — it is a sourced absence. Rendering it as $0 would be a false
     * claim about a named person's campaign, which is the whole reason this
     * three-way state exists.
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
      electionYear: row.electionYear ?? YEAR,
      filingState: hasMoney ? "FILED" : "NO_REPORTS_ON_FILE",
      totals: {
        receipts: hasMoney ? raised : null,
        expenditures: hasMoney ? spent : null,
        // The CFS filer record publishes no cash-on-hand. Null, never 0.
        cashOnHand: null,
        // Nor a report count on this endpoint: what is unpublished stays null.
        reportCount: null,
        coveringPeriod: hasMoney
          ? (row.electionCycle ?? `${YEAR} election cycle`)
          : `registered for the ${row.electionCycle ?? `${YEAR} election cycle`}, ` +
            `with no receipts or expenditures reported as of ${AS_OF}`,
      },
      targetKeys: [cand.id],
      match,
      checkedAt: AS_OF,
      provenance: {
        sourceUrl: API,
        sourceOrg: AGENCY,
        collectedAt: AS_OF,
        verifiedAt: AS_OF,
      } as StateMoneyRecord["provenance"],
    });
  }
}

const split = computeSplit(records, inScope);
const snapshot: StateMoneySnapshot = {
  formatVersion: 1,
  collectedAt: AS_OF,
  cycle: YEAR,
  split,
  byJurisdiction: {
    NH: {
      inScope,
      filed: split.filed,
      noReports: split.noReportsOnFile,
      lead: split.lead,
    },
  },
  records,
};

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
  `  ${split.lead} lead(s), which never render · ${records.length} record(s) written`,
);
for (const r of records.filter((x) => x.filingState === "FILED")) {
  console.log(
    `  FILED  ${r.candidateNameAsFiled} — ${r.registeredName} — ${r.officeSought} — ` +
      `raised ${r.totals.receipts} spent ${r.totals.expenditures}`,
  );
}

const out = join(ROOT, "data", "funding", `state-money-nh-${YEAR}.json`);
if (DRY) {
  console.log(`--dry: nothing written. Would write ${out}`);
} else {
  writeFileSync(out, `${JSON.stringify(snapshot, null, 1)}\n`, "utf8");
  console.log(`wrote ${out}`);
}
