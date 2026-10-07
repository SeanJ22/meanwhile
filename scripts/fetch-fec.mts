/**
 * @freshness-reads-here — each freshness date is taken at the moment of the fetch it describes.
 */
/**
 * Fetch FEC campaign-finance data into the canonical routine civic-data store.
 *
 * The standing routine runner invokes this internal `fec-funding` adapter with
 * `--promote`; owner-initiated production work enters through the installed
 * runtime dispatcher. `--match-only` remains an explicit read-only diagnostic.
 *
 * Reader consumes only a promoted projection; this acquisition script never
 * rewrites the bundled first-bootstrap fixture. The FEC key is read from
 * `.env.local` into THIS script's environment only and never reaches the client
 * (tests/funding.test.ts asserts no runtime file reads FEC_API_KEY).
 *
 * Identifier rule: the run PRINTS the FEC-candidate-id vs roster/ballot-id match rate with
 * denominators BEFORE any adapter fetch. `--match-only` stops there.
 *
 * Match routes, in order of confidence:
 *  - Held FEC keys remain exact-key matches. Newly promoted roster members
 *    enter the same state/office/district-scoped conservative name search.
 *  - Sent congressional districts enumerate financial filers by FEC id.
 *  - Ballot candidates: FEC /candidates/search scoped to state + office +
 *    district + 2026, then surname exact + given-name first-token prefix.
 *    Anything ambiguous or absent is a recorded miss, never a guess.
 *
 * Data classes, tagged on every record:
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
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  FundingSnapshot,
  FundingCandidate,
  FundingAbsence,
  ContributionRow,
  SecondHopCommittee,
} from "../lib/funding/types.ts";
import { promotedCongressTargets, fecDistrictTargets, type FecTarget, type FecSearchCandidate, type FecSearchScope } from "../lib/funding/fec-targets.ts";
import { readFecSendDistricts } from "../lib/funding/fec-send-districts.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { FEDERAL_DIRECTORY_SCOPE, type FederalDirectoryReadModel } from "../lib/officials/federal-directory-data-plane.ts";
import { smallDonorShare } from "../lib/funding/small-donors.ts";
import { stamp } from "./stamp.mts";

import { fecFundingCandidate } from "../lib/civic-data/candidate-builders.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import {
  isSourceAcquisitionFailure,
  publisherDeadlineFailure,
  readPublisherBody,
  recordRegisteredSourceAcquisitionFailure,
  requestPublisher,
  sourceAcquisitionFailure,
  type SourceAcquisitionFailure,
} from "../lib/civic-data/source-acquisition-failure.ts";
import { writeRoutineReceiptLine } from "../lib/civic-data/receipt-output.ts";
import {
  openSourceAcquisitionDomain,
  ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
  sourceAcquisitionSleep,
} from "../lib/sources/acquisition-deadline.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: join(ROOT, ".env.local") });

const API = "https://api.open.fec.gov/v1";
const CYCLE = 2026;
const UA = "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)";
const MATCH_ONLY = process.argv.includes("--match-only");
const PROMOTE = process.argv.includes("--promote");
installNeonRequestDeadline();
const apiKey = process.env.FEC_API_KEY;
if (!PROMOTE && !MATCH_ONLY) {
  throw new Error(
    "The tracked FEC snapshot writer is retired. Run the registered fec-funding contract " +
      "through the installed runtime dispatcher; direct production execution is refused.",
  );
}
if (!apiKey && !MATCH_ONLY) {
  console.error("FEC_API_KEY missing from .env.local — cannot fetch");
  process.exit(1);
}

/* Targets come from the promoted national Congress directory and saved admitted Sends.
 * The prior FEC projection remains a non-regressing floor. FEC searches add
 * financial identities only; election authorities alone establish contests. */
let store: PostgresRoutineDataStore | null = null;
if (PROMOTE) {
  prepareProductionCivicDataWrite();
  store = new PostgresRoutineDataStore();
}

const bundledFec = JSON.parse(
  readFileSync(join(ROOT, "data", "fec", "fec-2026.json"), "utf8"),
) as FundingSnapshot;
const currentFec = store
  ? await store.readPromotion<FundingSnapshot>("FEC_FUNDING", "federal-supported")
  : null;
const targetFloor = currentFec?.payload ?? bundledFec;
// Keep the held target population as the way back until the expanded path
// has been checked live. This changes targets, never budgets.
const upgradeTargets = process.env.WTP_FEC_TARGET_UNIVERSE?.trim().toLowerCase() === "promoted";
const canonicalCongress = store && upgradeTargets
  ? await readPromotedCivicData<FederalDirectoryReadModel>("FEDERAL_DIRECTORY", FEDERAL_DIRECTORY_SCOPE, { store, bypassCache: true }) : null;
if (PROMOTE && upgradeTargets && canonicalCongress?.kind !== "PROMOTED") {
  throw new Error("FEC_TARGET_UNIVERSE_HELD:promoted national congressional membership is unavailable");
}

// The slices of the FEC API's response shapes this script actually reads.
interface FecPrincipalCommittee {
  committee_id?: string;
}
interface FecSearchResult extends FecSearchCandidate {
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
   *  key for the second hop — never a name match. */
  contributor_id?: string | null;
  /** Present when the contributor is itself a registered committee — its
   *  own filed typing. Absent for individuals. */
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
 * Which Schedule A rows are contributions. `/schedules/schedule_a/` returns
 * every receipt, including loan repayments (line 14), expenditure offsets
 * (line 15) and investment income (line 17), none of which funds a campaign.
 * Kept: line 11* (individuals, party committees, other political committees,
 * the candidate), line 12 (transfers from other authorized committees) and 13A
 * (a candidate's loan to their own campaign).
 */
function isContributionLine(lineNumber: string | null): boolean {
  if (!lineNumber) return false;
  return lineNumber.startsWith("11") || lineNumber === "12" || lineNumber === "13A";
}

/** How many top rows either hop keeps after filtering. */
const TOP_N = 5;
/** How many are FETCHED, so filtering does not silently shorten a list. */
const FETCH_N = 20;

let requestCount = 0;
/** Exact FEC response bodies. Only their aggregate hashes are persisted. */
const rawFecBodies: string[] = [];
let lastFecFinalUrl = API + "/";
// The aggregate contract cannot promote around one failed endpoint. Preserve
// the first exact publisher cause so later abort fallout cannot misattribute
// the attempt, and refuse the whole FEC candidate while its LKG stays live.
let fecAcquisitionFailure: SourceAcquisitionFailure | null = null;
function rememberFecSourceFailure(failure: SourceAcquisitionFailure): void {
  fecAcquisitionFailure ??= failure;
}
const fecAcquisitionDomain = openSourceAcquisitionDomain({
  sourceLabel: "FEC OpenFEC",
  timeoutMs: ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
});
function fecSourceFailure(
  code: SourceAcquisitionFailure["code"],
  detail: string,
): SourceAcquisitionFailure {
  const failure = sourceAcquisitionFailure(code, detail);
  rememberFecSourceFailure(failure);
  return failure;
}
async function fecGet<T>(
  path: string,
  params: Record<string, string | number | boolean>,
): Promise<{ results?: T[]; pagination?: { pages?: number; count?: number } }> {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("api_key", apiKey ?? "");
  for (let attempt = 0; attempt < 4; attempt++) {
    requestCount += 1;
    let response: Response;
    try {
      response = await requestPublisher("FEC OpenFEC", () =>
        fetch(url, {
          headers: { "user-agent": UA },
          signal: fecAcquisitionDomain.signal,
        }));
    } catch (error) {
      if (isSourceAcquisitionFailure(error)) rememberFecSourceFailure(error);
      throw error;
    }
    if (response.status === 429) {
      const wait = Number(response.headers.get("retry-after") ?? "30") * 1000;
      console.warn(`  429 — honouring Retry-After ${wait / 1000}s`);
      await sourceAcquisitionSleep(wait, fecAcquisitionDomain.signal);
      continue;
    }
    // A 5xx is the FEC timing out under its own load, not an answer: back
    // off and retry before it can read as "no contributors".
    if (response.status >= 500) {
      const wait = 2000 * (attempt + 1);
      console.warn(`  ${response.status} on ${path} — backing off ${wait / 1000}s and retrying`);
      await sourceAcquisitionSleep(wait, fecAcquisitionDomain.signal);
      continue;
    }
    if (!response.ok) {
      throw fecSourceFailure("PUBLISHER_RESPONSE_REFUSED", `${path} -> HTTP ${response.status}`);
    }
    let text: string;
    try {
      text = await readPublisherBody("FEC OpenFEC", () => response.text());
      fecAcquisitionDomain.assertActive();
    } catch (error) {
      if (isSourceAcquisitionFailure(error)) rememberFecSourceFailure(error);
      throw error;
    }
    const credentialFree = new URL(response.url || url);
    credentialFree.searchParams.delete("api_key");
    lastFecFinalUrl = credentialFree.toString();
    await sourceAcquisitionSleep(250, fecAcquisitionDomain.signal); // serialize politely
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw fecSourceFailure(
        "PUBLISHER_DOCUMENT_INVALID",
        `${path} -> OpenFEC answered with invalid JSON`,
      );
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !("results" in parsed) ||
      !Array.isArray(parsed.results)
    ) {
      throw fecSourceFailure(
        "PUBLISHER_DOCUMENT_INVALID",
        `${path} -> OpenFEC response did not carry a results array`,
      );
    }
    rawFecBodies.push(text);
    return parsed as { results?: T[]; pagination?: { pages?: number; count?: number } };
  }
  throw fecSourceFailure("PUBLISHER_UNAVAILABLE", `${path} -> rate-limited after retries`);
}

// ---- 1. Enumerate the app-side federal targets -----------------------------

type Target = FecTarget;

const targets: Target[] = [];

// Durable LKG is the non-regressing target floor. The bundled snapshot may
// supply it only before the first canonical FEC pointer exists.
for (const held of targetFloor.candidates) {
  for (const targetKey of held.targetKeys) {
    const roster = targetKey.startsWith("congress:");
    const words = held.name.trim().split(/\s+/).filter(Boolean);
    targets.push({
      targetKey,
      displayName: held.name,
      familyName: roster ? null : (words.at(-1) ?? held.name),
      givenName: roster ? null : (words[0] ?? held.name),
      state: held.state,
      office: held.office,
      district: held.district,
      route: roster ? "roster" : "ballot",
      bioguide: roster ? targetKey.replace(/^congress:/, "") : null,
      knownFecCandidateId: held.fecCandidateId,
      knownPrincipalCommitteeId: held.principalCommitteeId,
    });
  }
}

// Every promoted member is independently owed, including a state never held in FEC before.
const byTarget = new Map(targets.map(target => [target.targetKey, target]));
if (canonicalCongress?.kind === "PROMOTED") {
  for (const target of promotedCongressTargets(canonicalCongress.value.roster, targetFloor)) byTarget.set(target.targetKey, target);
}
// Read every page of the scoped FEC list for each district in an existing admitted Send.
// Its own ids remain financial keys; these rows never enter the ballot projection.
if (PROMOTE && upgradeTargets) {
  const sentDistricts = await readFecSendDistricts(new Date().toISOString());
  const scopes: FecSearchScope[] = [...sentDistricts.map(district => ({ ...district, office: "H" as const })),
    ...[...new Set(sentDistricts.map(district => district.state))].map(state => ({ state, office: "S" as const, district: null }))];
  for (const district of scopes) {
    const found: FecSearchResult[] = [];
    let pages = 1, expected: number | null = null;
    for (let page = 1; page <= pages; page++) {
      const result = await fecGet<FecSearchResult>("/candidates/search/", { state: district.state, ...(district.district ? { district: district.district } : {}),
        office: district.office!, cycle: CYCLE, per_page: 100, page });
      if (!Number.isInteger(result.pagination?.pages) || !Number.isInteger(result.pagination?.count)) {
        throw fecSourceFailure("PUBLISHER_DOCUMENT_INVALID", "The sent-district FEC search lacks its pagination denominator");
      }
      if (expected !== null && expected !== result.pagination!.count) throw fecSourceFailure("PUBLISHER_DOCUMENT_INVALID", "The FEC list changed while its pages were read");
      pages = result.pagination!.pages!; expected = result.pagination!.count!;
      found.push(...result.results ?? []);
    }
    if (found.length !== expected) throw fecSourceFailure("PUBLISHER_DOCUMENT_INVALID", "The sent-district FEC candidate list is incomplete");
    for (const target of fecDistrictTargets(district, found)) byTarget.set(target.targetKey, target);
  }
}
targets.splice(0, targets.length, ...byTarget.values());

console.log(`targets enumerated: ${targets.length} (${targets.filter((t) => t.route === "roster").length} roster officials, ${targets.filter((t) => t.route === "ballot").length} ballot candidacies, ${targets.filter((t) => t.route === "fec").length} FEC filers)`);

// ---- 2. The match phase — printed before anything else is fetched ----------

interface Match {
  target: Target;
  fecCandidateId: string;
  matchRoute: string;
  /** Carried straight off the scoped-search result when available. */
  principalCommittees?: FecPrincipalCommittee[];
}
const matches: Match[] = [];
const misses: FundingAbsence[] = [];
// America/Phoenix, never UTC: after 5pm Phoenix a UTC date reads tomorrow.
const today = stamp();

for (const target of targets.filter((row) => row.knownFecCandidateId !== null)) {
  matches.push({
    target,
    fecCandidateId: target.knownFecCandidateId!,
    matchRoute: target.route === "fec" ? "sent-district-fec-id" : "canonical-fec-lkg",
    principalCommittees: target.knownPrincipalCommitteeId
      ? [{ committee_id: target.knownPrincipalCommitteeId }]
      : [],
  });
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

for (const target of targets.filter((row) => row.route !== "fec" && row.knownFecCandidateId === null)) {
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
    // Old registrations ride along in scoped results; the id running THIS
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

// The match report, denominators attached.
const rosterTargets = targets.filter((t) => t.route === "roster").length;
const ballotTargets = targets.filter((t) => t.route === "ballot").length;
const rosterMatched = matches.filter((m) => m.target.route === "roster").length;
const ballotMatched = matches.filter((m) => m.target.route === "ballot").length;
console.log("");
console.log("=== FEC identifier match report ===");
console.log(`roster officials: ${rosterMatched}/${rosterTargets} matched (canonical FEC LKG identities)`);
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
let totalsAcquisitionCount = 0;

for (const [fecId, entry] of byFecId) {
  const name = entry.matches[0].target.displayName;
  process.stdout.write(`${fecId} ${name} … `);

  // Committee-level totals, cycle-to-date. /candidate/{id}/totals returns
  // one row per two-year period; ONLY the 2026 row is accepted. A dormant
  // committee whose last report covered an earlier cycle is an absence with
  // the stale coverage named.
  let totalsRows: FecTotalsRow[] = [];
  try {
    totalsRows =
      (await fecGet<FecTotalsRow>(`/candidate/${fecId}/totals/`, { per_page: 20, sort: "-cycle" }))
        .results ?? [];
    totalsAcquisitionCount += 1;
  } catch (error) {
    console.log(`totals fetch failed: ${(error as Error).message}`);
  }
  const totals = totalsRows.find((r) => r.cycle === CYCLE) ?? null;

  if (!totals) {
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
            // The FEC's entity typing rides along verbatim; the display's
            // plain labels derive from these fields, never from the name.
            entityType: row.entity_type ? String(row.entity_type) : null,
            lineNumber: row.line_number ? String(row.line_number) : null,
            // The contributing committee's own filed typing: the whole basis
            // for the "what kind of money" label (lib/funding/committee-types.ts).
            // Absent on individuals and wherever the FEC did not classify it.
            committeeType: row.contributor?.committee_type
              ? String(row.contributor.committee_type)
              : null,
            organizationType: row.contributor?.organization_type
              ? String(row.contributor.organization_type)
              : null,
            designation: row.contributor?.designation
              ? String(row.contributor.designation)
              : null,
            // The contributing committee's own FEC id, the only basis for the
            // second hop. Absent on individuals.
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
  const unitemized = totals.individual_unitemized_contributions == null ? null : Number(totals.individual_unitemized_contributions);
  const itemized = totals.individual_itemized_contributions == null ? null : Number(totals.individual_itemized_contributions);
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
      individualItemized: itemized,
      individualUnitemized: unitemized,
      /** Unitemized individual contributions (under $200) over total
       *  receipts — the method the surface states in its own words. */
      smallDonorShare: smallDonorShare(itemized, unitemized),
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
// A contributing committee is itself an FEC filer, so who gives to it is read
// from its own Schedule A, fetched once per distinct committee id: its
// registration, its cycle totals and its own top itemized receipts. Every
// committee id on any row is fetched, including conduit ids on individual
// rows; only committee-typed rows render an expander
// (lib/funding/snapshot.ts, secondHopForGroups).

const hopIds = new Set<string>();
for (const candidate of candidates) {
  for (const row of candidate.topContributions) {
    if (row.contributorCommitteeId) hopIds.add(row.contributorCommitteeId);
  }
}

const secondHop: SecondHopCommittee[] = [];
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
      // The same contribution-line rule as the first hop.
      if (!isContributionLine(line) || amount <= 0) {
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

// ---- 4. Build the candidate projection ------------------------------------

// Close the publisher domain before any candidate/pointer/LKG write. Even an
// optional FEC route that swallowed its request error cannot turn an elapsed
// acquisition deadline into a partial successful promotion.
const fecDeadlineFailure = publisherDeadlineFailure("FEC OpenFEC", fecAcquisitionDomain);
fecAcquisitionDomain.dispose();

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

if (PROMOTE) {
  if (!store) throw new Error("FEC_PRODUCTION_STORE_NOT_INITIALIZED");
  if (
    fecDeadlineFailure !== null ||
    fecAcquisitionFailure !== null ||
    rawFecBodies.length === 0 ||
    (byFecId.size > 0 && totalsAcquisitionCount === 0)
  ) {
    if (requestCount === 0) {
      throw new Error("FEC_ACQUISITION_NOT_ATTEMPTED: the adapter had no registered target request to make.");
    }
    const failed = await recordRegisteredSourceAcquisitionFailure({
      store,
      contractId: "fec-funding",
      failure: fecDeadlineFailure ?? fecAcquisitionFailure ?? sourceAcquisitionFailure(
        "PUBLISHER_UNAVAILABLE",
        "No OpenFEC request produced a usable authoritative candidate-totals response.",
      ),
      attemptedAt: snapshot.fetchedAt,
    });
    console.log("");
    console.log("=== routine production-data result ===");
    await writeRoutineReceiptLine(failed.line);
    process.exitCode = 2;
    process.exit();
  }
  const current = currentFec;
  const excludedFacts = misses.map((miss) => ({ code: "UNRESOLVED_FEC_FACT_EXCLUDED", detail: `${miss.targetKey}: ${miss.reason}` }));
  let operational = { ...snapshot, absences: [] } satisfies FundingSnapshot;
  const lkgFloor = current?.payload ?? bundledFec;
  {
    const incoming = new Map(operational.candidates.map((row) => [row.fecCandidateId, row]));
    for (const held of lkgFloor.candidates) {
      const next = incoming.get(held.fecCandidateId);
      const heldThrough = held.totals.coverageEndDate ?? "";
      const nextThrough = next?.totals.coverageEndDate ?? "";
      const regressedCoverage = heldThrough !== "" && (nextThrough === "" || nextThrough < heldThrough);
      if (!next || next.topContributions.length < held.topContributions.length || regressedCoverage) {
        incoming.set(held.fecCandidateId, held);
        excludedFacts.push({
          code: current ? "LKG_FEC_RECORD_RETAINED" : "BOOTSTRAP_FEC_RECORD_RETAINED",
          detail: `${held.fecCandidateId}: the new candidate was absent, thinner, or regressed from coverage ${heldThrough || "unstated"} to ${nextThrough || "unstated"} without bounded replacement/deletion evidence.`,
        });
      }
    }
    const hops = new Map((operational.secondHop ?? []).map((row) => [row.committeeId, row]));
    for (const held of lkgFloor.secondHop ?? []) {
      const next = hops.get(held.committeeId);
      if (!next || next.topContributions.length < held.topContributions.length) hops.set(held.committeeId, held);
    }
    operational = { ...operational, candidates: [...incoming.values()], secondHop: [...hops.values()] };
  }
  const candidate = fecFundingCandidate({ snapshot: operational, rawBodies: rawFecBodies, finalUrl: lastFecFinalUrl, retrievedAt: snapshot.fetchedAt, excludedFacts });
  const outcome = await processRegisteredRoutineCandidate(store, "fec-funding", candidate, snapshot.fetchedAt);
  console.log("");
  console.log("=== routine production-data result ===");
  printSourceRunnerReceipt("fec-funding", candidate, outcome);
  if (!outcome.promoted) process.exitCode = 2;
}
