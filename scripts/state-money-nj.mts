#!/usr/bin/env tsx
/**
 * New Jersey campaign money from ELEC: acquires every filing location ELEC's
 * own dropdown states (this ballot's locations first), then matches the
 * promoted ballot contest by contest, every candidate before the next contest.
 *
 * @freshness-reads-here — the candidate clock follows the complete official
 * walk; the catch-path clock dates only the durable failed source attempt.
 *
 * ```
 * pnpm money:nj --promote                       acquire every unheld location
 * pnpm money:nj --promote --locations 120       acquire up to 120 unheld locations
 * pnpm money:nj --promote --locations 0         project only; acquire nothing
 * pnpm money:nj --promote --year 2025
 * ```
 *
 * A location not yet acquired is ROUTE_UNREAD for its candidates, never
 * NO_REPORTS_ON_FILE. Every location is also asked against a control code that
 * cannot exist; a response indistinguishable from the control's is empty.
 */

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
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";
import { stateCampaignFinanceCandidate } from "../lib/funding/data-plane.ts";
import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { readNjMorrisFiling } from "../lib/sources/ballot-nj-morris/index.ts";

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
/** How many unheld locations this run acquires: a batch size, never the universe. */
const BATCH = Number(arg("--locations") ?? String(Number.MAX_SAFE_INTEGER));

/* ── The acquisition corpus — the state, accumulated across runs ─────────── */

interface EntityCorpus {
  formatVersion: 1;
  electionYear: string;
  agency: string;
  sourceUrl: string;
  /** Location NAME -> the entities ELEC returned for it, and when. */
  byLocation: Record<string, { code: string; acquiredAt: string; entities: ElecEntity[] }>;
}

function loadCorpus(): EntityCorpus {
  return {
    formatVersion: 1,
    electionYear: YEAR,
    agency: AGENCY,
    sourceUrl: ELEC_ENTITY_ENDPOINT,
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
 * The ELEC location a contest's money is filed under. School-board candidates
 * file under their host municipality. OCD ids drop the municipal-type suffix the
 * dropdown carries, so each variant is tried; a name matching none stays unresolved.
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
    // A regional school district has no single host town.
    const stem = district.replace(/_school_district$/, "");
    if (/_regional$/.test(stem)) return null;
    return stem.replace(/_/g, " ").toUpperCase();
  }
  const county = /\/county:([a-z_]+)$/.exec(ocdId)?.[1];
  if (county) return `${county.replace(/_/g, " ").toUpperCase()} COUNTY`;
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
    `  CANNOT RUN — only ${codes.size} location codes parsed. A short list is a parse failure, not a short dropdown.`,
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
    "dropdown states",
);
if (unresolvedBases.length > 0) {
  console.log(`      ballot divisions with NO ELEC location code: ${unresolvedBases.join(", ")}`);
}

const corpus = loadCorpus();
const alreadyHeld = new Set(Object.keys(corpus.byLocation));

// This ballot's own locations are walked first; the rest of the state follows.
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

// The entity listing's money columns are always zero (see `lib/hunt/nj-elec.ts`), so totals come
// from the filing endpoint. Cached because one entity can match several candidacies.
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
  console.error("  CANNOT RUN — the control location returned rows. The filter is not filtering.");
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
  // Where ELEC states `recordsTotal`, fewer rows is a short read.
  const stated = answer.recordsTotal;
  const got = answer.rows.length;
  let note = "";
  if (stated === null) note = "  [source states NO count — cannot assert completeness]";
  else if (got < stated) {
    note = `  [SHORT: source states ${stated}, read ${got}]`;
    short += 1;
  }
  // A short extraction is not written to the corpus; the location stays on the worklist.
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

const heldLocations = Object.keys(corpus.byLocation);
const entitiesByLocation = new Map<string, ElecEntity[]>(
  heldLocations.map((n) => [n, corpus.byLocation[n].entities]),
);
const totalEntities = heldLocations.reduce((n, k) => n + corpus.byLocation[k].entities.length, 0);
console.log(
  `\n  locations asked THIS RUN ${asked} · SHORT extractions ${short} · entities held ${totalEntities}`,
);

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

  // A jurisdiction with no ELEC location is out of ELEC's scope (federal and state offices file elsewhere).
  if (!locationName) continue;

  // A location not yet acquired is ROUTE_UNREAD, never a sourced absence.
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
      // A sourced, dated absence: never $0 and never blank.
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
        // A registered committee with no report is a sourced absence of reports, never $0.
        filingState: !match.allThreeAgree
          ? "LEAD"
          : money && money.moneyReports > 0
            ? "FILED"
            : "NO_REPORTS_ON_FILE",
        totals: {
          // Never the entity listing's own columns: they are always 0.
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
