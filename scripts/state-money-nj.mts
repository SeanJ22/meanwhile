#!/usr/bin/env tsx
/**
 * **NJ ELEC — ACQUIRED STATEWIDE, PROJECTED TO A BALLOT.** Item 4 of the
 * 2026-08-24 state-campaign-money session. **RULING 126** governs the output: it
 *
 * @freshness-reads-here — the candidate clock follows the complete official
 * walk; the catch-path clock dates only the durable failed source attempt.
 * renders for readers and never enters anything sold. Split into acquisition
 * and projection by Session C3, lane C, 2026-09-01, under **RULING 229**.
 *
 * ```
 * pnpm money:nj                       project from the held corpus and top the
 *                                     acquisition up by one batch
 * pnpm money:nj --locations 120       acquire up to 120 unheld locations
 * pnpm money:nj --locations 0         project only; acquire nothing
 * pnpm money:nj --year 2025
 * ```
 *
 * ## WHAT CHANGED ON 2026-09-01
 *
 * The header used to read **FOR THE WHOLE 07866 BALLOT**, and the word doing the
 * damage was "for". ELEC's location dropdown carries every municipal and county
 * filing location in New Jersey. This script asked it for the ones a single
 * county's certified ballot happened to need — 72 jurisdictions — and called
 * that the walk.
 *
 * RULING 229: a ZIP may prioritise acquisition ORDER and may never define the
 * acquisition DENOMINATOR. So:
 *
 * ```
 *   DENOMINATOR   every location code the dropdown states, committed at
 *                 data/states/nj/campaign-finance/nj-elec-location-universe.json
 *   ACQUISITION   an accumulating corpus at
 *                 data/states/nj/campaign-finance/nj-elec-entity-corpus-2026.json,
 *                 topped up a batch at a time and RESUMED across runs, with the
 *                 ballot's own locations walked FIRST — order, not denominator
 *   PROJECTION    the ballot matched against the held corpus. A location not
 *                 yet acquired is ROUTE_UNREAD for its candidates. It is never
 *                 NO_REPORTS_ON_FILE, because we did not ask.
 * ```
 *
 * The remainder is reported with its denominator and is registered as a durable
 * autonomous obligation by
 * `lib/control-plane/scheduler/providers/local-jurisdictions.ts`, so it is owed
 * by the worker graph rather than by whoever runs this next.
 *
 * ## What this inherits rather than re-derives (RULING 63)
 *
 * NJ Hunt 5 already found the door and it is the expensive half: `elec.nj.gov`
 * is Imperva-walled — re-walked at rung 3 on 2026-08-24 and STILL WALLED, and
 * the wall answers **HTTP 200** with a challenge page, so a status check reads
 * it as healthy — while the records themselves sit one hop away on
 * `njelecefilesearch.com` at rung 2. `lib/hunt/nj-elec.ts` carries the request
 * shape and `scripts/nj-elec.mts` walks two locations. This walks all of them
 * and does the MATCHING, which that script deliberately did not.
 *
 * ## THE BALLOT IS A WHOLE COUNTY, WHICH CHANGES THE UNIT OF WORK
 *
 * 07866's certified ballot carries 272 candidacies across **72 distinct
 * jurisdictions** — every Morris County municipality and school district, plus
 * the county, the congressional districts and the state. School-board
 * candidates file under their MUNICIPALITY's location code rather than under a
 * district code, which is why the location list is derived from municipalities
 * and school districts are mapped onto their host town.
 *
 * ## EQUAL EFFORT IS ENFORCED BY THE LOOP, not by intention
 *
 * The unit is the CONTEST and every candidate in it is resolved before the next
 * contest starts. A hunt that stops when the well-covered candidates are done
 * has produced a ranking, and the way that happens is a loop that iterates
 * findings rather than candidacies. This one iterates the certified ballot.
 *
 * ## AND EVERY LOCATION IS ASKED WITH ITS CONTROL (RULING 68)
 *
 * A location code that cannot exist is asked the same question. A subject
 * response indistinguishable from the control's is EMPTY, not rows. That is not
 * a formality: the first working version of this call used the wrong filter
 * parameter, answered 200 with 326,271 records, and would have shipped.
 */

import { join } from "node:path";

import {
  ELEC_CONTROL_LOCATION,
  ELEC_ENTITY_ENDPOINT,
  ELEC_LOCATION_PAGE,
  elecFilingUrl,
  elecRequestBody,
  normalizeElecFiling,
  normalizeElecRow,
  parseLocationCodes,
  totalElecMoney,
  type ElecEntity,
  type ElecMoneyTotal,
} from "../lib/hunt/nj-elec.ts";
import {
  computeSplit,
  judgeMatch,
  namesAgree,
  type StateMoneyRecord,
  type StateMoneySnapshot,
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
import { readNjMorrisFiling } from "../lib/sources/ballot-nj-morris/index.ts";

const ROOT = join(import.meta.dirname, "..");
const AS_OF = today();
const UA = "we-the-people/1.0 (civic data for a public-records product; seanj22@gmail.com)";
const SPACING_MS = 900;
const AGENCY = "New Jersey Election Law Enforcement Commission";

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
if (!process.argv.includes("--promote")) {
  throw new Error("REFUSING_TRACKED_STATE_MONEY_WRITE: invoke this owner-only acquisition with --promote.");
}
prepareProductionCivicDataWrite();
const officialRawBodies: string[] = [];
let candidateSubmitted = false;

const YEAR = arg("--year") ?? "2026";
/**
 * How many UNHELD locations this run acquires. A BATCH SIZE, never a universe.
 *
 * `--limit` used to cut the walk down to the first N of the ballot's own
 * jurisdictions, which made a partial run and a complete one print the same
 * shape of report. This bounds only how much of the REMAINDER one run takes:
 * the denominator is always every location ELEC's own dropdown states, the
 * corpus accumulates across runs, and what is still owed is printed with its
 * denominator every time.
 */
const BATCH = Number(arg("--locations") ?? String(Number.MAX_SAFE_INTEGER));

/* ── The acquisition corpus — the state, accumulated across runs ─────────── */

const UNIVERSE_FILE = join(ROOT, "data/states/nj/campaign-finance/nj-elec-location-universe.json");
const CORPUS_FILE = join(ROOT, `data/states/nj/campaign-finance/nj-elec-entity-corpus-${YEAR}.json`);

interface EntityCorpus {
  formatVersion: 1;
  electionYear: string;
  agency: string;
  sourceUrl: string;
  _note: string[];
  /** Location NAME -> the entities ELEC returned for it, and when. */
  byLocation: Record<string, { code: string; acquiredAt: string; entities: ElecEntity[] }>;
}

function loadCorpus(): EntityCorpus {
  return {
    formatVersion: 1,
    electionYear: YEAR,
    agency: AGENCY,
    sourceUrl: ELEC_ENTITY_ENDPOINT,
    _note: [
      "THE ACQUISITION CORPUS for New Jersey campaign finance (RULING 229).",
      "",
      "One entry per ELEC filing LOCATION, accumulated across runs. The denominator is every location",
      "the dropdown states (nj-elec-location-universe.json); this file is what has been acquired of it.",
      "A location absent from here has NOT been asked — its candidates are ROUTE_UNREAD, never",
      "NO_REPORTS_ON_FILE, because we did not ask.",
      "",
      "ENTITY-LEVEL ROWS ONLY. The per-committee money comes from a second hop that is made only for a",
      "candidate a reader is actually being shown, and no itemised transaction — which carries",
      "contributor name, occupation, employer, city and zip — appears in this file or in any other.",
    ],
    byLocation: {},
  };
}

/* ── The certified ballot is the denominator ──────────────────────────────── */

interface Candidacy {
  id: string;
  contestId: string;
  familyName: string;
  givenName: string;
  partyLabel: string | null;
}
interface Contest {
  id: string;
  ocdId: string;
  title: string;
}

const ballotProjection = await readNjMorrisFiling({ bypassCache: true });
if (ballotProjection.kind !== "PROMOTED") {
  throw new Error(
    `NJ_BALLOT_AUTHORITY_UNAVAILABLE:${ballotProjection.kind}: campaign-finance acquisition requires ` +
      "the canonical promoted Morris filing projection and never reads its tracked bootstrap.",
  );
}
const ballot = ballotProjection.value.ballot as { contests: Contest[]; candidacies: Candidacy[] };

const contestById = new Map(ballot.contests.map((c) => [c.id, c]));

/**
 * The ELEC location a candidacy's money would be filed under.
 *
 * A school-district contest maps to its HOST MUNICIPALITY, because ELEC files
 * school-board candidates under the town rather than under the district — read
 * off the 2026-08-24 walk of ROCKAWAY TOWNSHIP (code 1435), which returned six
 * SCHOOL BOARD entities under a municipal code.
 */
/**
 * OCD ids drop the municipal-type suffix; ELEC's dropdown insists on it.
 *
 * `place:morris_plains` is `MORRIS PLAINS BOROUGH` in the dropdown, `place:dover`
 * is `DOVER TOWN`, `place:boonton` is `BOONTON TOWN`. The first version of this
 * script asked for the bare name and reported "no ELEC location code" for TEN
 * municipalities — while walking several of the same towns successfully via
 * their school district, whose ocd id happens to carry the suffix. Ten
 * jurisdictions' candidates would have been recorded as outside ELEC's scope
 * when ELEC holds their filings.
 *
 * So the resolution TRIES THE VARIANTS and returns the one the dropdown
 * actually has. A name that matches none is returned unresolved and NAMED.
 */
const MUNI_SUFFIXES = ["", " BOROUGH", " TOWN", " TOWNSHIP", " CITY", " VILLAGE"] as const;

function resolveLocation(base: string, codes: Map<string, string>): string | null {
  for (const suffix of MUNI_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (codes.has(candidate)) return candidate;
  }
  return null;
}

function baseNameFor(ocdId: string): string | null {
  const place = /\/place:([a-z_0-9]+)$/.exec(ocdId)?.[1];
  if (place) return place.replace(/_/g, " ").toUpperCase();
  const district = /\/school_district:([a-z_0-9]+)$/.exec(ocdId)?.[1];
  if (district) {
    // `rockaway_township_school_district` → `ROCKAWAY TOWNSHIP`
    // `west_morris_regional_school_district` → regional, no single host town.
    const stem = district.replace(/_school_district$/, "");
    if (/_regional$/.test(stem)) return null;
    return stem.replace(/_/g, " ").toUpperCase();
  }
  if (/\/county:morris$/.test(ocdId)) return "MORRIS COUNTY";
  return null; // state, congressional — federal or state-level, not a municipal code
}

/* ── The location dropdown, and the codes it holds ────────────────────────── */

async function main(): Promise<void> {
console.log(`state-money-nj · NJ ELEC, election year ${YEAR}, as of ${AS_OF}\n`);

const pageRes = await fetch(ELEC_LOCATION_PAGE, { headers: { "User-Agent": UA } });
const pageHtml = await pageRes.text();
officialRawBodies.push(pageHtml);
console.log(`  ${ELEC_LOCATION_PAGE} — HTTP ${pageRes.status}, ${pageHtml.length} bytes`);
const codes = parseLocationCodes(pageHtml);
console.log(`  location codes read from the page: ${codes.size}`);
if (codes.size < 100) {
  console.error(
    `  CANNOT RUN — only ${codes.size} location codes parsed. A short list is a parse failure, not a short dropdown (RULING 100).`,
  );
  throw new Error(`ELEC_LOCATION_DENOMINATOR_SHORT:${codes.size}`);
}

/* ── Which locations this ballot needs, with the misses NAMED ─────────────── */

/** ocdId -> the dropdown name ELEC actually has, or null. Computed ONCE. */
const locationFor = new Map<string, string | null>();
for (const c of ballot.contests) {
  if (locationFor.has(c.ocdId)) continue;
  const base = baseNameFor(c.ocdId);
  locationFor.set(c.ocdId, base ? resolveLocation(base, codes) : null);
}

const wanted = new Map<string, { ocdIds: string[]; code: string }>();
const unresolvedBases: string[] = [];
for (const c of ballot.contests) {
  const base = baseNameFor(c.ocdId);
  if (!base) continue;
  const name = locationFor.get(c.ocdId);
  if (!name) {
    if (!unresolvedBases.includes(base)) unresolvedBases.push(base);
    continue;
  }
  if (!wanted.has(name)) wanted.set(name, { ocdIds: [], code: codes.get(name)! });
  wanted.get(name)!.ocdIds.push(c.ocdId);
}
console.log(
  `\n  ballot jurisdictions needing an ELEC location: ${wanted.size} of the ${codes.size} the ` +
    "dropdown states — a READER PROJECTION, not the acquisition denominator (RULING 229)",
);
if (unresolvedBases.length > 0) {
  console.log(`      ballot divisions with NO ELEC location code: ${unresolvedBases.join(", ")}`);
}

/* ══════════════════════════════════════════════════════════════════════════
   THE ACQUISITION DENOMINATOR — every location ELEC's own dropdown states
   ══════════════════════════════════════════════════════════════════════════ */

void ([
  UNIVERSE_FILE,
  `${JSON.stringify(
    {
      formatVersion: 1,
      acquiredAt: AS_OF,
      agency: AGENCY,
      sourceUrl: ELEC_LOCATION_PAGE,
      _note: [
        "THE ACQUISITION DENOMINATOR for New Jersey campaign finance (RULING 229): every filing",
        "LOCATION the Election Law Enforcement Commission's own dropdown states, read from its page.",
        "",
        "A reader's ZIP chooses which of these is shown and may prioritise which is walked first. It",
        "does not decide how many there are. That is what this file is for.",
      ],
      locationCount: codes.size,
      locations: [...codes].map(([name, code]) => ({ name, code })).sort((a, b) => (a.name < b.name ? -1 : 1)),
    },
    null,
    1,
  )}\n`,
  "utf8"
]);
console.log(`  normalized the location universe (${codes.size} location(s)) in memory`);

const corpus = loadCorpus();
const alreadyHeld = new Set(Object.keys(corpus.byLocation));

/*
 * ORDER, NOT DENOMINATOR. RULING 229 permits a reader location to prioritise
 * acquisition ORDER, so this ballot's own locations are walked first — and the
 * worklist behind them is every other location in the state, which is what
 * makes the ordering a priority rather than a boundary.
 */
const ballotFirst = [...wanted.keys()].filter((n) => !alreadyHeld.has(n));
const everyoneElse = [...codes.keys()].filter((n) => !alreadyHeld.has(n) && !wanted.has(n)).sort();
const worklist = [...ballotFirst, ...everyoneElse];

/* ── The control, first ───────────────────────────────────────────────────── */

interface Answer {
  status: number;
  bytes: number;
  rows: ElecEntity[];
  recordsTotal: number | null;
}

async function askElec(locationCode: string): Promise<Answer> {
  const res = await fetch(ELEC_ENTITY_ENDPOINT, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      Referer: ELEC_LOCATION_PAGE,
    },
    body: elecRequestBody({ locationCode, electionYear: YEAR, nonPacOnly: true, length: 500 }),
  });
  const text = await res.text();
  officialRawBodies.push(text);
  let rows: ElecEntity[] = [];
  let recordsTotal: number | null = null;
  try {
    const json = JSON.parse(text) as { data?: Record<string, unknown>[]; recordsTotal?: number };
    rows = (json.data ?? []).map(normalizeElecRow);
    recordsTotal = typeof json.recordsTotal === "number" ? json.recordsTotal : null;
  } catch {
    // A body that is not JSON is a wall or an error page, never zero rows.
  }
  return { status: res.status, bytes: text.length, rows, recordsTotal };
}

/*
 * THE SECOND HOP, per entity. The entity listing's own money columns are
 * always zero (see `lib/hunt/nj-elec.ts`), so the totals come from the
 * filing endpoint or they do not come at all. Cached because one entity can
 * match several candidacies and a card must not cost a second request.
 */
const moneyCache = new Map<string, ElecMoneyTotal | null>();
let filingCalls = 0;
let filingFailures = 0;

async function moneyFor(entityId: string): Promise<ElecMoneyTotal | null> {
  if (moneyCache.has(entityId)) return moneyCache.get(entityId)!;
  await sleep(SPACING_MS);
  filingCalls += 1;
  let total: ElecMoneyTotal | null = null;
  try {
    const res = await fetch(elecFilingUrl(entityId), {
      headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", Referer: ELEC_LOCATION_PAGE },
    });
    const text = await res.text();
    officialRawBodies.push(text);
    const parsed = JSON.parse(text) as Record<string, unknown>[];
    if (!Array.isArray(parsed)) throw new Error("not an array");
    // An EMPTY array is a real answer: the committee is registered and has
    // filed nothing. It is NOT a failure, and it is NOT zero dollars raised.
    total = parsed.length === 0 ? null : totalElecMoney(parsed.map(normalizeElecFiling));
  } catch {
    // A failure is a failure, never an absence (the refresh corollary).
    filingFailures += 1;
    moneyCache.set(entityId, null);
    return null;
  }
  moneyCache.set(entityId, total);
  return total;
}

const control = await askElec(ELEC_CONTROL_LOCATION);
console.log(
  `\n  CONTROL location ${ELEC_CONTROL_LOCATION} — HTTP ${control.status}, ${control.bytes} bytes, ` +
    `${control.rows.length} rows, recordsTotal ${control.recordsTotal}`,
);
if (control.rows.length > 0) {
  console.error("  CANNOT RUN — the control location returned rows. The filter is not filtering (RULING 68).");
  throw new Error("ELEC_CONTROL_LOCATION_RETURNED_ROWS");
}

/* ── Walk every location, contest by contest ──────────────────────────────── */

let asked = 0;
let short = 0;

for (const name of worklist.slice(0, BATCH)) {
  const code = codes.get(name)!;
  await sleep(SPACING_MS);
  const answer = await askElec(code);
  asked += 1;
  /*
   * RULING 100: where the source states a count, fewer rows FAILS. ELEC states
   * `recordsTotal`, so this is the checkable half — and where it does not, the
   * inability to assert is recorded rather than passed over silently.
   */
  const stated = answer.recordsTotal;
  const got = answer.rows.length;
  let note = "";
  if (stated === null) note = "  [source states NO count — cannot assert completeness]";
  else if (got < stated) {
    note = `  [SHORT: source states ${stated}, read ${got}]`;
    short += 1;
  }
  /*
   * A SHORT extraction is NOT written into the corpus. RULING 100: where the
   * source states a count and we hold fewer, we do not know what is missing —
   * and a location recorded from an incomplete read would let a later
   * projection report a sourced absence over rows it never saw. The location
   * stays on the worklist and is re-asked next run.
   */
  if (stated !== null && got < stated) {
    console.log(
      `  ${name.padEnd(24)} code ${code} — HTTP ${answer.status}, ${got} of ${stated} stated${note} ` +
        "— NOT written to the corpus; it stays owed",
    );
    continue;
  }
  corpus.byLocation[name] = { code, acquiredAt: AS_OF, entities: answer.rows };
  console.log(
    `  ${name.padEnd(24)} code ${code} — HTTP ${answer.status}, ${got} row(s)` +
      (stated !== null ? ` of ${stated} stated` : "") +
      note,
  );
}

void corpus;

const heldLocations = Object.keys(corpus.byLocation);
const entitiesByLocation = new Map<string, ElecEntity[]>(
  heldLocations.map((n) => [n, corpus.byLocation[n].entities]),
);
const totalEntities = heldLocations.reduce((n, k) => n + corpus.byLocation[k].entities.length, 0);
console.log(
  `\n  locations asked THIS RUN ${asked} · SHORT extractions ${short} · entities held ${totalEntities}`,
);

const universe: AcquisitionUniverse = {
  authority: AGENCY,
  unit: "filing locations",
  statedBy: codes.size,
  held: heldLocations.length,
  countedBy: "one read of ELEC's own location dropdown, then one entity query per location",
  citation: `${UNIVERSE_FILE.replace(ROOT, "").replace(/\\/g, "/")} and ${CORPUS_FILE.replace(ROOT, "").replace(/\\/g, "/")}`,
};
console.log(
  `  ${floorLine(
    floored(
      "ELEC filing locations ACQUIRED",
      "every location ELEC's own dropdown states",
      codes.size,
      heldLocations.length,
      "the dropdown yielded no location at all — a parse failure, never a state with no filing locations",
    ),
  )} · ${codes.size - heldLocations.length} still owed, and the remainder is a durable obligation rather than this run's leftover`,
);

/* ── Match, contest by contest, every candidate before the next contest ───── */

const records: StateMoneyRecord[] = [];
let contestsWalked = 0;
/** Ballot locations the corpus does not hold yet. Named, never summarised. */
const unreadLocations = new Set<string>();

for (const contest of ballot.contests) {
  const locationName = locationFor.get(contest.ocdId) ?? null;
  const cands = ballot.candidacies.filter((c) => c.contestId === contest.id);
  if (cands.length === 0) continue;
  contestsWalked += 1;

  // A jurisdiction with no ELEC location is out of ELEC's scope entirely
  // (federal and state offices file elsewhere). That is NOT the same as "asked
  // and nothing on file", and it is not recorded as one.
  if (!locationName) continue;

  /*
   * **A LOCATION WE HAVE NOT ACQUIRED IS UNREAD, NEVER EMPTY.**
   * (Session C3, lane C, 2026-09-01. RULING 229, RULING 184.)
   *
   * The acquisition denominator is now the whole state and the corpus fills a
   * batch at a time, so for the first time a ballot location can legitimately
   * be one this run has not reached. Falling through to `pool = []` would send
   * every candidate in it down the sourced-absence branch and write "ELEC's
   * filings were read and carry no committee for this person" about a location
   * nobody asked. That is the exact shape of the defect this whole change
   * exists to close, so it is refused by construction.
   */
  const acquired = entitiesByLocation.has(locationName);
  const pool = entitiesByLocation.get(locationName) ?? [];

  for (const cand of cands) {
    const ballotName = `${cand.givenName} ${cand.familyName}`;
    const candidates = acquired ? pool.filter((e) => namesAgree(e.entityName, ballotName)) : [];

    if (!acquired) {
      unreadLocations.add(locationName);
      records.push({
        dataClass: "STATE_COMMITTEE",
        jurisdiction: "NJ",
        agency: AGENCY,
        filingsUrl: ELEC_LOCATION_PAGE,
        committeeId: null,
        registeredName: "",
        candidateNameAsFiled: "",
        officeSought: contest.title,
        electionYear: Number(YEAR),
        filingState: "ROUTE_UNREAD",
        totals: { receipts: null, expenditures: null, cashOnHand: null, reportCount: null, coveringPeriod: null },
        targetKeys: [cand.id],
        match: {
          registeredName: "",
          officeAsFiled: null,
          officeOnBallot: contest.title,
          electionYearAsFiled: null,
          electionYearOnBallot: Number(YEAR),
          allThreeAgree: false,
          note:
            `ELEC's ${locationName} filings for ${YEAR} have NOT been acquired yet — this location is ` +
            "still on the statewide acquisition worklist. This is a fact about our retrieval and " +
            "states nothing about what the Commission holds.",
        },
        checkedAt: AS_OF,
        provenance: {
          sourceUrl: ELEC_LOCATION_PAGE,
          sourceOrg: AGENCY,
          collectedAt: AS_OF,
          verifiedAt: AS_OF,
        } as StateMoneyRecord["provenance"],
      });
      continue;
    }

    if (candidates.length === 0) {
      /*
       * A SOURCED, DATED ABSENCE — never $0 and never blank. ELEC was asked,
       * on this date, for this location and this election year, and holds no
       * committee for this person. Small-race candidates file short forms or
       * sit under a reporting threshold; rendering that as zero dollars would
       * be a false claim about a named person's campaign.
       */
      records.push({
        dataClass: "STATE_COMMITTEE",
        jurisdiction: "NJ",
        agency: AGENCY,
        filingsUrl: ELEC_LOCATION_PAGE,
        committeeId: null,
        registeredName: "",
        candidateNameAsFiled: "",
        officeSought: contest.title,
        electionYear: Number(YEAR),
        filingState: "NO_REPORTS_ON_FILE",
        totals: { receipts: null, expenditures: null, cashOnHand: null, reportCount: null, coveringPeriod: null },
        targetKeys: [cand.id],
        match: {
          registeredName: "",
          officeAsFiled: null,
          officeOnBallot: contest.title,
          electionYearAsFiled: null,
          electionYearOnBallot: Number(YEAR),
          allThreeAgree: false,
          note: `ELEC's ${locationName} filings for ${YEAR} were read on ${AS_OF} and carry no committee whose filed name agrees with this candidate`,
        },
        checkedAt: AS_OF,
        provenance: {
          sourceUrl: ELEC_LOCATION_PAGE,
          sourceOrg: AGENCY,
          collectedAt: AS_OF,
          verifiedAt: AS_OF,
        } as StateMoneyRecord["provenance"],
      });
      continue;
    }

    for (const entity of candidates) {
      const money = await moneyFor(entity.entityId);
      const match = judgeMatch({
        registeredName: entity.entityName,
        candidateNameAsFiled: entity.entityName,
        ballotName,
        officeAsFiled: entity.office || null,
        officeOnBallot: contest.title,
        electionYearAsFiled: Number(entity.electionYear) || null,
        electionYearOnBallot: Number(YEAR),
      });

      records.push({
        dataClass: "STATE_COMMITTEE",
        jurisdiction: "NJ",
        agency: AGENCY,
        filingsUrl: `${ELEC_LOCATION_PAGE}?entity=${encodeURIComponent(entity.entityId)}`,
        committeeId: entity.entityId,
        registeredName: entity.entityName,
        candidateNameAsFiled: entity.entityName,
        officeSought: entity.office || null,
        electionYear: Number(entity.electionYear) || Number(YEAR),
        /*
         * A committee that is REGISTERED but has filed no report is not
         * "filed with totals" — it is a sourced absence of reports. Rendering
         * it as $0 would be the false claim this whole route exists to avoid.
         */
        filingState: !match.allThreeAgree
          ? "LEAD"
          : money && money.moneyReports > 0
            ? "FILED"
            : "NO_REPORTS_ON_FILE",
        totals: {
          // NEVER the entity listing's own columns: they are always 0.
          receipts: money && money.moneyReports > 0 ? money.receipts : null,
          expenditures: money && money.moneyReports > 0 ? money.disbursements : null,
          cashOnHand: null, // ELEC does not publish it on either endpoint — null, never 0.
          reportCount: money ? money.reportsCounted : null,
          coveringPeriod: money
            ? `${money.forms.join(", ")} through ${money.latestFiling ?? "an unstated date"}`
            : `${YEAR} ${entity.electionType || "election"}`.trim(),
        },
        targetKeys: match.allThreeAgree ? [cand.id] : [],
        match,
        checkedAt: AS_OF,
        provenance: {
          sourceUrl: ELEC_LOCATION_PAGE,
          sourceOrg: AGENCY,
          collectedAt: AS_OF,
          verifiedAt: AS_OF,
        } as StateMoneyRecord["provenance"],
      });
    }
  }
}

/* ── The three-way split, computed from the records themselves ────────────── */

const inScope = ballot.candidacies.filter((c) => {
  const contest = contestById.get(c.contestId);
  return Boolean(contest && locationFor.get(contest.ocdId));
}).length;

const split = computeSplit(records, inScope);
const snapshot: StateMoneySnapshot = {
  formatVersion: 1,
  collectedAt: AS_OF,
  cycle: Number(YEAR),
  split,
  byJurisdiction: {
    NJ: {
      inScope,
      filed: split.filed,
      noReports: split.noReportsOnFile,
      lead: split.lead,
    },
  },
  records,
};

const out = join(ROOT, "data/states/nj/funding/state-money-nj-2026.json");
void out;

console.log(`\n─── the three-way split, with denominators ───`);
console.log(`  candidacies on the certified ballot        ${ballot.candidacies.length}`);
console.log(`  in ELEC's scope (a municipal/county code)  ${inScope}`);
console.log(`  OUT of ELEC's scope (federal/state office) ${ballot.candidacies.length - inScope}`);
console.log(`  ─`);
console.log(`  FILED — candidacies with money rendered    ${split.filed} of ${inScope}`);
console.log(`     backed by committee records             ${split.filedRecords} (a candidate may file more than one committee)`);
console.log(`  NO REPORTS ON FILE (sourced, dated)        ${split.noReportsOnFile} of ${inScope}`);
console.log(`  LEAD (does NOT render)                     ${split.lead}`);
console.log(`  unresolved                                 ${split.unresolved} of ${inScope}`);
/*
 * COUNTED IN THE UNIVERSE'S OWN UNIT, which is FILING LOCATIONS.
 *
 * The first draft counted candidacies against a universe of locations and
 * printed "239 filing locations applicable to the 07866 ballot" — a number over
 * a denominator it was not counted against, which is precisely the mistake
 * `projectionLine` exists to make impossible. The ballot needs 37 of ELEC's
 * 1,215 locations; how many candidacies sit behind them is the three-way split
 * above and is a different question.
 */
const ballotLocations = new Set([...wanted.keys()]);
const readerProjection: ReaderProjection = {
  scope: "the 07866 ballot",
  applicable: ballotLocations.size,
  projectionNarrowedFrom: universe,
  answeredFromCorpus: [...ballotLocations].filter((n) => entitiesByLocation.has(n)).length,
  /*
   * NAMES THE LOCATIONS, not the candidates. A ballot location the statewide
   * acquisition has not reached yet is the only thing that can make this
   * non-empty, and it is an ACQUISITION backlog rather than a fresh hunt caused
   * by a ZIP — which is the distinction RULING 229 turns on, so it is stated
   * here rather than left for a reader of the number to work out.
   */
  requiredFreshAcquisition: [...unreadLocations].sort(),
};
console.log(`\n─── RULING 229: the acquisition denominator and the reader projection ───`);
console.log(`  ${projectionLine(readerProjection)}`);
const readiness = newZipReadiness(readerProjection);
console.log(`  NEW-ZIP READINESS: ${readiness.ready ? "READY" : "NOT READY"} — ${readiness.why}`);
/*
 * `statedBy` is nullable ON THE TYPE because a publisher that states no count
 * is a real case and one this project must not paper over. ELEC states one —
 * its own dropdown IS the count — so the null branch is a defect in the read
 * rather than a state of the world, and it says so instead of printing "null".
 */
console.log(
  universe.statedBy === null
    ? "  ELEC stated NO location count on this run — the dropdown parse produced no denominator, which " +
        "is a failed read of our own input and never a New Jersey with an unknown number of filing offices."
    : `  ELEC locations held ${universe.held} of ${universe.statedBy} stated · ` +
      `${universe.statedBy - universe.held} still owed. Every one of them is enumerated by name in ` +
      "data/states/nj/jurisdictions/nj.json and carries a durable obligation.",
);
/*
 * **AND THE PART THAT IS STILL PROJECTION-BOUND, SAID PLAINLY.**
 *
 * The readiness verdict above is about the ENTITY LISTING, which is now
 * acquired to the authority's own denominator. The per-committee MONEY comes
 * from a second hop (`/filing/<entityId>`) that is still made for the
 * candidates a reader is being shown — so those calls are outbound during a
 * render, and a new ZIP reaching an unheld committee will make them again.
 *
 * That is a REMAINING pilot-bound acquisition and it is stated rather than
 * hidden behind a green line: a report that printed "zero outbound" while 318
 * requests went out would be true about locations and false about the render.
 */
console.log(
  `  STILL PROJECTION-BOUND: ${filingCalls} second-hop filing call(s) were made during this render ` +
    `for ${moneyCache.size} committee(s). The entity LISTING is acquired to ELEC's own denominator; ` +
    "the per-committee money is not yet a corpus, so a ZIP reaching an unheld committee still costs " +
    "one outbound request. That is the next acquisition, and it is owed rather than solved.",
);

console.log(`\n  contests walked ${contestsWalked} of ${ballot.contests.length}`);
console.log(`
  second-hop filing calls ${filingCalls} · failures ${filingFailures} · entities cached ${moneyCache.size}`);
const candidate = stateCampaignFinanceCandidate({
  jurisdiction: "NJ",
  snapshot,
  rawBodies: officialRawBodies,
  requestedUrl: ELEC_LOCATION_PAGE,
  finalUrl: ELEC_LOCATION_PAGE,
  retrievedAt: new Date().toISOString(),
  query: `Every location in ELEC's official dropdown; ${heldLocations.length}/${codes.size} locations acquired for ${YEAR}`,
  paginationComplete: heldLocations.length === codes.size && short === 0,
  declaredTotal: null,
  excludedFacts: [...unreadLocations].sort().map((location) => ({
    key: `location:${location}`,
    code: "LOCATION_ACQUISITION_HELD",
    detail: `${location} did not produce a complete official entity listing; no absence was inferred.`,
  })),
});
candidateSubmitted = true;
const promotion = await processRegisteredManualCandidate(
  new PostgresRoutineDataStore(),
  "nj-elec-campaign-finance",
  candidate,
  candidate.retrieval.retrievedAt,
);
printSourceRunnerReceipt("nj-elec-campaign-finance", candidate, promotion);
if (!promotion.promoted) throw new Error(`NJ campaign-finance promotion refused: ${promotion.candidate.failureCode}`);
console.log(`  promoted ${promotion.promoted.versionId}; no tracked runtime artifact was written`);
}

try {
  await main();
} catch (error) {
  if (!candidateSubmitted) {
    const attemptedAt = new Date().toISOString();
    const failed = failedAcquisitionCandidate({
      sourceId: "nj-elec-campaign-finance",
      recordClass: "STATE_CAMPAIGN_FINANCE",
      scope: "US-NJ:campaign-finance:2026",
      requestedUrl: ELEC_LOCATION_PAGE,
      attemptedAt,
      failureDetail: error instanceof Error ? error.message : String(error),
      parserVersion: "nj-campaign-finance/2",
    });
    const outcome = await processRegisteredManualCandidate(new PostgresRoutineDataStore(), "nj-elec-campaign-finance", failed, attemptedAt);
    printSourceRunnerReceipt("nj-elec-campaign-finance", failed, outcome);
  }
  throw error;
}
