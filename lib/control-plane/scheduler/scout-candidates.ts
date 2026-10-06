/**
 * **FROM A SCOUT'S ROUTE CANDIDATE TO THE METHOD-CANDIDATE STORE.**
 * (Level 1 activation, 2026-09-01. RULING 240. Machine-owned provenance,
 * 2026-09-02, RULING 243.)
 *
 * Models handle novelty; code handles learned procedure. The bridge is the
 * EXISTING candidate lifecycle in `lib/method/candidate.ts` —
 * `PROPOSED -> VALIDATED -> ADMITTED | REJECTED`. A route that validates on
 * the Attempt that opened it is written to the field manual and admitted at
 * once, so it is used the moment it works (DP-25). Two Attempts offering the
 * same route id prove nothing: whether a method is Proven comes only from the
 * fix map and the bar.
 *
 * Only a candidate whose URL the Attempt actually OPENED (an artifact with
 * that canonical URL) is proposed: a route the method store learns carries an
 * outcome in a jurisdiction, and a URL merely observed on a page has none.
 * The rest stay on the typed Scout result, marked unverified.
 *
 * ## What reaches durable provenance (RULING 243)
 *
 * `learnedRouteFrom` writes `origin`, `note` and the ROUTE_EXISTENCE claim
 * from the candidate's MACHINE-OWNED fields — `observedOn`, `permission`,
 * `recordClass`, `evidenceArtifactIds` — which the executor derived from the
 * artifact, obligation and permission records before it accepted the finish.
 * The model's own statements about those facts travel separately as
 * `modelClaims` on the candidate record and are never written into the
 * proposal. A candidate without a machine derivation (no `provenance`) is a
 * pre-ruling shape and is not proposed.
 */


import {
  candidateCounts,
  introducedIssues,
  markAdmitted,
  markRejected,
  markValidated,
  proposeCandidate,
  type CandidateStore,
  type CandidateLifecycle,
  type MethodCandidate,
} from "../../method/candidate.ts";
import { ConcurrentModification, IdentityCollision, type ControlPlaneRepositories } from "../repository/types.ts";
import { learnBatch, type LearnedRoute } from "../../method/learn-batch.ts";
import { readMethodKnowledge } from "../../method/manual-bridge.ts";
import { newFieldManualEntry, writeFieldManual } from "../field-manual.ts";
import { scoutStateHint } from "./field-manual-scout.ts";
import type { WorkArtifact } from "./dispatch.ts";
import type { ScoutCandidate, ScoutResult } from "./scout-result.ts";

/** One authoritative lifecycle aggregate in the standing production plane. */
export const METHOD_CANDIDATE_STORE_ID = "live" as const;

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

/** The machine-owned fields a proposal's provenance text is written from. Nothing else reaches it. */
export interface MachineOwnedProvenance {
  readonly observedOn: string;
  readonly permission: string;
  readonly recordClass: string;
  readonly evidenceArtifactIds: readonly string[];
}

/** The origin line, written from machine-owned values only. */
export function originLine(attemptId: string, obligationId: string, observedOn: string): string {
  return `SCOUT Attempt ${attemptId} on ${obligationId}, observed ${observedOn} (provenance machine-derived from the artifact record, RULING 243)`;
}

/** The ROUTE_EXISTENCE statement, written from machine-owned values only. */
export function existenceStatement(url: string, observedOn: string, evidence: readonly string[]): string {
  return `${url} answered to an identified public client on ${observedOn}; evidence ${evidence.join(", ")}`;
}

/**
 * The LearnedRoute shape the store accepts, built from what the Scout actually
 * showed. `machine` defaults to the candidate's own fields, which the executor
 * has already made machine-owned; a caller re-deriving an older candidate
 * passes the derivation explicitly.
 */
export function learnedRouteFrom(
  c: ScoutCandidate,
  result: Pick<ScoutResult, "attemptId" | "obligationId" | "subjectId">,
  openedArtifacts: readonly WorkArtifact[],
  machine: MachineOwnedProvenance = c,
): LearnedRoute {
  const evidence = [...new Set([...machine.evidenceArtifactIds, ...openedArtifacts.map((a) => a.artifactId)])];
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
    fields: [machine.recordClass],
    note:
      `${c.relevance} Permission: ${machine.permission} (the verdict the cited evidence was retrieved under) — ${c.permissionReading}. Procedure: ${c.procedure}. ` +
      `Evidence artifacts: ${evidence.join(", ")}. Unverified: ${c.unverified.join("; ") || "nothing stated"}.`,
    origin: originLine(result.attemptId, result.obligationId, machine.observedOn),
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
        statement: existenceStatement(c.url, machine.observedOn, evidence),
        restsOn: [],
      },
    ],
  };
}

/** The model's claims as the candidate record carries them. Null when the executor recorded none. */
function modelClaimsOf(c: ScoutCandidate): MethodCandidate["modelClaims"] {
  return c.claims === undefined ? undefined : { ...c.claims };
}

/**
 * Validate openable candidates and admit independently repeated routes into
 * the manual. Candidate and manual writes are idempotent across retries.
 */
export async function proposeScoutCandidates(input: {
  readonly repos: ControlPlaneRepositories;
  readonly result: ScoutResult;
  readonly artifacts: readonly WorkArtifact[];
  readonly stamp: string;
}): Promise<ProposalReport> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const knowledge = await readMethodKnowledge(input.repos);
    const current = await input.repos.methodCandidates.read(METHOD_CANDIDATE_STORE_ID);
    if (current === null) {
      throw new Error("METHOD_CANDIDATE_STORE_NOT_SEEDED: refusing to treat an absent canonical store as an empty candidate population");
    }
    let store: CandidateStore = current.value;
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
    if (c.provenance === undefined) {
      notProposed.push({
        routeId: c.routeId,
        why: "the candidate carries no machine provenance derivation (RULING 243); a proposal whose provenance the model wrote is not learned",
      });
      continue;
    }
    const proposal = learnedRouteFrom(c, input.result, opened);
    const prior = store.candidates.find((candidate) =>
      candidate.proposal.id === c.routeId && candidate.attemptId !== input.result.attemptId &&
      candidate.lifecycle === "VALIDATED",
    );
    const offered = proposeCandidate(store, {
      attemptId: input.result.attemptId,
      proposal,
      submittedAt: input.stamp,
      observedMethodVersion: knowledge.version,
    });
    store = offered.store;
    // DP-25: an offer already admitted is done; one validated but not yet written (a failed manual write) finishes admission below.
    if (offered.already && offered.candidate.lifecycle !== "VALIDATED") {
      proposed.push({ routeId: c.routeId, candidateId: offered.candidate.id, lifecycle: offered.candidate.lifecycle, issues: [], already: true });
      continue;
    }
    /* The model's claims travel on the record, beside the proposal and never inside it. */
    const claims = modelClaimsOf(c);
    if (claims !== undefined) {
      store = {
        ...store,
        candidates: store.candidates.map((mc) => (mc.id === offered.candidate.id ? { ...mc, modelClaims: claims } : mc)),
      };
    }
    wrote = true;
    /* Validate the PROSPECTIVE store, exactly as admission would, and record the verdict. */
    let issues: string[] = [];
    try {
      const prospective = learnBatch(knowledge, [proposal], input.stamp).knowledge;
      const { introduced, preExisting } = introducedIssues(knowledge, prospective);
      issues = introduced.map((i) => `${i.id} ${i.rule}: ${i.detail}`);
      if (introduced.length === 0) {
        const v = offered.candidate.lifecycle === "VALIDATED" ? { store, candidate: offered.candidate } : markValidated(store, offered.candidate.id, {
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
    /*
     * DP-25: a validated route is used the moment it works once, as this place's door entry. Whether the method is
     * proven comes only from the fix map and the bar (lib/method/fix-status.ts), never from two Attempts offering the
     * same route id.
     */
    if (store.candidates.find((candidate) => candidate.id === offered.candidate.id)?.lifecycle === "VALIDATED") {
      const learned = learnBatch(knowledge, prior ? [prior.proposal, proposal] : [proposal], input.stamp);
      const route = learned.knowledge.routes.find((route) => route.id === c.routeId)!;
      const written = await writeFieldManual(input.repos, [newFieldManualEntry("scout-candidate", route.id, {
        role: "SHARED", kind: "ROUTE", title: route.title,
        summary: `Worked in Attempt ${input.result.attemptId}. ${c.procedure}`,
        outcome: "YIELDED", url: c.url, recordClasses: route.fields,
        states: scoutStateHint(input.result.subjectId, input.result.obligationId),
        foundBy: input.result.researchRole === "DETECTIVE" ? "DETECTIVE" : "SCOUT",
        observedAt: input.stamp, tier: route.tier, payload: route,
      })], input.stamp);
      if (written.error || written.written !== 1) {
        proposed[proposed.length - 1] = { ...proposed[proposed.length - 1], issues: [written.error ?? "field manual write did not persist the route"] };
      } else {
        const admission = {
          at: input.stamp, admittedAs: route.id,
          effect: learned.learned > 0 ? "LEARNED" as const : "ALREADY_KNOWN" as const,
          methodVersionAfter: (await readMethodKnowledge(input.repos)).version,
        };
        if (prior) store = markAdmitted(store, prior.id, admission).store;
        const admitted = markAdmitted(store, offered.candidate.id, admission);
        store = admitted.store;
        proposed[proposed.length - 1] = { ...proposed[proposed.length - 1], lifecycle: admitted.candidate.lifecycle };
      }
    }
    }

    const report = { proposed, notProposed, counts: candidateCounts(store), storeVersionObserved: knowledge.version };
    if (!wrote) return report;
    try {
      await input.repos.methodCandidates.compareAndSet(METHOD_CANDIDATE_STORE_ID, current.revision, store, input.stamp);
      return report;
    } catch (error) {
      if (!(error instanceof ConcurrentModification) && !(error instanceof IdentityCollision)) throw error;
      if (attempt === 3) throw error;
    }
  }
  throw new Error("METHOD_CANDIDATE_CAS_RETRY_EXHAUSTED");
}

/** The one canonical store; absence is not an empty candidate population. */
export async function readMethodCandidateStore(repos: ControlPlaneRepositories): Promise<CandidateStore> {
  const current = await repos.methodCandidates.read(METHOD_CANDIDATE_STORE_ID);
  if (current === null) throw new Error("METHOD_CANDIDATE_STORE_NOT_SEEDED");
  if (current.value.storeVersion !== 1 || !Array.isArray(current.value.candidates)) {
    throw new Error("METHOD_CANDIDATE_STORE_UNREADABLE");
  }
  return current.value;
}

/** The counts the research state reports, or null when authority is absent/unreadable. */
export async function candidateStoreCounts(repos: ControlPlaneRepositories): Promise<Record<CandidateLifecycle, number> | null> {
  try {
    return candidateCounts(await readMethodCandidateStore(repos));
  } catch {
    return null;
  }
}
