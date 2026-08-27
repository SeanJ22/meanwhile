/**
 * THE LEAD LIFECYCLE — the motion from a link to a body, with its evidence.
 * (2026-08-26, the descent-resume session. **RULING 183**.)
 *
 * `lib/workstate/types.ts` declared `CandidateState` on 2026-08-26 and
 * `workstream.ts` has validated its invariants ever since. **Nothing ever
 * performed a transition.** No file in `lib/` or `scripts/` wrote
 * `ENTITY_VERIFIED` or `BODY_PROMOTED`, and `scripts/descent.mts` never wrote
 * an `EntityCandidate` at all — it collected `work.discovered[]` in memory,
 * printed it to `descent-candidates.md`, and dropped it.
 *
 * The consequence was measurable and it was measured: every one of the 1,672
 * candidates in canonical state arrived from `workstream-migrate.mts` parsing
 * that markdown once. The coverage numerator was 0 in all three states, and it
 * was 0 *by construction* — a walk could run forever without moving it.
 *
 * This is the same defect as the audit's Finding 4 one layer up: a state
 * machine that only ever describes, on a store nothing writes to. The fix is
 * the same shape as RULING 181's — **the transition is persisted by the run
 * that earns it**, not counted and summarised.
 *
 * ## The three motions, and what each one costs
 *
 * `recordCandidate`   a link the detector named. Free. Proves nothing.
 * `classifyCandidate` triage against evidence already held. Cheap, offline.
 * `promoteCandidate`  a registry id. Requires evidence that was FETCHED.
 *
 * A lead may skip no step, and `promoteCandidate` refuses without both an
 * `ENTITY_VERIFIED` predecessor state and a registry id — because
 * `workstream.ts:384` is right that a `BODY_PROMOTED` without one is a lead
 * wearing a body's name.
 */

import { candidateId } from "./frontier.ts";
import type { CandidateState, EntityCandidate } from "./types.ts";
import type { Workstream } from "./workstream.ts";

/**
 * Every row carrying this candidate id.
 *
 * **There is legitimately more than one.** `candidateId` hashes the URL and
 * the text and deliberately not the tier, because the same entity named at two
 * tiers is one entity — and `workstream-migrate.mts` wrote a row per SIGHTING,
 * so canonical state holds 1 such pair in New Jersey and 10 in Arizona. The
 * New Jersey one is the Legislature, seen from the state tier and again from
 * the statewide-districts tier.
 *
 * Both rows are worth keeping: each carries its own `fromEdge`, so the pair
 * records that two independent routes reached the same government, which is
 * exactly the kind of thing RULING 178 wants remembered about a route.
 *
 * What may NOT happen is the two rows disagreeing about what the entity is. A
 * verdict is about the ENTITY, so it lands on every row that names it.
 */
function rowsFor(w: Workstream, id: string): EntityCandidate[] {
  return w.candidates.filter((c) => c.id === id);
}

/** What a classification motion may move a lead to without opening the page. */
export type OfflineVerdict = Extract<
  CandidateState,
  "DUPLICATE" | "REJECTED_FALSE_POSITIVE" | "NEEDS_CLASSIFICATION" | "ENTITY_CANDIDATE"
>;

export interface RecordCandidateInput {
  readonly state: string;
  readonly tier: string;
  readonly url: string;
  readonly text: string;
  /** The edge that named it. Provenance is never reconstructed (RULING 181). */
  readonly fromEdge: string;
  readonly discoveredOn: string;
}

/**
 * Record a lead in canonical state, in the pass that found it.
 *
 * Idempotent on `(jurisdiction, tier, url, text)`: a second walk of the same
 * directory re-finds the same links, and re-recording them must not inflate the
 * denominator or reset a classification somebody already earned.
 */
export function recordCandidate(
  w: Workstream,
  input: RecordCandidateInput,
): { readonly id: string; readonly isNew: boolean } {
  const id = candidateId(input.state, input.tier, input.url, input.text);
  const existing = w.candidates.find((c) => c.id === id);
  if (existing) return { id, isNew: false };
  w.candidates.push({
    id,
    state: "ENTITY_CANDIDATE",
    text: input.text,
    url: input.url,
    fromEdge: input.fromEdge,
    jurisdiction: input.state,
    tier: input.tier,
    discoveredOn: input.discoveredOn,
  });
  return { id, isNew: true };
}

/**
 * Triage a lead against evidence the project already holds.
 *
 * Every terminal verdict carries its reason **as free text written by the
 * caller**, never a code this module invents: `rejectedReason` is read by a
 * person deciding whether the detector is calibrated, and "excluded by rule 7"
 * tells them nothing. Section 17's calibration duty depends on that string.
 *
 * A rejection is knowledge, not deletion (RULING 88). The row stays, with its
 * URL, its provenance edge and its reason, so a later method version can reopen
 * it — which is exactly what RULING 178 requires of a conclusion reached under
 * an older detector.
 */
export function classifyCandidate(
  w: Workstream,
  id: string,
  verdict: OfflineVerdict,
  reason: string,
): EntityCandidate {
  const rows = rowsFor(w, id);
  if (rows.length === 0) throw new Error(`classifyCandidate: no candidate ${id}`);
  if (rows.some((c) => c.state === "BODY_PROMOTED")) {
    throw new Error(`classifyCandidate: ${id} is already a promoted body; demotion is its own motion`);
  }
  if (!reason.trim()) {
    throw new Error(`classifyCandidate: ${id} -> ${verdict} with no reason; an unexplained verdict is not a verdict`);
  }
  for (const c of rows) {
    c.state = verdict;
    if (verdict === "REJECTED_FALSE_POSITIVE") c.rejectedReason = reason;
    else c.evidence = reason;
  }
  return rows[0];
}

/**
 * Move a lead to `ENTITY_VERIFIED` on evidence that was actually retrieved.
 *
 * `evidence` must name what was fetched and what in it settled the question.
 * A 200 is not evidence (section 17, RULING 100): the caller passes the control
 * it checked, and this refuses an empty one.
 */
export function verifyCandidate(w: Workstream, id: string, evidence: string): EntityCandidate {
  const rows = rowsFor(w, id);
  if (rows.length === 0) throw new Error(`verifyCandidate: no candidate ${id}`);
  if (!evidence.trim()) {
    throw new Error(`verifyCandidate: ${id} with no evidence; ENTITY_VERIFIED is a claim and claims carry sources`);
  }
  for (const c of rows) {
    c.state = "ENTITY_VERIFIED";
    c.evidence = evidence;
  }
  return rows[0];
}

/**
 * Promote a verified entity to a body, and record the registry id it became.
 *
 * **Only this raises coverage.** The two refusals below are the whole point of
 * the type: a promotion without a registry id is a lead with a better label,
 * and a promotion that skipped verification is a detector's opinion.
 */
export function promoteCandidate(w: Workstream, id: string, bodyId: string): EntityCandidate {
  const rows = rowsFor(w, id);
  if (rows.length === 0) throw new Error(`promoteCandidate: no candidate ${id}`);
  const notVerified = rows.find((c) => c.state !== "ENTITY_VERIFIED");
  if (notVerified) {
    throw new Error(
      `promoteCandidate: ${id} is ${notVerified.state}; a body is promoted from ENTITY_VERIFIED, never straight from a lead`,
    );
  }
  if (!bodyId.trim()) {
    throw new Error(`promoteCandidate: ${id} with no registry id — that is a lead, not a body`);
  }
  for (const c of rows) {
    c.state = "BODY_PROMOTED";
    c.bodyId = bodyId;
  }
  return rows[0];
}

/** The three-way split, for a caller that wants it without the accounting type. */
export function unclassified(w: Workstream): readonly EntityCandidate[] {
  return w.candidates.filter(
    (c) => c.state === "ENTITY_CANDIDATE" || c.state === "NEEDS_CLASSIFICATION",
  );
}
