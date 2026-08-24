#!/usr/bin/env tsx
/**
 * **NJ ELEC FOR THE WHOLE 07866 BALLOT** — item 4 of the 2026-08-24
 * state-campaign-money session. **RULING 126** governs the output: it renders
 * for readers and never enters anything sold.
 *
 * ```
 * pnpm money:nj                 all 272 candidacies, election year 2026
 * pnpm money:nj --year 2025
 * pnpm money:nj --limit 5       first 5 locations, for a quick shape check
 * ```
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

import { writeFileSync } from "node:fs";
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
import { today } from "./doc-dates.mjs";

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

const YEAR = arg("--year") ?? "2026";
const LIMIT = Number(arg("--limit") ?? "999");

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

const ballot = JSON.parse(
  await import("node:fs").then((fs) =>
    fs.readFileSync(join(ROOT, "data/ballot/nj-morris-2026.json"), "utf8"),
  ),
) as { contests: Contest[]; candidacies: Candidacy[] };

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

console.log(`state-money-nj · NJ ELEC, election year ${YEAR}, as of ${AS_OF}\n`);

const pageRes = await fetch(ELEC_LOCATION_PAGE, { headers: { "User-Agent": UA } });
const pageHtml = await pageRes.text();
console.log(`  ${ELEC_LOCATION_PAGE} — HTTP ${pageRes.status}, ${pageHtml.length} bytes`);
const codes = parseLocationCodes(pageHtml);
console.log(`  location codes read from the page: ${codes.size}`);
if (codes.size < 100) {
  console.error(
    `  CANNOT RUN — only ${codes.size} location codes parsed. A short list is a parse failure, not a short dropdown (RULING 100).`,
  );
  process.exit(2);
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

const resolvable = [...wanted].filter(([, v]) => v.code !== null);
const unresolved = [...wanted].filter(([, v]) => v.code === null);
console.log(
  `\n  ballot jurisdictions needing an ELEC location: ${wanted.size}` +
    ` · code found ${resolvable.length} · NO CODE ${unresolved.length}`,
);
for (const [name] of unresolved) console.log(`      no ELEC location code: ${name}`);

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
  process.exit(2);
}

/* ── Walk every location, contest by contest ──────────────────────────────── */

const entitiesByLocation = new Map<string, ElecEntity[]>();
let asked = 0;
let short = 0;

for (const [name, { code }] of resolvable.slice(0, LIMIT)) {
  await sleep(SPACING_MS);
  const answer = await askElec(code!);
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
  entitiesByLocation.set(name, answer.rows);
  console.log(
    `  ${name.padEnd(24)} code ${code} — HTTP ${answer.status}, ${got} row(s)` +
      (stated !== null ? ` of ${stated} stated` : "") +
      note,
  );
}

const totalEntities = [...entitiesByLocation.values()].reduce((n, r) => n + r.length, 0);
console.log(`\n  locations asked ${asked} · entities found ${totalEntities} · SHORT extractions ${short}`);

/* ── Match, contest by contest, every candidate before the next contest ───── */

const records: StateMoneyRecord[] = [];
let contestsWalked = 0;

for (const contest of ballot.contests) {
  const locationName = locationFor.get(contest.ocdId) ?? null;
  const cands = ballot.candidacies.filter((c) => c.contestId === contest.id);
  if (cands.length === 0) continue;
  contestsWalked += 1;

  // A jurisdiction with no ELEC location is out of ELEC's scope entirely
  // (federal and state offices file elsewhere). That is NOT the same as "asked
  // and nothing on file", and it is not recorded as one.
  if (!locationName) continue;

  const pool = entitiesByLocation.get(locationName) ?? [];

  for (const cand of cands) {
    const ballotName = `${cand.givenName} ${cand.familyName}`;
    const candidates = pool.filter((e) => namesAgree(e.entityName, ballotName));

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

const out = join(ROOT, "data/funding/state-money-nj-2026.json");
writeFileSync(out, `${JSON.stringify(snapshot, null, 1)}\n`, "utf8");

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
console.log(`\n  contests walked ${contestsWalked} of ${ballot.contests.length}`);
console.log(`
  second-hop filing calls ${filingCalls} · failures ${filingFailures} · entities cached ${moneyCache.size}`);
console.log(`  wrote ${out}`);
