/**
 * **THE ARIZONA 2026 STATEWIDE CANDIDATE IDENTITY REGISTRY, AND THE CERTIFIED-
 * LINEUP BRIDGE INTO IT.** (Session C3, 2026-09-01. RULING 229.)
 *
 * ```
 *   pnpm identity:az           write both artifacts and print the proof
 *   pnpm identity:az --dry     compute and print, write nothing
 * ```
 *
 * ## The defect this closes, measured before it was written
 *
 * Arizona's certified general-election lineup renders its cards keyed
 * `${contestId}|${nomineeName}`. The state campaign-money snapshot keys its
 * records to canonical CANDIDACY ids. Nothing joined the two, so
 * `stateMoneyForTarget("ballot-az-pima:governor:hobbs-katie")` returned Katie
 * Hobbs' FILED $11,109,719.95 while HER OWN CARD asked by name and got nothing.
 *
 * On rendered DOM, 2026-09-01, against a local production build of
 * 9703dc9d: **85701 — 24 candidate cards, 22 of them non-federal, 4 with a
 * money state. 85641 — 29 cards, 25 non-federal, 4 with a money state.** The
 * other eighteen and twenty-one read *"We don't hold a campaign finance filing
 * for this person"*, which was false about us over money we held.
 *
 * ## Three layers, and this script is the middle one (RULING 229)
 *
 * ```
 * ACQUISITION   scripts/state-money-az.mts — the STATEWIDE SeeTheMoney corpus,
 *               with no dependency on 85701 or 85641
 * IDENTITY      THIS SCRIPT — one statewide candidate/contest registry, and the
 *               certified-canvass reconciliation into it
 * PROJECTION    lib/funding/nominee-money.ts — a card asks the corpus about a
 *               candidacy the registry named
 * ```
 *
 * A reader's ZIP may prioritise acquisition ORDER. It may never define the
 * DENOMINATOR, and nothing in this file is filtered by one.
 *
 * ## What licenses a mapping
 *
 * All four, or the row stays unresolved and the card renders an honest gap:
 * contest identity agrees; party agrees where both authorities state it; the
 * name evidence resolves UNIQUELY to exactly one candidate; and the row records
 * both authorities' published values and the annotation rule that matched.
 * `lib/identity/reconcile.ts` is the rule and `lib/identity/name-forms.ts` is
 * the parse. **There is no similarity score anywhere in this path.**
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { nameFormCollisions, reconcileLineup } from "../lib/identity/reconcile.ts";
import { nameForms } from "../lib/identity/name-forms.ts";
import type {
  AzCandidateIdentity,
  AzContestIdentity,
  AzIdentityRegistry,
  LineupReconciliation,
} from "../lib/identity/types.ts";
import type { StateMoneySnapshot } from "../lib/funding/state-money.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const AS_OF = today();
const DRY = process.argv.includes("--dry");
const CYCLE = 2026;

const FILING_LIST_AUTHORITY = "Arizona Secretary of State — candidate filings";
const CANVASS_AUTHORITY = "Arizona Secretary of State — certified primary canvass";
const STATE_FINANCE_AUTHORITY = "Arizona Secretary of State — See The Money";
const FEDERAL_FINANCE_AUTHORITY = "Federal Election Commission";

/* -------------------------------------------------------------------------
 * INPUTS. Every one of them is an Arizona election authority's own publication
 * or a measurement taken from one. None of them is a ZIP.
 * ------------------------------------------------------------------------- */

interface BallotCandidacy {
  id: string;
  contestId: string;
  familyName: string;
  givenName: string;
  partyLabel: string | null;
  provenance: { sourceUrl: string | null; sourceOrg: string; collectedAt: string };
}
interface BallotContest {
  id: string;
  title: string;
  type: string;
  ocdId: string;
  provenance: { sourceUrl: string | null; sourceOrg: string; collectedAt: string };
}
interface LineupFile {
  canvass: { title: string; url: string; issuedBy: string; reportDate: string; readAt: string };
  contests: { contestId: string; nominees: { name: string; partyLabel: string | null }[] }[];
}

const ballot = JSON.parse(
  readFileSync(join(ROOT, "data", "ballot", "az-pima-2026.json"), "utf8"),
) as { contests: BallotContest[]; candidacies: BallotCandidacy[] };
const lineup = JSON.parse(
  readFileSync(join(ROOT, "data", "ballot", "az-general-lineup-2026.json"), "utf8"),
) as LineupFile;
const money = JSON.parse(
  readFileSync(join(ROOT, "data", "funding", "state-money-az-2026.json"), "utf8"),
) as StateMoneySnapshot;
const financeReconciliation = JSON.parse(
  readFileSync(join(ROOT, "data", "campaign-finance", "az-seethemoney-2026-reconciliation.json"), "utf8"),
) as { nextFilingDeadline: { reportName: string; filingPeriodEndDate: string } | null };

/* -------------------------------------------------------------------------
 * CONTEST IDENTITY. Statewide keys, never `az-pima` ones — the office of
 * Governor is not a Pima County fact and must not be keyed as though it were.
 * ------------------------------------------------------------------------- */

/** Federal is decided by the CONTEST, exactly as `app/ballot/page.tsx` decides it. */
function isFederalContestId(contestId: string): boolean {
  return /:us-senate$|:us-house-\d+$/.test(contestId);
}

/** The canonical contest id's tail — `ballot-az-pima:governor` -> `governor`. */
function contestSlug(contestId: string): string {
  const at = contestId.indexOf(":");
  return at === -1 ? contestId : contestId.slice(at + 1);
}

const candidacyContests = ballot.contests.filter((c) => c.type === "CANDIDACY");

const contests: AzContestIdentity[] = candidacyContests.map((c) => ({
  identityId: `az-${CYCLE}:contest:${contestSlug(c.id)}`,
  office: c.title,
  ocdId: c.ocdId,
  level: isFederalContestId(c.id) ? "FEDERAL" : "STATE",
  financeFilingAuthority: isFederalContestId(c.id)
    ? FEDERAL_FINANCE_AUTHORITY
    : STATE_FINANCE_AUTHORITY,
  canonicalContestIds: [c.id],
}));
const contestIdentityByCanonical = new Map(
  contests.flatMap((c) => c.canonicalContestIds.map((id) => [id, c])),
);

/* -------------------------------------------------------------------------
 * CANDIDATE IDENTITY. Two authorities, and the registry names who each one
 * says exists. A candidate the canvass stars as a write-in winner and the
 * filing list never carried is STILL a 2026 Arizona candidate; leaving them out
 * of the registry would be the registry asserting an absence.
 * ------------------------------------------------------------------------- */

const candidates: AzCandidateIdentity[] = [];
const seenIdentityIds = new Set<string>();

function addCandidate(c: AzCandidateIdentity): void {
  if (seenIdentityIds.has(c.identityId)) {
    throw new Error(`duplicate identity id ${c.identityId} — the registry key is not unique`);
  }
  seenIdentityIds.add(c.identityId);
  candidates.push(c);
}

for (const cand of ballot.candidacies) {
  const contest = contestIdentityByCanonical.get(cand.contestId);
  if (!contest) continue;
  const displayName = `${cand.givenName} ${cand.familyName}`.replace(/\s+/g, " ").trim();
  const tail = cand.id.slice(cand.contestId.length + 1);
  addCandidate({
    identityId: `az-${CYCLE}:${contestSlug(cand.contestId)}:${tail}`,
    contestIdentityId: contest.identityId,
    displayName,
    givenName: cand.givenName,
    familyName: cand.familyName,
    nameForms: nameForms(displayName),
    partyLabel: cand.partyLabel,
    candidacyAuthority: FILING_LIST_AUTHORITY,
    candidacySourceUrl: cand.provenance?.sourceUrl ?? null,
    canonicalCandidacyId: cand.id,
    committees: [],
  });
}

/*
 * THE CANVASS-ONLY CANDIDATES.
 *
 * Arizona's certified canvass stars write-in primary winners who never appear
 * on the March candidate-filing list. They exist, they are on the November
 * ballot, and the filing list is what this project keys campaign committees
 * from — so they enter the registry WITH A NULL CANONICAL CANDIDACY ID rather
 * than with an invented one. A key no authority published is a fabrication, and
 * the projection layer would then be joining on it.
 */
const filingListKeys = new Map<string, Set<string>>();
for (const cand of candidates) {
  const set = filingListKeys.get(cand.contestIdentityId) ?? new Set<string>();
  for (const f of cand.nameForms) set.add(f.form);
  filingListKeys.set(cand.contestIdentityId, set);
}
let canvassOnly = 0;
for (const contest of lineup.contests) {
  const identity = contestIdentityByCanonical.get(contest.contestId);
  if (!identity) continue;
  const known = filingListKeys.get(identity.identityId) ?? new Set<string>();
  for (const nominee of contest.nominees) {
    const forms = nameForms(nominee.name);
    if (forms.some((f) => known.has(f.form))) continue;
    canvassOnly += 1;
    addCandidate({
      identityId: `az-${CYCLE}:${contestSlug(contest.contestId)}:canvass-${forms[0].form.replace(/[^a-z0-9]+/g, "-")}`,
      contestIdentityId: identity.identityId,
      displayName: nominee.name,
      givenName: null,
      familyName: null,
      nameForms: forms,
      partyLabel: nominee.partyLabel,
      candidacyAuthority: CANVASS_AUTHORITY,
      candidacySourceUrl: lineup.canvass.url,
      canonicalCandidacyId: null,
      committees: [],
    });
  }
}

/* THE COMMITTEE IDENTITIES, attached from the finance corpus by canonical
   candidacy id — never by name. This is the join the identity layer exists to
   make explicit rather than to perform at render time. */
const byCanonicalCandidacy = new Map(
  candidates.filter((c) => c.canonicalCandidacyId).map((c) => [c.canonicalCandidacyId!, c]),
);
for (const record of money.records) {
  if (!record.committeeId) continue;
  for (const key of record.targetKeys) {
    const cand = byCanonicalCandidacy.get(key);
    if (!cand) continue;
    if (cand.committees.some((c) => c.committeeId === record.committeeId)) continue;
    cand.committees.push({
      committeeId: record.committeeId,
      registeredName: record.registeredName,
      agency: record.agency,
      basis: record.match.note,
    });
  }
}

/* -------------------------------------------------------------------------
 * THE COLLISION CHECK, over the whole registry.
 * ------------------------------------------------------------------------- */

const collisions = nameFormCollisions(candidates);

/* -------------------------------------------------------------------------
 * THE RECONCILIATION, over the WHOLE lineup population.
 * ------------------------------------------------------------------------- */

const nominees = lineup.contests.flatMap((c) =>
  c.nominees.map((n) => ({ contestId: c.contestId, name: n.name, partyLabel: n.partyLabel })),
);

const result = reconcileLineup({
  nominees,
  /* The pool is the candidates the PROJECTION can key. A canvass-only candidate
     is in the registry and is deliberately not here: matching a nominee to an
     identity with no canonical candidacy id would report RECONCILED and hand
     the renderer nothing to ask with. */
  candidates: candidates.filter((c) => c.canonicalCandidacyId !== null),
  candidateContestIds: new Map(contests.map((c) => [c.identityId, c.canonicalContestIds])),
  isFederalContestId,
  agencyName: STATE_FINANCE_AUTHORITY,
});

if (result.collidingTargets.length > 0) {
  /* Two nominees resolving to one candidacy would put one person's money under
     another person's photograph. There is no election-model reason for it in
     Arizona 2026 — one candidacy is one person in one contest — so it is an
     ERROR and the artifacts are not written. */
  console.error("DUPLICATE TARGET COLLISIONS — refusing to write:");
  for (const c of result.collidingTargets) {
    console.error(`  ${c.canonicalCandidacyId} <- ${c.cardKeys.join(" , ")}`);
  }
  process.exit(1);
}

/* -------------------------------------------------------------------------
 * THE ARTIFACTS
 * ------------------------------------------------------------------------- */

const registry: AzIdentityRegistry = {
  formatVersion: 1,
  state: "AZ",
  cycle: CYCLE,
  generatedAt: AS_OF,
  generatedBy: "pnpm identity:az (scripts/identity-az-2026.mts)",
  sources: [
    {
      name: FILING_LIST_AUTHORITY,
      url: ballot.candidacies[0]?.provenance?.sourceUrl ?? null,
      readAt: ballot.candidacies[0]?.provenance?.collectedAt ?? AS_OF,
      note: "Every candidate who filed for the 2026 primary, as the Secretary of State lists them. The candidacy rows this project keys campaign committees from.",
    },
    {
      name: CANVASS_AUTHORITY,
      url: lineup.canvass.url,
      readAt: lineup.canvass.readAt,
      note: lineup.canvass.title,
    },
    {
      name: STATE_FINANCE_AUTHORITY,
      url: "https://seethemoney.az.gov/",
      readAt: money.collectedAt,
      note: "Committee identities, attached by canonical candidacy id rather than by name.",
    },
  ],
  denominators: {
    contests: contests.length,
    candidates: candidates.length,
    candidatesWithCanonicalCandidacyId: candidates.filter((c) => c.canonicalCandidacyId).length,
    candidatesWithoutCanonicalCandidacyId: candidates.filter((c) => !c.canonicalCandidacyId).length,
    candidatesWithCommitteeIdentity: candidates.filter((c) => c.committees.length > 0).length,
    nonFederalCandidates: candidates.filter((c) => {
      const contest = contests.find((x) => x.identityId === c.contestIdentityId);
      return contest ? contest.level !== "FEDERAL" : false;
    }).length,
    federalCandidates: candidates.filter((c) => {
      const contest = contests.find((x) => x.identityId === c.contestIdentityId);
      return contest ? contest.level === "FEDERAL" : false;
    }).length,
  },
  contests,
  candidates,
};

const bridge: LineupReconciliation & {
  financeAuthority: {
    agency: string;
    filingsUrl: string;
    snapshotCollectedAt: string;
  };
  nameFormCollisions: typeof collisions;
} = {
  formatVersion: 1,
  state: "AZ",
  cycle: CYCLE,
  generatedAt: AS_OF,
  generatedBy: "pnpm identity:az (scripts/identity-az-2026.mts)",
  sources: [
    { name: CANVASS_AUTHORITY, url: lineup.canvass.url, readAt: lineup.canvass.readAt, note: lineup.canvass.title },
    {
      name: "data/identity/az-2026-candidate-registry.json",
      url: null,
      readAt: AS_OF,
      note: "The statewide identity registry this bridge resolves INTO.",
    },
  ],
  proof: result.proof,
  agencyNextFilingDue: financeReconciliation.nextFilingDeadline,
  financeAuthority: {
    agency: STATE_FINANCE_AUTHORITY,
    filingsUrl: "https://seethemoney.az.gov/",
    snapshotCollectedAt: money.collectedAt,
  },
  nameFormCollisions: collisions,
  rows: result.rows,
};

/* -------------------------------------------------------------------------
 * THE PROOF, PRINTED — every number with its denominator.
 * ------------------------------------------------------------------------- */

console.log(`Arizona ${CYCLE} identity layer — ${AS_OF}${DRY ? " (dry run)" : ""}`);
console.log(`\n  REGISTRY (statewide, no ZIP anywhere in it)`);
console.log(`    contests                              ${registry.denominators.contests}`);
console.log(`    candidates known                      ${registry.denominators.candidates}`);
console.log(`      with a canonical candidacy id       ${registry.denominators.candidatesWithCanonicalCandidacyId}`);
console.log(`      without one (canvass-only)          ${registry.denominators.candidatesWithoutCanonicalCandidacyId}`);
console.log(`      with a committee identity           ${registry.denominators.candidatesWithCommitteeIdentity}`);
console.log(`    non-federal / federal                 ${registry.denominators.nonFederalCandidates} / ${registry.denominators.federalCandidates}`);
console.log(`    within-contest name-form collisions   ${collisions.length}`);

const p = result.proof;
console.log(`\n  CERTIFIED-LINEUP RECONCILIATION (population, not examples)`);
console.log(`    lineup contests                       ${p.lineupContests}`);
console.log(`    lineup nominees                       ${p.lineupNominees}`);
console.log(`    uniquely reconciled                   ${p.uniquelyReconciled}`);
console.log(`    ambiguous or conflicting              ${p.ambiguous}`);
console.log(`    unmatched                             ${p.unmatched}`);
console.log(`    duplicate-target collisions           ${p.duplicateTargetCollisions}`);
console.log(`    applicable non-federal nominees       ${p.applicableNonFederalNominees}`);
console.log(`      reconciled                          ${p.applicableNonFederalReconciled}`);
console.log(`      unresolved (render an honest gap)   ${p.applicableNonFederalUnresolved}`);

console.log(`\n  EVERY UNRESOLVED ROW, BY NAME`);
for (const row of result.rows.filter((r) => r.outcome !== "RECONCILED")) {
  console.log(`    ${row.outcome.padEnd(30)} ${row.contestId} | ${row.nomineeName}`);
  console.log(`      ${row.basis.note}`);
}

if (DRY) {
  console.log("\n  --dry: nothing written.");
} else {
  const dir = join(ROOT, "data", "identity");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "az-2026-candidate-registry.json"), `${JSON.stringify(registry, null, 1)}\n`, "utf8");
  writeFileSync(
    join(dir, "az-2026-certified-lineup-reconciliation.json"),
    `${JSON.stringify(bridge, null, 1)}\n`,
    "utf8",
  );
  console.log("\n  wrote data/identity/az-2026-candidate-registry.json");
  console.log("  wrote data/identity/az-2026-certified-lineup-reconciliation.json");
}
