/**
 * @freshness-reads-here
 *
 * RULING 107 — the clock stamps in this file are minted by the code path that
 * performs the read: the freshness date is taken at the moment of the fetch,
 * which is what the ruling asks for rather than what it forbids. Verified
 * 2026-08-23 by reading each stamp site against the retrieval it sits in.
 */
/**
 * Fetch FEC campaign-finance data into the committed funding snapshot (D34).
 *
 * `pnpm fec:fetch [--match-only]`
 *
 * The snapshot pattern: committed artifact, refreshed by re-running this
 * script, no live FEC calls per page load. The FEC key is read from
 * `.env.local` into THIS script's environment only — it is never wired into
 * the deploy environment and never reaches the client
 * (tests/funding.test.ts asserts no runtime file reads FEC_API_KEY).
 *
 * Identifier rule (the standing rule, and D34's spec verbatim): the run
 * PRINTS the FEC-candidate-id vs roster/ballot-id match rate with
 * denominators BEFORE any adapter fetch. `--match-only` stops there.
 *
 * Match routes, in order of confidence:
 *  - Roster officials: bioguide → FEC candidate id via the public-domain
 *    legislators-current.json (`id.fec`), chamber-checked (H/S id prefix).
 *    An exact-key bridge, not a name match.
 *  - Ballot candidates: FEC /candidates/search scoped to state + office +
 *    district + 2026, then surname exact + given-name first-token prefix.
 *    Anything ambiguous or absent is a recorded miss, never a guess.
 *
 * Data classes, tagged on every record (the ripcord doctrine — a pull is a
 * filter, never a hunt):
 *  - FEC_COMMITTEE: committee-level totals (raised, spent, cash on hand,
 *    small-donor share, cycle-to-date). Not ripcorded.
 *  - FEC_CONTRIBUTOR: top itemized receipts as filed (Schedule A), display
 *    only, behind ripcord.fecContributorDisplay, and NEVER reachable from
 *    the aggregation/export path (guard-tested).
 *
 * Request discipline: serialized, identified User-Agent, Retry-After
 * honoured, ~4 requests per candidate over ~40 candidates.
 */
import { config as loadEnv } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { ballotPath } from "../lib/holdings/files.ts";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  FundingSnapshot,
  FundingCandidate,
  FundingAbsence,
  ContributionRow,
  SecondHopCommittee,
} from "../lib/funding/types.ts";
import { findShrinkRegressions } from "../lib/funding/guard.ts";
import { stamp } from "./stamp.mts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: join(ROOT, ".env.local") });

const OUT = join(ROOT, "data", "fec", "fec-2026.json");
const API = "https://api.open.fec.gov/v1";
const CYCLE = 2026;
const UA = "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)";
const MATCH_ONLY = process.argv.includes("--match-only");
// The human override for a LEGITIMATE shrink (a committee amendment, a
// candidate withdrawal). Using it is a recorded decision: rerun by hand,
// note it in the tracker. The unattended weekly refresh never passes it.
const ALLOW_SHRINK = process.argv.includes("--allow-shrink");

const apiKey = process.env.FEC_API_KEY;
if (!apiKey && !MATCH_ONLY) {
  console.error("FEC_API_KEY missing from .env.local — cannot fetch");
  process.exit(1);
}

// The slices of the FEC API's response shapes this script actually reads.
interface FecPrincipalCommittee {
  committee_id?: string;
}
interface FecSearchResult {
  candidate_id: string;
  name?: string;
  election_years?: number[];
  principal_committees?: FecPrincipalCommittee[];
}
interface FecTotalsRow {
  cycle?: number;
  receipts?: number;
  disbursements?: number;
  last_cash_on_hand_end_period?: number;
  individual_itemized_contributions?: number;
  individual_unitemized_contributions?: number;
  coverage_end_date?: string;
}
interface FecScheduleARow {
  contributor_name?: string;
  contribution_receipt_amount?: number;
  contribution_receipt_date?: string;
  contributor_city?: string;
  contributor_state?: string;
  /** IND, CAN (the candidate), CCM, COM, ORG, PAC, PTY — as filed. */
  entity_type?: string;
  /** Form 3 line number; 13A is loans from the candidate. */
  line_number?: string;
  /** The contributing COMMITTEE's own FEC id, when there is one. The join
   *  key for the second hop (item 3) — never a name match. */
  contributor_id?: string | null;
  /** Present when the contributor is itself a registered committee — its
   *  own filed typing (item 6). Absent for individuals. */
  contributor?: {
    committee_type?: string | null;
    organization_type?: string | null;
    designation?: string | null;
  } | null;
}
interface FecCommitteeDetail {
  committee_id?: string;
  name?: string;
  committee_type?: string | null;
  organization_type?: string | null;
  designation?: string | null;
}
interface FecCommitteeTotalsRow {
  cycle?: number;
  receipts?: number;
}

/**
 * Which Schedule A rows are CONTRIBUTIONS (2026-08-15, found by the item-3
 * line-number census, and it was a live defect).
 *
 * `/schedules/schedule_a/` returns every receipt a committee reports, not
 * every gift. The August snapshot's "Largest reported contributions" list
 * carried four line-14 rows (loan repayments coming BACK to the campaign)
 * and seven line-15 rows (offsets to operating expenditures — a vendor
 * refunding the campaign), and the second hop pulled eight line-17 rows —
 * ActBlue's investment income, which would have rendered as "FIDELITY gave
 * ActBlue $3.7 million". None of those is somebody funding a campaign, and
 * a surface headed "contributions" claiming otherwise is a false claim
 * about real money.
 *
 * Kept: line 11* (individuals, party committees, other political
 * committees, the candidate) and line 12 (transfers from other authorized
 * committees), plus 13A — a candidate's loan to their own campaign, which
 * IS money funding the campaign and already renders as exactly that (D41).
 * Everything else is money moving the other way or not a gift at all.
 */
function isContributionLine(lineNumber: string | null): boolean {
  if (!lineNumber) return false;
  return lineNumber.startsWith("11") || lineNumber === "12" || lineNumber === "13A";
}

/** Dropped rows, counted by line number, so a clip never reads as a clean run. */
const droppedByLine = new Map<string, number>();
function noteDrop(lineNumber: string | null): void {
  const key = lineNumber ?? "(no line filed)";
  droppedByLine.set(key, (droppedByLine.get(key) ?? 0) + 1);
}

/** How many top rows either hop keeps after filtering. */
const TOP_N = 5;
/** How many are FETCHED, so filtering does not silently shorten a list. */
const FETCH_N = 20;

let requestCount = 0;
async function fecGet<T>(
  path: string,
  params: Record<string, string | number | boolean>,
): Promise<{ results?: T[] }> {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("api_key", apiKey ?? "");
  for (let attempt = 0; attempt < 4; attempt++) {
    requestCount += 1;
    const response = await fetch(url, { headers: { "user-agent": UA } });
    if (response.status === 429) {
      const wait = Number(response.headers.get("retry-after") ?? "30") * 1000;
      console.warn(`  429 — honouring Retry-After ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    // A 5xx is the FEC timing out under its own load, not an answer.
    // Mark Kelly's Schedule A returned 504 on 2026-08-15 and again at every
    // page size minutes later returned 200 with the full book — so a single
    // 5xx read as "no contributors" is the Kelly-504 shape arriving through
    // a different door. Backed off and retried, politely, before it is
    // allowed to become a claim about a campaign's donors.
    if (response.status >= 500) {
      const wait = 2000 * (attempt + 1);
      console.warn(`  ${response.status} on ${path} — backing off ${wait / 1000}s and retrying`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);
    await new Promise((r) => setTimeout(r, 250)); // serialize politely
    return response.json() as Promise<{ results?: T[] }>;
  }
  throw new Error(`${path} -> rate-limited after retries`);
}

// ---- 1. Enumerate the app-side federal targets -----------------------------

interface Target {
  /** The app-side id a funding record joins back to. */
  targetKey: string;
  displayName: string;
  /** "LAST" surname for search matching (ballot targets). */
  familyName: string | null;
  givenName: string | null;
  state: string;
  office: "H" | "S";
  district: string | null; // zero-padded 2-digit for House
  route: "roster" | "ballot";
  bioguide: string | null;
}

const targets: Target[] = [];

// Roster officials — senators of the coverage states + the reps for the
// districts the ballot files name (the districts the four zips sit in).
const roster = JSON.parse(
  readFileSync(join(ROOT, "lib", "registry", "officeholders-us.json"), "utf8"),
) as {
  officeholders: {
    id: string;
    name: string;
    officeTitle: string;
    level: string;
  }[];
  divisions: { officeholderId: string; ocdId: string }[];
};

const divisionByHolder = new Map<string, string[]>();
for (const d of roster.divisions) {
  const list = divisionByHolder.get(d.officeholderId) ?? [];
  list.push(d.ocdId);
  divisionByHolder.set(d.officeholderId, list);
}

const HOUSE_DISTRICTS = new Set(["az/cd:6", "az/cd:7", "nj/cd:11", "nh/cd:2"]);

for (const holder of roster.officeholders) {
  const divisions = divisionByHolder.get(holder.id) ?? [];
  for (const ocdId of divisions) {
    const senateMatch = /^ocd-division\/country:us\/state:(az|nj|nh)$/.exec(ocdId);
    const houseMatch = /^ocd-division\/country:us\/state:(az|nj|nh)\/cd:(\d+|at-large)$/.exec(ocdId);
    const isSenate = senateMatch !== null;
    const isCoveredHouse =
      houseMatch !== null && HOUSE_DISTRICTS.has(`${houseMatch[1]}/cd:${houseMatch[2]}`);
    if (!isSenate && !isCoveredHouse) continue;
    const state = (senateMatch?.[1] ?? houseMatch![1]).toUpperCase();
    targets.push({
      targetKey: holder.id,
      displayName: holder.name,
      familyName: null,
      givenName: null,
      state,
      office: isSenate ? "S" : "H",
      district: isSenate ? null : houseMatch![2].padStart(2, "0"),
      route: "roster",
      bioguide: holder.id.replace(/^congress:/, ""),
    });
  }
}

// Ballot candidates — federal contests in the three committed ballot files
// plus the AZ certified-lineup nominees (the surface's own target keys).
const BALLOT_FILES = ["nj-morris-2026.json", "az-pima-2026.json", "nh-merrimack-2026.json"];
for (const file of BALLOT_FILES) {
  const data = JSON.parse(readFileSync(join(ROOT, ballotPath(file)), "utf8")) as {
    contests: { id: string; ocdId: string; type: string }[];
    candidacies: {
      id: string;
      contestId: string;
      familyName: string;
      givenName: string;
    }[];
  };
  for (const contest of data.contests) {
    if (contest.type !== "CANDIDACY") continue;
    // Federal is decided by the CONTEST, never by division shape — a
    // governor's division is the state root exactly like a US Senate
    // seat's, and the first match-only run leaked 30 state candidates
    // into the federal denominator that way. State/local candidates get
    // the state-systems note on the surface, not an FEC search.
    const isSenate = /:us-senate$/.test(contest.id);
    const houseId = /:us-house-(\d+)$/.exec(contest.id);
    if (!isSenate && !houseId) continue;
    const stateMatch = /state:(\w\w)/.exec(contest.ocdId);
    if (!stateMatch) continue;
    const state = stateMatch[1].toUpperCase();
    const houseMatch = houseId;
    for (const cand of data.candidacies.filter((c) => c.contestId === contest.id)) {
      targets.push({
        targetKey: cand.id,
        displayName: `${cand.givenName} ${cand.familyName}`,
        familyName: cand.familyName,
        givenName: cand.givenName,
        state,
        office: isSenate ? "S" : "H",
        district: isSenate ? null : houseMatch![1].padStart(2, "0"),
        route: "ballot",
        bioguide: null,
      });
    }
  }
}

const lineup = JSON.parse(
  readFileSync(join(ROOT, "data", "states", "az", "ballot", "az-general-lineup-2026.json"), "utf8"),
) as { contests: { contestId: string; nominees: { name: string }[] }[] };
for (const contest of lineup.contests) {
  const houseMatch = /us-house-(\d+)$/.exec(contest.contestId);
  if (!houseMatch) continue; // AZ has no federal senate contest in 2026
  for (const nominee of contest.nominees) {
    // Suffixes (Sr., Jr., II…) are not surnames — "Butierez Sr." searched
    // as q=Sr. is how the first run got an HTTP 422 and a false miss.
    const words = nominee.name
      .trim()
      .split(/\s+/)
      .filter((w) => !/^(SR|JR|II|III|IV|V)\.?$/i.test(w));
    targets.push({
      targetKey: `${contest.contestId}|${nominee.name}`,
      displayName: nominee.name,
      familyName: words[words.length - 1].replace(/\.$/, ""),
      givenName: words[0],
      state: "AZ",
      office: "H",
      district: houseMatch[1].padStart(2, "0"),
      route: "ballot",
      bioguide: null,
    });
  }
}

console.log(`targets enumerated: ${targets.length} (${targets.filter((t) => t.route === "roster").length} roster officials, ${targets.filter((t) => t.route === "ballot").length} ballot candidacies)`);

// ---- 2. The match phase — printed before anything else is fetched ----------

// Roster route: the public-domain bridge file, one request, exact keys.
const legislators = JSON.parse(
  await (
    await fetch("https://unitedstates.github.io/congress-legislators/legislators-current.json", {
      headers: { "user-agent": UA },
    })
  ).text(),
) as { id: { bioguide: string; fec?: string[] } }[];
const fecByBioguide = new Map<string, string[]>();
for (const person of legislators) {
  if (person.id.fec) fecByBioguide.set(person.id.bioguide, person.id.fec);
}

interface Match {
  target: Target;
  fecCandidateId: string;
  matchRoute: string;
  /** Carried straight off the scoped-search result when available. */
  principalCommittees?: FecPrincipalCommittee[];
}
const matches: Match[] = [];
const misses: FundingAbsence[] = [];
// America/Phoenix, never UTC. `new Date().toISOString().slice(0, 10)` is the
// obvious one-liner and it is wrong for seven hours out of every twenty-four
// here — after 5pm Phoenix, UTC has already rolled over and every row this
// run writes claims to have been read TOMORROW. Caught 2026-08-15 by the
// walk, which rendered "read 08/16/2026" on the funding card at 6pm local:
// a date nobody could have read, in a provenance field, which is the same
// failure as a generated position wearing a smaller hat. `stamp()` is where
// a script finds out what day it is.
const today = stamp();

for (const target of targets.filter((t) => t.route === "roster")) {
  const ids = fecByBioguide.get(target.bioguide!) ?? [];
  // A person carries one FEC id per office sought; the chamber prefix
  // (H/S) picks the one for the office they hold. Presidential ids (P)
  // never match a congressional target.
  const id = ids.find((i) => i.startsWith(target.office));
  if (id) {
    matches.push({ target, fecCandidateId: id, matchRoute: "bioguide-bridge" });
  } else {
    misses.push({
      targetKey: target.targetKey,
      displayName: target.displayName,
      reason: ids.length
        ? `bridge file lists FEC ids (${ids.join(", ")}) but none for office ${target.office}`
        : "bridge file lists no FEC id for this member",
      checkedAt: today,
      searchUrl: "https://unitedstates.github.io/congress-legislators/legislators-current.json",
    });
  }
}

// Ballot route: scoped FEC candidate search, name-checked, misses recorded.
function normalizeName(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Reuse a roster match when the same person is also a ballot candidate
// (incumbents on the ballot) — keyed on normalized full name + state +
// office, the safest duplicate class since both sides are curated.
const rosterMatchByPerson = new Map<string, string>();
for (const m of matches) {
  rosterMatchByPerson.set(
    `${normalizeName(m.target.displayName)}|${m.target.state}|${m.target.office}`,
    m.fecCandidateId,
  );
}

for (const target of targets.filter((t) => t.route === "ballot")) {
  const personKey = `${normalizeName(target.displayName)}|${target.state}|${target.office}`;
  const viaRoster = rosterMatchByPerson.get(personKey);
  if (viaRoster) {
    matches.push({ target, fecCandidateId: viaRoster, matchRoute: "roster-person-reuse" });
    continue;
  }
  if (MATCH_ONLY && !apiKey) {
    misses.push({
      targetKey: target.targetKey,
      displayName: target.displayName,
      reason: "match-only run without FEC_API_KEY — search not attempted",
      checkedAt: today,
      searchUrl: null,
    });
    continue;
  }
  // Suffix tokens are not name evidence in either direction.
  const stripSuffixes = (s: string) =>
    s
      .split(" ")
      .filter((w) => !/^(SR|JR|II|III|IV|V)$/.test(w))
      .join(" ");
  const familyTokens = stripSuffixes(normalizeName(target.familyName!)).split(" ").filter(Boolean);
  const givenFirst =
    stripSuffixes(normalizeName(target.givenName ?? "")).split(" ")[0] ?? "";

  const params: Record<string, string | number> = {
    q: familyTokens[familyTokens.length - 1] ?? target.familyName!,
    state: target.state,
    office: target.office,
    cycle: CYCLE,
    per_page: 20,
  };
  if (target.district) params.district = target.district;
  let results: FecSearchResult[];
  try {
    results = (await fecGet<FecSearchResult>("/candidates/search/", params)).results ?? [];
  } catch (error) {
    misses.push({
      targetKey: target.targetKey,
      displayName: target.displayName,
      reason: `FEC search failed: ${(error as Error).message}`,
      checkedAt: today,
      searchUrl: null,
    });
    continue;
  }
  let nameMatches = results.filter((r) => {
    // FEC names file as "LAST, FIRST MIDDLE" — but compound surnames
    // ("Tang Williams") and nicknames ("Dan" for DANIEL) both break a
    // position-based comparison, so the check is token-based: every
    // surname token present, and the given name's first token a prefix
    // match against some token. The search is already scoped to state +
    // office + district + cycle, which is what keeps this safe.
    const fecTokens = stripSuffixes(normalizeName(String(r.name ?? ""))).split(" ").filter(Boolean);
    const familyPresent = familyTokens.every((t) => fecTokens.includes(t));
    const givenPresent =
      givenFirst === "" ||
      fecTokens.some((t) => t.startsWith(givenFirst) || givenFirst.startsWith(t));
    return familyPresent && givenPresent;
  });
  if (nameMatches.length > 1) {
    // Old registrations ride along in scoped results (Scott Brown's 2014
    // Senate id beside his 2026 one) — the id actually running THIS
    // election is the one whose election_years says so.
    const thisCycle = nameMatches.filter((r) =>
      Array.isArray(r.election_years) ? r.election_years.includes(CYCLE) : false,
    );
    if (thisCycle.length === 1) nameMatches = thisCycle;
  }
  if (nameMatches.length === 1) {
    matches.push({
      target,
      fecCandidateId: nameMatches[0].candidate_id,
      matchRoute: "scoped-search",
      principalCommittees: nameMatches[0].principal_committees ?? [],
    });
  } else {
    misses.push({
      targetKey: target.targetKey,
      displayName: target.displayName,
      reason:
        nameMatches.length === 0
          ? `no FEC candidate registered matching "${target.displayName}" for ${target.state}-${target.office}${target.district ? target.district : ""} in the ${CYCLE} cycle (${results.length} scoped results checked)`
          : `ambiguous — ${nameMatches.length} FEC candidates match the name even after the election-year filter; refusing to guess`,
      checkedAt: today,
      searchUrl: `https://www.fec.gov/data/candidates/?q=${encodeURIComponent(target.familyName!)}&state=${target.state}`,
    });
  }
}

// The match report — the D34 spec's required print, denominators attached.
const rosterTargets = targets.filter((t) => t.route === "roster").length;
const ballotTargets = targets.filter((t) => t.route === "ballot").length;
const rosterMatched = matches.filter((m) => m.target.route === "roster").length;
const ballotMatched = matches.filter((m) => m.target.route === "ballot").length;
console.log("");
console.log("=== FEC identifier match report ===");
console.log(`roster officials: ${rosterMatched}/${rosterTargets} matched (bioguide bridge)`);
console.log(`ballot candidacies: ${ballotMatched}/${ballotTargets} matched (roster reuse + scoped search)`);
for (const miss of misses) {
  console.log(`  MISS ${miss.targetKey} (${miss.displayName}): ${miss.reason}`);
}
console.log(`requests so far: ${requestCount}`);

if (MATCH_ONLY) process.exit(0);

// ---- 3. Fetch totals + top contributions per matched FEC candidate --------

// One FEC candidate can serve several app-side targets (an incumbent is a
// roster official AND a ballot candidate) — fetch once per FEC id.
const byFecId = new Map<
  string,
  { matches: Match[]; principalCommittees: FecPrincipalCommittee[] }
>();
for (const m of matches) {
  const entry = byFecId.get(m.fecCandidateId) ?? { matches: [], principalCommittees: [] };
  entry.matches.push(m);
  if (m.principalCommittees?.length) entry.principalCommittees = m.principalCommittees;
  byFecId.set(m.fecCandidateId, entry);
}

const candidates: FundingCandidate[] = [];
let totalsHits = 0;
let totalsEmpty = 0;

for (const [fecId, entry] of byFecId) {
  const name = entry.matches[0].target.displayName;
  process.stdout.write(`${fecId} ${name} … `);

  // Committee-level totals, cycle-to-date. /candidate/{id}/totals returns
  // one row per two-year period; ONLY the 2026 row is accepted. A dormant
  // committee whose last report covered an earlier cycle (Fernandez's ran
  // through 2020-11-27) is an absence with the stale coverage named —
  // old money wearing this cycle's label is a false claim.
  let totalsRows: FecTotalsRow[] = [];
  try {
    totalsRows =
      (await fecGet<FecTotalsRow>(`/candidate/${fecId}/totals/`, { per_page: 20, sort: "-cycle" }))
        .results ?? [];
  } catch (error) {
    console.log(`totals fetch failed: ${(error as Error).message}`);
  }
  const totals = totalsRows.find((r) => r.cycle === CYCLE) ?? null;

  if (!totals) {
    totalsEmpty += 1;
    const staleCoverage = totalsRows[0]?.coverage_end_date
      ? ` (last report covered through ${String(totalsRows[0].coverage_end_date).slice(0, 10)})`
      : "";
    console.log(`no ${CYCLE}-cycle totals filed${staleCoverage}`);
    for (const m of entry.matches) {
      misses.push({
        targetKey: m.target.targetKey,
        displayName: name,
        reason: `registered with the FEC (${fecId}) but no financial reports filed for the ${CYCLE} cycle${staleCoverage}`,
        checkedAt: today,
        searchUrl: `https://www.fec.gov/data/candidate/${fecId}/`,
      });
    }
    continue;
  }
  totalsHits += 1;

  // Principal committee id — off the search result when we have it, else
  // one lookup. Needed only for the Schedule A (contributor) queries.
  let pccId: string | null = entry.principalCommittees?.[0]?.committee_id ?? null;
  if (!pccId) {
    try {
      const detail =
        (await fecGet<FecSearchResult>("/candidates/search/", { candidate_id: fecId, per_page: 2 }))
          .results ?? [];
      pccId = detail[0]?.principal_committees?.[0]?.committee_id ?? null;
    } catch {
      pccId = null;
    }
  }

  // Top itemized receipts, exactly as filed — Schedule A sorted by amount,
  // individuals and committees/organizations queried separately. These rows
  // are FEC_CONTRIBUTOR class: display only, ripcorded, never aggregated.
  const contributors: ContributionRow[] = [];
  if (pccId) {
    for (const isIndividual of [true, false]) {
      try {
        const rows =
          (
            await fecGet<FecScheduleARow>("/schedules/schedule_a/", {
              committee_id: pccId,
              two_year_transaction_period: CYCLE,
              sort: "-contribution_receipt_amount",
              is_individual: isIndividual,
              // Fetch deep, filter, then take the top N — so removing a
              // non-contribution row shortens nothing.
              per_page: FETCH_N,
            })
          ).results ?? [];
        const kept: ContributionRow[] = [];
        for (const row of rows) {
          const line = row.line_number ? String(row.line_number) : null;
          const amount = Number(row.contribution_receipt_amount ?? 0);
          if (!isContributionLine(line) || amount <= 0) {
            noteDrop(line);
            continue;
          }
          kept.push({
            dataClass: "FEC_CONTRIBUTOR",
            kind: isIndividual ? "INDIVIDUAL" : "COMMITTEE_OR_ORGANIZATION",
            contributorName: String(row.contributor_name ?? "").trim() || "(name not filed)",
            amount: Number(row.contribution_receipt_amount ?? 0),
            receiptDate: row.contribution_receipt_date
              ? String(row.contribution_receipt_date).slice(0, 10)
              : null,
            city: row.contributor_city ? String(row.contributor_city) : null,
            state: row.contributor_state ? String(row.contributor_state) : null,
            // The FEC's entity typing rides along verbatim — the display's
            // plain labels (2a: "the candidate's own money") derive from
            // these fields mechanically, never from the name.
            entityType: row.entity_type ? String(row.entity_type) : null,
            lineNumber: row.line_number ? String(row.line_number) : null,
            // Item 6 (2026-08-14): the contributing committee's OWN filed
            // typing, carried on the row's `contributor` object. These
            // three fields are the entire mechanical basis for the plain
            // "what kind of money" label (lib/funding/committee-types.ts).
            // Absent on individuals, and absent rather than guessed
            // whenever the FEC did not classify the committee.
            committeeType: row.contributor?.committee_type
              ? String(row.contributor.committee_type)
              : null,
            organizationType: row.contributor?.organization_type
              ? String(row.contributor.organization_type)
              : null,
            designation: row.contributor?.designation
              ? String(row.contributor.designation)
              : null,
            // Item 3 (2026-08-15): the contributing committee's own FEC id,
            // the ONLY basis for the second hop. Absent on individuals.
            contributorCommitteeId: row.contributor_id
              ? String(row.contributor_id)
              : null,
          });
        }
        contributors.push(...kept.slice(0, TOP_N));
      } catch (error) {
        console.log(`  schedule_a (${isIndividual ? "individuals" : "committees"}) failed: ${(error as Error).message}`);
      }
    }
  }

  const receipts = Number(totals.receipts ?? 0);
  const unitemized = Number(totals.individual_unitemized_contributions ?? 0);
  candidates.push({
    dataClass: "FEC_COMMITTEE",
    fecCandidateId: fecId,
    name,
    state: entry.matches[0].target.state,
    office: entry.matches[0].target.office,
    district: entry.matches[0].target.district,
    targetKeys: entry.matches.map((m) => m.target.targetKey),
    matchRoutes: entry.matches.map((m) => m.matchRoute),
    principalCommitteeId: pccId,
    cycle: Number(totals.cycle),
    totals: {
      receipts,
      disbursements: Number(totals.disbursements ?? 0),
      cashOnHand: Number(totals.last_cash_on_hand_end_period ?? 0),
      individualItemized: Number(totals.individual_itemized_contributions ?? 0),
      individualUnitemized: unitemized,
      /** Unitemized individual contributions (under $200) over total
       *  receipts — the method the surface states in its own words. */
      smallDonorShare: receipts > 0 ? unitemized / receipts : null,
      coverageEndDate: totals.coverage_end_date
        ? String(totals.coverage_end_date).slice(0, 10)
        : null,
    },
    topContributions: contributors,
    provenance: {
      sourceUrl: `https://www.fec.gov/data/candidate/${fecId}/`,
      sourceOrg: "Federal Election Commission",
      collectedAt: today,
      verifiedAt: today,
    },
  });
  console.log(
    `cycle ${totals.cycle}: $${Math.round(receipts).toLocaleString()} raised, ${contributors.length} top receipts`,
  );
}

// ---- 3b. The second hop — each contributing committee's own books --------
//
// Item 3 (2026-08-15, the author's design). A joint fundraising committee is
// itself an FEC filer: "who gives to the Booker Victory Fund" is answered by
// the FUND's own Schedule A, one level down, never by inference from this
// candidate's. Fetched once per distinct committee id — the same fund
// appearing on three candidates costs one fetch and stores one record, and
// the distinctness invariant (D40's family) means two ids must never carry
// identical books.
//
// Three requests per committee: its registration (name and filed typing),
// its cycle totals, and its own top itemized receipts.
//
// EVERY committee id on ANY row is fetched, including the conduit ids that
// ride on INDIVIDUAL rows — an individual giving through ActBlue or a PAC's
// earmark files with that committee's id attached. Those hops are stored
// but never rendered: only committee-typed rows get an expander
// (lib/funding/snapshot.ts, secondHopForGroups), because "who gives to the
// committee this person's cheque passed through" is a different question
// from the one the tea button asks. Fetching them anyway keeps the run's
// denominator equal to the ids the data actually contains, which is what
// the thin guard compares against run to run.

const hopIds = new Set<string>();
for (const candidate of candidates) {
  for (const row of candidate.topContributions) {
    if (row.contributorCommitteeId) hopIds.add(row.contributorCommitteeId);
  }
}

const secondHop: SecondHopCommittee[] = [];
let hopEmpty = 0;
console.log("");
console.log(`=== second hop: ${hopIds.size} distinct contributing committees ===`);

for (const committeeId of hopIds) {
  process.stdout.write(`  ${committeeId} … `);
  let detail: FecCommitteeDetail | null = null;
  try {
    detail =
      (await fecGet<FecCommitteeDetail>(`/committee/${committeeId}/`, { per_page: 1 }))
        .results?.[0] ?? null;
  } catch (error) {
    console.log(`registration fetch failed: ${(error as Error).message}`);
    continue;
  }
  if (!detail) {
    console.log("no FEC registration returned — skipped, nothing invented");
    continue;
  }

  let receipts: number | null = null;
  try {
    const rows =
      (await fecGet<FecCommitteeTotalsRow>(`/committee/${committeeId}/totals/`, {
        cycle: CYCLE,
        per_page: 5,
      })).results ?? [];
    const row = rows.find((r) => r.cycle === CYCLE) ?? null;
    receipts = row ? Number(row.receipts ?? 0) : null;
  } catch {
    receipts = null; // Stated as unknown rather than guessed at zero.
  }

  const hopRows: ContributionRow[] = [];
  try {
    const rows =
      (
        await fecGet<FecScheduleARow>("/schedules/schedule_a/", {
          committee_id: committeeId,
          two_year_transaction_period: CYCLE,
          sort: "-contribution_receipt_amount",
          per_page: FETCH_N,
        })
      ).results ?? [];
    for (const row of rows) {
      if (hopRows.length >= TOP_N) break;
      const line = row.line_number ? String(row.line_number) : null;
      const amount = Number(row.contribution_receipt_amount ?? 0);
      // The same contribution-line rule as the first hop. Without it,
      // ActBlue's escrow interest (line 17, filed under "FIDELITY") would
      // render as its three biggest donors.
      if (!isContributionLine(line) || amount <= 0) {
        noteDrop(line);
        continue;
      }
      hopRows.push({
        dataClass: "FEC_CONTRIBUTOR",
        kind: row.entity_type === "IND" ? "INDIVIDUAL" : "COMMITTEE_OR_ORGANIZATION",
        contributorName: String(row.contributor_name ?? "").trim() || "(name not filed)",
        amount: Number(row.contribution_receipt_amount ?? 0),
        receiptDate: row.contribution_receipt_date
          ? String(row.contribution_receipt_date).slice(0, 10)
          : null,
        city: row.contributor_city ? String(row.contributor_city) : null,
        state: row.contributor_state ? String(row.contributor_state) : null,
        entityType: row.entity_type ? String(row.entity_type) : null,
        lineNumber: row.line_number ? String(row.line_number) : null,
        committeeType: row.contributor?.committee_type
          ? String(row.contributor.committee_type)
          : null,
        organizationType: row.contributor?.organization_type
          ? String(row.contributor.organization_type)
          : null,
        designation: row.contributor?.designation
          ? String(row.contributor.designation)
          : null,
        contributorCommitteeId: row.contributor_id ? String(row.contributor_id) : null,
      });
    }
  } catch (error) {
    console.log(`schedule_a failed: ${(error as Error).message}`);
  }

  if (hopRows.length === 0) hopEmpty += 1;
  secondHop.push({
    dataClass: "FEC_CONTRIBUTOR",
    committeeId,
    name: String(detail.name ?? "").trim() || committeeId,
    committeeType: detail.committee_type ? String(detail.committee_type) : null,
    organizationType: detail.organization_type ? String(detail.organization_type) : null,
    designation: detail.designation ? String(detail.designation) : null,
    topContributions: hopRows,
    receipts,
    provenance: {
      sourceUrl: `https://www.fec.gov/data/committee/${committeeId}/`,
      sourceOrg: "Federal Election Commission",
      collectedAt: today,
      verifiedAt: today,
    },
  });
  console.log(`${detail.name ?? "(unnamed)"} — ${hopRows.length} top receipts`);
}

// ---- 4. Write the snapshot, counts stated --------------------------------

const snapshot: FundingSnapshot = {
  formatVersion: 1,
  fetchedAt: new Date().toISOString(),
  cycle: CYCLE,
  matchReport: {
    rosterMatched,
    rosterTotal: rosterTargets,
    ballotMatched,
    ballotTotal: ballotTargets,
  },
  candidates,
  absences: misses,
  secondHop,
};

// ---- The thin-snapshot guard (session brief 2, wall clock 2026-08-14) ----
// Compare against the last committed snapshot BEFORE writing. A shrink —
// fewer candidates, a vanished candidate, a retained candidate with fewer
// contributor rows (the Kelly-504 shape) — fails the run and keeps the old
// snapshot, loudly. The weekly workflow surfaces the nonzero exit; a human
// reruns with --allow-shrink only after confirming the FEC-side reason,
// and records the decision in the tracker.
let prior: FundingSnapshot | null = null;
try {
  prior = JSON.parse(readFileSync(OUT, "utf8")) as FundingSnapshot;
} catch {
  prior = null; // First run ever — nothing to shrink from.
}
if (prior) {
  const regressions = findShrinkRegressions(prior, snapshot);
  if (regressions.length > 0) {
    console.error("");
    console.error("=== THIN SNAPSHOT — the guard refuses to ship it ===");
    for (const r of regressions) console.error(`  [${r.kind}] ${r.detail}`);
    if (!ALLOW_SHRINK) {
      console.error("");
      console.error(
        `keeping the prior snapshot (${prior.candidates.length} candidates, ` +
          `${prior.candidates.reduce((n, c) => n + c.topContributions.length, 0)} contributor rows). ` +
          "If the shrink is real (amendment, withdrawal), a human reruns with " +
          "--allow-shrink and records the decision in docs/tracker.csv.",
      );
      process.exit(1);
    }
    console.error("");
    console.error(
      "--allow-shrink passed: shipping the smaller snapshot on human authority. Record it in the tracker.",
    );
  }
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(snapshot, null, 1)}\n`);

console.log("");
console.log("=== snapshot written ===");
console.log(`candidates with totals: ${totalsHits}/${byFecId.size} matched FEC ids (${totalsEmpty} registered-but-no-filings)`);
console.log(`contributor rows: ${candidates.reduce((n, c) => n + c.topContributions.length, 0)} across ${candidates.filter((c) => c.topContributions.length > 0).length} candidates`);
console.log(
  `second hop: ${secondHop.length}/${hopIds.size} committees fetched, ` +
    `${secondHop.reduce((n, c) => n + c.topContributions.length, 0)} rows, ` +
    `${hopEmpty} committee(s) returned no itemized receipts (recorded, not rendered)`,
);
// A deliberate clip must not read as a failure, and a real failure must not
// read as a clip (CLAUDE.md): every dropped row is counted by the line
// number it was dropped for.
const droppedTotal = [...droppedByLine.values()].reduce((n, v) => n + v, 0);
console.log(
  `non-contribution receipts dropped: ${droppedTotal} ` +
    `(${[...droppedByLine.entries()].sort().map(([line, n]) => `line ${line}: ${n}`).join(", ") || "none"}) ` +
    `— loan repayments, vendor offsets and investment income are not gifts`,
);
console.log(`absences recorded: ${misses.length}`);
console.log(`total FEC requests: ${requestCount}`);
console.log(OUT);
