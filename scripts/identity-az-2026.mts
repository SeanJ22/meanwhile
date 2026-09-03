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
 * ACQUISITION   scripts/acquire-az-sos-candidate-filings.mts — the Secretary of
 *               State's COMPLETE 2026 partisan candidate filing list, and
 *               scripts/state-money-az.mts — the SeeTheMoney corpus. Neither
 *               depends on 85701 or 85641
 * IDENTITY      THIS SCRIPT — one candidate/contest registry over the acquired
 *               source universe, and the certified-canvass reconciliation into it
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

import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
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

/**
 * **THE POPULATION IS THE SECRETARY OF STATE'S FILING LIST, NOT PIMA COUNTY'S
 * BALLOT.** (Session C final, lane 1, 2026-09-01. R-C9.)
 *
 * This registry called itself STATEWIDE from the day it was written and its
 * population was `data/states/az/ballot/az-pima-2026.json` — 15 contests and 55
 * candidacies from ONE COUNTY'S certified general-election ballot. The key had
 * no ZIP in it, so it looked statewide; the population had one county in it, so
 * it was not. R-C9 names that exactly: *"'No ZIP in the key' is a property of
 * the key, not of the population."*
 *
 * The population is now `data/states/az/candidates/az-2026-sos-candidate-filings.json` —
 * the Secretary of State's complete partisan candidate filing list for the 2026
 * primary, 76 contests and 266 candidacies, acquired by
 * `pnpm acquire:az-sos-candidates`. That is the authority's COMPLETE APPLICABLE
 * UNIVERSE for the offices it is the filing officer for, which is what the word
 * "statewide" now stands on.
 *
 * **The Pima ballot is still read, and it is read for exactly one thing.** Every
 * campaign-finance record this project holds is keyed to `ballot-az-pima:*`
 * candidacy ids, and a card asks the money corpus with that key. The corpus
 * carries the join it made — `heldIdentityJoin.heldCandidacyId` — so
 * `canonicalCandidacyId` stays the held id for all 55 people who have one, and
 * the money a reader can see today does not move. Re-keying the registry
 * without that would have taken working money off working cards.
 */
interface CorpusContest {
  id: string;
  ocdId: string;
  title: string;
  level: "FEDERAL" | "STATE";
  publishedTitle: string;
  provenance: { sourceUrl: string; sourceOrg: string; collectedAt: string };
}
interface CorpusCandidacy {
  id: string;
  contestId: string;
  familyName: string;
  givenName: string;
  partyLabel: string;
  publishedName: string;
  heldIdentityJoin: { heldCandidacyId: string } | null;
  provenance: { sourceUrl: string; sourceOrg: string; collectedAt: string };
}
interface CorpusDoc {
  retrieval: { url: string; retrievedAt: string; sha256: string; byteLength: number };
  applicableUniverse: { describes: string; contests: number; candidacies: number };
  authority: { name: string; documentTitle: string };
  contests: CorpusContest[];
  candidacies: CorpusCandidacy[];
}

const corpusPath = join(ROOT, "data", "states", "az", "candidates", "az-2026-sos-candidate-filings.json");
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as CorpusDoc;
if (corpus.candidacies.length === 0 || corpus.contests.length === 0) {
  throw new Error(
    `${corpusPath} parsed and holds zero contests or zero candidacies. That is a FAILED read of the ` +
      "Secretary of State's corpus, never an election with no candidates. Nothing is written.",
  );
}

const pima = JSON.parse(
  readFileSync(join(ROOT, "data", "states", "az", "ballot", "az-pima-2026.json"), "utf8"),
) as { contests: BallotContest[]; candidacies: BallotCandidacy[] };

/*
 * The corpus, expressed in the shape this script already reasons about. The
 * contest id a candidacy points at is the CORPUS contest id; the pilot contest
 * ids are attached below as additional `canonicalContestIds`, which is what the
 * certified-lineup file (keyed `ballot-az-pima:*`) resolves through.
 */
const ballot = {
  contests: corpus.contests.map((c) => ({
    id: c.id,
    title: c.title,
    type: "CANDIDACY",
    ocdId: c.ocdId,
    provenance: c.provenance,
  })) as BallotContest[],
  candidacies: corpus.candidacies.map((c) => ({
    id: c.id,
    /* The held `ballot-az-pima:*` id, or null. This is the key the campaign-money
       corpus is written against, and it is the ONLY thing that may be used as
       `canonicalCandidacyId`. Minting one for a candidate no held ballot names
       would hand the projection layer a key nothing can answer. */
    heldId: c.heldIdentityJoin?.heldCandidacyId ?? null,
    contestId: c.contestId,
    familyName: c.familyName,
    givenName: c.givenName,
    partyLabel: c.partyLabel,
    provenance: c.provenance,
  })) as (BallotCandidacy & { heldId: string | null })[],
};

/** The pilot contest a corpus contest is the same office as, by division AND title. */
const pilotContestIdByCorpusId = new Map<string, string>();
for (const c of corpus.contests) {
  const match = pima.contests.find(
    (p) => p.type === "CANDIDACY" && p.ocdId === c.ocdId && p.title === c.title,
  );
  if (match) pilotContestIdByCorpusId.set(c.id, match.id);
}
const lineup = JSON.parse(
  readFileSync(join(ROOT, "data", "states", "az", "ballot", "az-general-lineup-2026.json"), "utf8"),
) as LineupFile;
const money = JSON.parse(
  readFileSync(join(ROOT, "data", "states", "az", "funding", "state-money-az-2026.json"), "utf8"),
) as StateMoneySnapshot;
const financeReconciliation = JSON.parse(
  readFileSync(join(ROOT, "data", "states", "az", "campaign-finance", "az-seethemoney-2026-reconciliation.json"), "utf8"),
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

const contests: AzContestIdentity[] = candidacyContests.map((c) => {
  const pilotId = pilotContestIdByCorpusId.get(c.id);
  return {
    identityId: `az-${CYCLE}:contest:${contestSlug(c.id)}`,
    office: c.title,
    ocdId: c.ocdId,
    level: isFederalContestId(c.id) ? "FEDERAL" : "STATE",
    financeFilingAuthority: isFederalContestId(c.id)
      ? FEDERAL_FINANCE_AUTHORITY
      : STATE_FINANCE_AUTHORITY,
    /*
     * The certified county ballot's id FIRST where one exists, then the
     * Secretary's. Both are canonical names for one contest and every consumer
     * that resolves a contest looks the id up in a map of all of them — but
     * `scripts/state-money-az.mts:419` takes `canonicalContestIds[0]` as THE
     * contest id for a projection candidacy, and every campaign-money record
     * this project holds is written against the ballot ids. Putting the
     * Secretary's id first would have silently re-keyed the money projection
     * while every other number stayed the same.
     */
    canonicalContestIds: pilotId ? [pilotId, c.id] : [c.id],
  };
});
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
  /* The corpus candidacy id is `<contestId>:<person-slug>`. Taking the tail off
     the CORPUS id keeps the identity key stable whether or not a held ballot
     also names this person. */
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
    /*
     * NULL WHERE NO HELD BALLOT NAMES THIS PERSON, and that is deliberate.
     * `canonicalCandidacyId` is the key `lib/funding/nominee-money.ts` asks the
     * campaign-money corpus with, and that corpus is written against
     * `ballot-az-pima:*`. 211 of the 266 candidates the Secretary lists are not
     * on any ballot this project holds, so there is no such key for them. A
     * fabricated one would report RECONCILED and answer nothing.
     */
    canonicalCandidacyId: cand.heldId,
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

/**
 * The two reasons a registry candidate has no held-ballot key, kept apart.
 *
 * They used to be one number printed as "canvass-only", which was true when the
 * population was one county's ballot and every candidate without a key really
 * had come from the canvass. Against the Secretary's filing list it is false
 * for 211 of the 213, and a reader of the run would have concluded that 213
 * write-in nominees exist.
 */
const canvassOnlyIdentityIds = new Set(
  candidates.filter((c) => c.candidacyAuthority === CANVASS_AUTHORITY).map((c) => c.identityId),
);
const filingListWithoutHeldBallot = candidates.filter(
  (c) => c.canonicalCandidacyId === null && !canvassOnlyIdentityIds.has(c.identityId),
).length;

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
      url: corpus.retrieval.url,
      readAt: corpus.retrieval.retrievedAt,
      note:
        `${corpus.authority.documentTitle} — acquired as a corpus at ` +
        `data/states/az/candidates/az-2026-sos-candidate-filings.json (${corpus.retrieval.byteLength} B, ` +
        `sha256 ${corpus.retrieval.sha256}). THE REGISTRY'S POPULATION. ` +
        corpus.applicableUniverse.describes,
    },
    {
      name: "Pima County certified general-election ballot",
      url: pima.candidacies[0]?.provenance?.sourceUrl ?? null,
      readAt: pima.candidacies[0]?.provenance?.collectedAt ?? AS_OF,
      note:
        "NOT the population. Read for one thing only: the held `ballot-az-pima:*` candidacy keys the " +
        "campaign-money corpus is written against, carried onto the 55 registry candidates the " +
        "Secretary's list and this ballot both name.",
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
      name: "data/states/az/identity/az-2026-candidate-registry.json",
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

/*
 * **THE DENOMINATOR FLOORS (RULING 159).**
 *
 * Every number this script prints is a count over a population, and a
 * population that came back empty is a FAILED READ of an input file, never a
 * measurement of Arizona. `floored` refuses a zero denominator outright, so a
 * registry that silently lost its candidates cannot print `0 reconciled` and
 * pass for a finished run — which is the shape that would then be committed as
 * a bridge answering nothing, on cards that used to render money.
 */
const registryFloor = floored(
  "registry candidates carrying a held-ballot candidacy key",
  "data/states/az/candidates/az-2026-sos-candidate-filings.json, the Secretary of State's 2026 partisan filing list",
  candidates.length,
  candidates.filter((c) => c.canonicalCandidacyId !== null).length,
);
const contestFloor = floored(
  "candidacy contests carried into the registry",
  "the Secretary of State's filing-list contests",
  ballot.contests.length,
  contests.length,
);
const lineupFloor = floored(
  "certified-lineup nominees uniquely reconciled",
  "data/states/az/ballot/az-general-lineup-2026.json, the certified primary canvass",
  result.proof.lineupNominees,
  result.proof.uniquelyReconciled,
);
const applicableFloor = floored(
  "applicable non-federal nominees reconciled",
  "the certified lineup's non-federal contests",
  result.proof.applicableNonFederalNominees,
  result.proof.applicableNonFederalReconciled,
);

console.log(`Arizona ${CYCLE} identity layer — ${AS_OF}${DRY ? " (dry run)" : ""}`);
console.log(`\n  FLOORED COUNTS (RULING 159 — both numbers, or a refusal)`);
for (const line of [registryFloor, contestFloor, lineupFloor, applicableFloor]) {
  console.log(`    ${floorLine(line)}`);
}
console.log(
  `\n  REGISTRY — population acquired from ${corpus.authority.name}'s complete applicable universe` +
    `\n  (${corpus.applicableUniverse.candidacies} candidacies, ${corpus.applicableUniverse.contests} contests, ` +
    `no ZIP and no county in the derivation)`,
);
console.log(`    contests                              ${registry.denominators.contests}`);
console.log(`    candidates known                      ${registry.denominators.candidates}`);
console.log(`      with a held-ballot candidacy key    ${registry.denominators.candidatesWithCanonicalCandidacyId}`);
console.log(
  `      without one                         ${registry.denominators.candidatesWithoutCanonicalCandidacyId}` +
    `  (${filingListWithoutHeldBallot} on the filing list and on no ballot this project holds; ` +
    `${canvassOnly} named only by the certified canvass)`,
);
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
  const dir = join(ROOT, "data", "states", "az", "identity");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "az-2026-candidate-registry.json"), `${JSON.stringify(registry, null, 1)}\n`, "utf8");
  writeFileSync(
    join(dir, "az-2026-certified-lineup-reconciliation.json"),
    `${JSON.stringify(bridge, null, 1)}\n`,
    "utf8",
  );
  console.log("\n  wrote data/states/az/identity/az-2026-candidate-registry.json");
  console.log("  wrote data/states/az/identity/az-2026-certified-lineup-reconciliation.json");
}
