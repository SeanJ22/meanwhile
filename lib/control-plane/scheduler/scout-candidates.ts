/**
 * **FROM A SCOUT'S ROUTE CANDIDATE TO THE METHOD-CANDIDATE STORE.**
 * (Level 1 activation, 2026-09-01. RULING 240.)
 *
 * Models handle novelty; code handles learned procedure. The bridge is the
 * EXISTING candidate lifecycle in `lib/method/candidate.ts` —
 * `PROPOSED -> VALIDATED -> ADMITTED | REJECTED` — and this module drives only
 * its first two steps. A Scout PROPOSES; the prospective store is VALIDATED
 * against the canonical validators; the record lands in
 * `data/method/candidates.json` as VALIDATED or REJECTED with the exact
 * issues. **Nothing here calls `markAdmitted` or `writeMethodStore`.**
 * Admission is graduation, and graduation is a session's act under the
 * existing method:learn path with independent repetition — the Scout may
 * never promote its own proposal.
 *
 * Only a candidate whose URL the Attempt actually OPENED (an artifact with
 * that canonical URL) is proposed: a route the method store learns carries an
 * outcome in a jurisdiction, and a URL merely observed on a page has none.
 * The rest stay on the typed Scout result, marked unverified.
 */

import { join } from "node:path";

import {
  candidateCounts,
  introducedIssues,
  markRejected,
  markValidated,
  proposeCandidate,
  readCandidateStore,
  readMethodStore,
  writeCandidateStore,
  type CandidateLifecycle,
} from "../../method/candidate.ts";
import { learnBatch, type LearnedRoute } from "../../method/learn-batch.ts";
import type { WorkArtifact } from "./dispatch.ts";
import type { ScoutCandidate, ScoutResult } from "./scout-result.ts";

export const CANDIDATE_STORE = ["data", "method", "candidates.json"] as const;
export const METHOD_STORE = ["data", "method", "knowledge.json"] as const;

export interface ProposedCandidate {
  readonly routeId: string;
  readonly candidateId: string;
  readonly lifecycle: CandidateLifecycle;
  readonly issues: readonly string[];
  readonly already: boolean;
}

export interface ProposalReport {
  readonly proposed: readonly ProposedCandidate[];
  /** Candidates left on the result only, with the reason each was not proposed. */
  readonly notProposed: readonly { readonly routeId: string; readonly why: string }[];
  readonly counts: Record<CandidateLifecycle, number>;
  readonly storeVersionObserved: number;
}

/** The LearnedRoute shape the store accepts, built from what the Scout actually showed. */
export function learnedRouteFrom(
  c: ScoutCandidate,
  result: Pick<ScoutResult, "attemptId" | "obligationId" | "subjectId">,
  openedArtifacts: readonly WorkArtifact[],
): LearnedRoute {
  const evidence = [...new Set([...c.evidenceArtifactIds, ...openedArtifacts.map((a) => a.artifactId)])];
  let host = c.url;
  try {
    host = new URL(c.url).host;
  } catch {
    /* keep the raw identity */
  }
  return {
    id: c.routeId,
    title: c.title,
    /* An official host's own publication is A1; anything else is B until a session says otherwise. */
    tier: /\.gov$|\.us$|\.state\./i.test(host) ? "A1" : "B",
    fields: [c.recordClass],
    note:
      `${c.relevance} Permission: ${c.permission} — ${c.permissionReading}. Procedure: ${c.procedure}. ` +
      `Evidence artifacts: ${evidence.join(", ")}. Unverified: ${c.unverified.join("; ") || "nothing stated"}.`,
    origin: `SCOUT Attempt ${result.attemptId} on ${result.obligationId}, observed ${c.observedOn}`,
    outcome: {
      jurisdiction: result.subjectId,
      rows: openedArtifacts.length,
      outcome: "YIELDED",
      note: `the candidate URL was opened in the Attempt and vaulted as ${openedArtifacts.map((a) => a.artifactId).join(", ")}`,
    },
    claims: [
      {
        id: `${c.routeId}#exists`,
        class: "ROUTE_EXISTENCE",
        statement: `${c.url} answered to an identified public client on ${c.observedOn}; evidence ${evidence.join(", ")}`,
        restsOn: [],
      },
    ],
  };
}

/**
 * Propose and VALIDATE every openable candidate on a result. Writes the
 * candidate store; never the method store. Idempotent by derived candidate id.
 */
export function proposeScoutCandidates(input: {
  readonly root: string;
  readonly result: ScoutResult;
  readonly artifacts: readonly WorkArtifact[];
  readonly stamp: string;
}): ProposalReport {
  const candidatePath = join(input.root, ...CANDIDATE_STORE);
  const methodPath = join(input.root, ...METHOD_STORE);
  const knowledge = readMethodStore(methodPath);
  let store = readCandidateStore(candidatePath);
  const proposed: ProposedCandidate[] = [];
  const notProposed: { routeId: string; why: string }[] = [];
  let wrote = false;

  for (const c of input.result.candidates) {
    const opened = input.artifacts.filter((a) => a.canonicalUrl === c.url);
    if (opened.length === 0) {
      notProposed.push({ routeId: c.routeId, why: "the candidate URL was not opened in this Attempt, so no outcome exists to learn" });
      continue;
    }
    if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(c.routeId)) {
      notProposed.push({ routeId: c.routeId, why: "the proposed route id is not a kebab-case identifier" });
      continue;
    }
    const proposal = learnedRouteFrom(c, input.result, opened);
    const offered = proposeCandidate(store, {
      attemptId: input.result.attemptId,
      proposal,
      submittedAt: input.stamp,
      observedMethodVersion: knowledge.version,
    });
    store = offered.store;
    if (offered.already) {
      proposed.push({ routeId: c.routeId, candidateId: offered.candidate.id, lifecycle: offered.candidate.lifecycle, issues: [], already: true });
      continue;
    }
    wrote = true;
    /* Validate the PROSPECTIVE store, exactly as admission would, and record the verdict. */
    let issues: string[] = [];
    try {
      const prospective = learnBatch(knowledge, [proposal], input.stamp).knowledge;
      const { introduced, preExisting } = introducedIssues(knowledge, prospective);
      issues = introduced.map((i) => `${i.id} ${i.rule}: ${i.detail}`);
      if (introduced.length === 0) {
        const v = markValidated(store, offered.candidate.id, {
          at: input.stamp,
          againstMethodVersion: knowledge.version,
          introduced: [],
          preExisting,
          ok: true,
        });
        store = v.store;
        proposed.push({ routeId: c.routeId, candidateId: v.candidate.id, lifecycle: v.candidate.lifecycle, issues: [], already: false });
      } else {
        const r = markRejected(store, offered.candidate.id, {
          at: input.stamp,
          code: "VALIDATION_FAILED",
          reason: `the prospective method store would introduce ${introduced.length} validator issue(s)`,
          issues: introduced,
        });
        store = r.store;
        proposed.push({ routeId: c.routeId, candidateId: r.candidate.id, lifecycle: r.candidate.lifecycle, issues, already: false });
      }
    } catch (error) {
      const r = markRejected(store, offered.candidate.id, {
        at: input.stamp,
        code: "PROPOSAL_MALFORMED",
        reason: error instanceof Error ? error.message : String(error),
        issues: [],
      });
      store = r.store;
      proposed.push({ routeId: c.routeId, candidateId: r.candidate.id, lifecycle: r.candidate.lifecycle, issues: [r.candidate.rejection?.reason ?? "malformed"], already: false });
    }
  }

  if (wrote) writeCandidateStore(candidatePath, store, input.stamp);
  return { proposed, notProposed, counts: candidateCounts(store), storeVersionObserved: knowledge.version };
}

/** The counts the research state reports, or null when the store is unreadable. */
export function candidateStoreCounts(root: string): Record<CandidateLifecycle, number> | null {
  try {
    return candidateCounts(readCandidateStore(join(root, ...CANDIDATE_STORE)));
  } catch {
    return null;
  }
}
