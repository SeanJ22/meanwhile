/** Finish old VALIDATED offers without paying another Scout to re-offer them.
 * Uses existing validators and durable outcomes. Admission follows manual
 * persistence; retry after either store's failure is safe. No human gate.
 */
import { candidateCounts, introducedIssues, markAdmitted, markRejected, type CandidateLifecycle } from "../method/candidate.ts";
import { learnBatch } from "../method/learn-batch.ts";
import { readMethodKnowledge } from "../method/manual-bridge.ts";
import { ConcurrentModification, type ControlPlaneRepositories } from "./repository/types.ts";
import { newFieldManualEntry, writeFieldManual, type FieldManualEntry } from "./field-manual.ts";

export interface BankAdmissionReport {
  readonly before: Record<CandidateLifecycle, number>;
  readonly after: Record<CandidateLifecycle, number>;
  readonly decisions: readonly { candidateId: string; routeId: string; lifecycle: CandidateLifecycle; why: string }[];
}

export async function admitValidatedBankCandidates(input: {
  repos: ControlPlaneRepositories; stamp: string;
}): Promise<BankAdmissionReport> {
  for (let retry = 0; retry < 4; retry++) {
    const current = await input.repos.methodCandidates.read("live");
    if (!current || current.value.storeVersion !== 1 || !Array.isArray(current.value.candidates)) throw new Error("METHOD_CANDIDATE_STORE_UNREADABLE");
    let knowledge = await readMethodKnowledge(input.repos);
    let store = current.value;
    const before = candidateCounts(store);
    const decisions: { candidateId: string; routeId: string; lifecycle: CandidateLifecycle; why: string }[] = [];
    let changed = false;
    const entries: FieldManualEntry[] = [];
    const accepted: { id: string; routeId: string; learned: boolean }[] = [];
    for (const candidate of current.value.candidates.filter(row => row.lifecycle === "VALIDATED")) {
      const proposal = candidate.proposal;
      const decision = (lifecycle: CandidateLifecycle, why: string) => decisions.push({ candidateId: candidate.id, routeId: proposal.id, lifecycle, why });
      // Do not invent successful evidence for pre-ruling or damaged envelopes.
      if (!candidate.validation?.ok || candidate.validation.introduced.length || proposal.outcome?.outcome !== "YIELDED" || proposal.outcome.rows <= 0) {
        decision("VALIDATED", "saved validation or successful source outcome is missing; owner must recover the durable evidence");
        continue;
      }
      try {
        const learned = learnBatch(knowledge, [proposal], candidate.submittedAt);
        const verdict = introducedIssues(knowledge, learned.knowledge);
        if (verdict.introduced.length) {
          store = markRejected(store, candidate.id, { at: input.stamp, code: "VALIDATION_FAILED",
            reason: "revalidation against the current manual introduces validator issues", issues: verdict.introduced }).store;
          changed = true;
          decision("REJECTED", "current validator issues saved on the candidate");
          continue;
        }
        const route = learned.knowledge.routes.find(row => row.id === proposal.id);
        if (!route) throw new Error("LEARNED_ROUTE_MISSING");
        const jurisdiction = proposal.outcome.jurisdiction;
        const state = jurisdiction.match(/(?:^|\/)state:([a-z]{2})(?:\/|$)/i)?.[1]?.toLowerCase();
        entries.push(newFieldManualEntry("scout-candidate", route.id, {
          role: "SHARED", kind: "ROUTE", title: route.title,
          summary: `Worked in Attempt ${candidate.attemptId}. ${proposal.note}`,
          outcome: "YIELDED", states: state ? [state] : [],
          ocdIds: jurisdiction.startsWith("ocd-division/") ? [jurisdiction] : [],
          recordClasses: route.fields, observedAt: candidate.submittedAt,
          tier: route.tier, url: null, payload: route,
        }));
        knowledge = learned.knowledge;
        accepted.push({ id: candidate.id, routeId: route.id, learned: learned.learned > 0 });
      } catch (error) {
        // A storage outage remains resumable, never a fabricated rejection.
        decision("VALIDATED", error instanceof Error ? error.message : String(error));
      }
    }
    if (entries.length) {
      // One batch write, never one aggregate rewrite per candidate.
      const written = await writeFieldManual(input.repos, entries, input.stamp);
      if (written.error || written.written !== entries.length) {
        for (const row of accepted) decisions.push({ candidateId: row.id, routeId: row.routeId, lifecycle: "VALIDATED", why: written.error ?? "manual did not persist the batch" });
      } else {
        const persisted = await readMethodKnowledge(input.repos);
        for (const row of accepted) {
          store = markAdmitted(store, row.id, { at: input.stamp, admittedAs: row.routeId,
            effect: row.learned ? "LEARNED" : "ALREADY_KNOWN", methodVersionAfter: persisted.version }).store;
          changed = true;
          decisions.push({ candidateId: row.id, routeId: row.routeId, lifecycle: "ADMITTED", why: "saved successful offer persisted in the manual; no repeat Scout required" });
        }
      }
    }
    if (changed) {
      try { await input.repos.methodCandidates.compareAndSet("live", current.revision, store, input.stamp); }
      catch (error) {
        if (error instanceof ConcurrentModification && retry < 3) continue;
        throw error;
      }
    }
    return { before, after: candidateCounts(store), decisions };
  }
  throw new Error("BANK_CANDIDATE_CAS_RETRY_EXHAUSTED");
}
