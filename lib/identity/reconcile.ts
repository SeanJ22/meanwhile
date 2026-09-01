/**
 * **RECONCILING THE CERTIFIED LINEUP INTO THE STATEWIDE IDENTITY REGISTRY.**
 * (Session C3, 2026-09-01. RULING 229.)
 *
 * One pure function, run over the WHOLE lineup population by the generator and
 * by `tests/az-identity-reconciliation.test.ts` alike, so the committed artifact
 * and the test cannot disagree about what the rule is.
 *
 * ## A mapping is emitted only when ALL FOUR hold
 *
 * 1. **Contest identity agrees.** The nominee's contest and the candidate's
 *    contest are the same contest. A name is never compared across contests,
 *    which is what makes a shared surname harmless.
 * 2. **Party agrees where both authorities provide it.** Where either side is
 *    silent the check is recorded as not applicable rather than as a pass.
 * 3. **The candidate identity evidence resolves UNIQUELY to exactly one
 *    candidate.** Two matches is `AMBIGUOUS_MULTIPLE_CANDIDATES`, not a
 *    tie-break. Zero is `NO_CANDIDATE_MATCH`, not a search for the nearest.
 * 4. **The mapping records its source values and its reconciliation basis** —
 *    both published names, both published parties, the shared name form and the
 *    annotation rule that produced it. A mapping nobody can check is a guess
 *    with a schema.
 *
 * **Never choose the closest person.** There is no similarity number anywhere
 * in this file, and `lib/identity/name-forms.ts` says why at length: a wrong
 * join puts one candidate's fundraising under their opponent's photograph.
 */

import { nameForms, normalizeNameText, sharedNameForm } from "./name-forms.ts";
import type {
  AzCandidateIdentity,
  LineupOutcome,
  LineupReconciliationRow,
} from "./types.ts";

/**
 * Party equality, folded only in ways that are symmetric and reversible.
 *
 * Case and spacing are folded, and a trailing standalone word `party` is
 * dropped so `Green` and `Green Party` are one label. Nothing else: `No Labels`
 * and `Arizona Independent Party` are two different recognised Arizona parties
 * and no rule here may quietly make them one.
 */
export function normalizeParty(label: string | null | undefined): string | null {
  if (label == null) return null;
  const folded = normalizeNameText(label).toLowerCase().replace(/\s+party$/, "").trim();
  return folded.length > 0 ? folded : null;
}

export interface LineupNomineeInput {
  contestId: string;
  name: string;
  partyLabel: string | null;
}

export interface ReconcileInput {
  /** Every nominee on the certified lineup, in lineup order. */
  nominees: readonly LineupNomineeInput[];
  /** The statewide registry's candidates. */
  candidates: readonly AzCandidateIdentity[];
  /**
   * Registry contest identity -> the canonical contest ids it serves, inverted
   * for the caller so this function never has to know the projection's shape.
   */
  candidateContestIds: ReadonlyMap<string, string[]>;
  /** Which canonical contest ids the state campaign-finance regime applies to. */
  isFederalContestId: (contestId: string) => boolean;
  /** The agency's own next filing deadline, for the unresolved rows to carry. */
  agencyName: string;
}

export interface ReconcileResult {
  rows: LineupReconciliationRow[];
  proof: {
    lineupContests: number;
    lineupNominees: number;
    uniquelyReconciled: number;
    ambiguous: number;
    unmatched: number;
    duplicateTargetCollisions: number;
    applicableNonFederalNominees: number;
    applicableNonFederalReconciled: number;
    applicableNonFederalUnresolved: number;
  };
  /** Which canonical candidacy ids two or more nominees both resolved to. */
  collidingTargets: { canonicalCandidacyId: string; cardKeys: string[] }[];
}

function gapSentence(outcome: LineupOutcome, agencyName: string): string {
  if (outcome === "NO_CANDIDATE_MATCH") {
    return (
      `Arizona's certified canvass names this nominee, and the candidate-filing list we key ` +
      `campaign committees from does not carry them, so we have not established which ` +
      `${agencyName} filing is theirs.`
    );
  }
  if (outcome === "PARTY_CONFLICT") {
    return (
      `Arizona's certified canvass and the Secretary of State's candidate-filing list state ` +
      `different parties for the only matching name, so we have not established that they ` +
      `are the same candidacy.`
    );
  }
  return (
    `More than one filed candidacy in this contest carries this name, and we have not ` +
    `established which one the certified canvass means.`
  );
}

export function reconcileLineup(input: ReconcileInput): ReconcileResult {
  const { nominees, candidates, candidateContestIds, isFederalContestId, agencyName } = input;

  /* Candidates indexed by every canonical contest id their contest serves.
     Built once — a per-nominee scan over the whole registry would give the same
     answer and would hide how the contest gate actually works. */
  const byContest = new Map<string, AzCandidateIdentity[]>();
  for (const cand of candidates) {
    for (const contestId of candidateContestIds.get(cand.contestIdentityId) ?? []) {
      const list = byContest.get(contestId);
      if (list) list.push(cand);
      else byContest.set(contestId, [cand]);
    }
  }

  const rows: LineupReconciliationRow[] = [];
  for (const nominee of nominees) {
    const cardKey = `${nominee.contestId}|${nominee.name}`;
    const pool = byContest.get(nominee.contestId) ?? [];

    /* CRITERION 3, and it runs before every other one: which candidates in
       THIS contest share an exact name form with this nominee. */
    const matches = pool
      .map((cand) => ({ cand, shared: sharedNameForm(nominee.name, cand.displayName) }))
      .filter((m) => m.shared !== null);

    const nomineeParty = normalizeParty(nominee.partyLabel);

    let outcome: LineupOutcome;
    let chosen: AzCandidateIdentity | null = null;
    let sharedForm: { form: string; rules: string[] } | null = null;
    let partyChecked = false;
    let partyAgrees: boolean | null = null;
    let note: string;

    if (matches.length === 0) {
      outcome = "NO_CANDIDATE_MATCH";
      note =
        `no candidate in ${nominee.contestId} shares an exact name form with the canvass name; ` +
        `${pool.length} candidate(s) were compared and no diminutive was inferred`;
    } else if (matches.length > 1) {
      outcome = "AMBIGUOUS_MULTIPLE_CANDIDATES";
      note =
        `${matches.length} candidates in ${nominee.contestId} share an exact name form ` +
        `(${matches.map((m) => m.cand.identityId).join(", ")}); no tie-break is permitted`;
    } else {
      const only = matches[0];
      const registryParty = normalizeParty(only.cand.partyLabel);
      partyChecked = nomineeParty !== null && registryParty !== null;
      partyAgrees = partyChecked ? nomineeParty === registryParty : null;
      if (partyChecked && partyAgrees === false) {
        outcome = "PARTY_CONFLICT";
        chosen = null;
        note =
          `one name match, and the two authorities disagree on party ` +
          `(canvass "${nominee.partyLabel}" vs filing list "${only.cand.partyLabel}")`;
      } else {
        outcome = "RECONCILED";
        chosen = only.cand;
        note = partyChecked
          ? `contest, party and an exact name form all agree`
          : `contest and an exact name form agree; only one authority stated a party, so the party test does not apply`;
      }
      sharedForm = { form: only.shared!.form, rules: only.shared!.rules };
    }

    rows.push({
      cardKey,
      contestId: nominee.contestId,
      nomineeName: nominee.name,
      nomineePartyLabel: nominee.partyLabel,
      outcome,
      candidateIdentityId: chosen?.identityId ?? null,
      canonicalCandidacyId: chosen?.canonicalCandidacyId ?? null,
      sourceValues: {
        canvassName: nominee.name,
        canvassParty: nominee.partyLabel,
        registryName: matches.length === 1 ? matches[0].cand.displayName : null,
        registryParty: matches.length === 1 ? matches[0].cand.partyLabel : null,
        registryCandidateIds: matches.map((m) => m.cand.identityId),
      },
      basis: {
        contestAgrees: true,
        partyChecked,
        partyAgrees,
        sharedNameForm: sharedForm?.form ?? null,
        sharedNameFormRules: sharedForm?.rules ?? [],
        note,
      },
      readerGapSentence: outcome === "RECONCILED" ? null : gapSentence(outcome, agencyName),
    });
  }

  /* DUPLICATE TARGETS. Two nominees resolving to one candidacy would put one
     person's money on another's card, so it is counted and it is an error. */
  const byTarget = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.canonicalCandidacyId) continue;
    const list = byTarget.get(row.canonicalCandidacyId);
    if (list) list.push(row.cardKey);
    else byTarget.set(row.canonicalCandidacyId, [row.cardKey]);
  }
  const collidingTargets = [...byTarget.entries()]
    .filter(([, keys]) => keys.length > 1)
    .map(([canonicalCandidacyId, cardKeys]) => ({ canonicalCandidacyId, cardKeys }));

  const nonFederal = rows.filter((r) => !isFederalContestId(r.contestId));
  return {
    rows,
    proof: {
      lineupContests: new Set(nominees.map((n) => n.contestId)).size,
      lineupNominees: rows.length,
      uniquelyReconciled: rows.filter((r) => r.outcome === "RECONCILED").length,
      ambiguous: rows.filter(
        (r) => r.outcome === "AMBIGUOUS_MULTIPLE_CANDIDATES" || r.outcome === "PARTY_CONFLICT",
      ).length,
      unmatched: rows.filter((r) => r.outcome === "NO_CANDIDATE_MATCH").length,
      duplicateTargetCollisions: collidingTargets.length,
      applicableNonFederalNominees: nonFederal.length,
      applicableNonFederalReconciled: nonFederal.filter((r) => r.outcome === "RECONCILED").length,
      applicableNonFederalUnresolved: nonFederal.filter((r) => r.outcome !== "RECONCILED").length,
    },
    collidingTargets,
  };
}

/**
 * WITHIN ONE CONTEST, DO TWO CANDIDATES SHARE A NAME FORM?
 *
 * Run by the generator and by the suite over the whole registry. A collision
 * here is not automatically wrong — two people really can share a name — but it
 * means every nominee matching that form must come out AMBIGUOUS, and a rule
 * change that silently stopped producing collisions would be a rule change that
 * started guessing.
 */
export function nameFormCollisions(
  candidates: readonly AzCandidateIdentity[],
): { contestIdentityId: string; form: string; candidateIds: string[] }[] {
  /* U+241F, the SYMBOL FOR UNIT SEPARATOR — a printable character no published
     name or identity id contains. A literal NUL here would work and would also
     make this file binary to ripgrep, so a class sweep would report nothing
     found without having looked. */
  const SEP = "␟";
  const seen = new Map<string, string[]>();
  for (const cand of candidates) {
    for (const form of nameForms(cand.displayName)) {
      const key = `${cand.contestIdentityId}${SEP}${form.form}`;
      const list = seen.get(key);
      if (list) list.push(cand.identityId);
      else seen.set(key, [cand.identityId]);
    }
  }
  return [...seen.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, candidateIds]) => {
      const at = key.indexOf(SEP);
      return { contestIdentityId: key.slice(0, at), form: key.slice(at + 1), candidateIds };
    });
}
