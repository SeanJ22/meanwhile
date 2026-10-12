/**
 * The one governed write path into canonical method knowledge: every write is a candidate validated before it lands,
 * and a rejected candidate is recorded durably. `expectedVersion` narrows the read-modify-write window but does not
 * close it; nothing here holds a lock. No function here reads a clock.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { fingerprint } from "../control-plane/ids.ts";
import { validateClaims } from "./claims.ts";
import {
  validateKnowledge,
  type MethodIssue,
  type MethodKnowledge,
  type PriorConclusion,
} from "./knowledge.ts";
import type { LearnedRoute } from "./learn-batch.ts";

/** `PROPOSED -> VALIDATED -> ADMITTED | REJECTED`; `PROPOSED -> REJECTED` when there was never a prospective store to validate. */
export const CANDIDATE_LIFECYCLE_STATES = ["PROPOSED", "VALIDATED", "ADMITTED", "REJECTED"] as const;
export type CandidateLifecycle = (typeof CANDIDATE_LIFECYCLE_STATES)[number];

export const CANDIDATE_TRANSITIONS: Readonly<Record<CandidateLifecycle, readonly CandidateLifecycle[]>> = {
  PROPOSED: ["VALIDATED", "REJECTED"],
  VALIDATED: ["ADMITTED", "REJECTED"],
  ADMITTED: [],
  REJECTED: [],
};

/** Every reason a candidate is refused, as a STABLE CODE rather than a sentence. */
export const CANDIDATE_REJECTION_CODES = [
  /** The prospective store raised validator issues the current store does not. */
  "VALIDATION_FAILED",
  /** The store moved between the read and the write. Optimistic concurrency. */
  "STORE_VERSION_MOVED",
  /** The canonical store could not be read or parsed. */
  "STORE_UNREADABLE",
  /** The proposal itself is not a route shape this store can consider. */
  "PROPOSAL_MALFORMED",
] as const;
export type CandidateRejectionCode = (typeof CANDIDATE_REJECTION_CODES)[number];

export interface CandidateValidation {
  /** ISO date, from `pnpm stamp`. */
  readonly at: string;
  /** The store version the prospective result was computed against. */
  readonly againstMethodVersion: number;
  /** Issues the candidate INTRODUCED. Empty means it may be admitted. */
  readonly introduced: readonly MethodIssue[];
  /** Issues the store already had. Reported so a candidate is never blamed for them. */
  readonly preExisting: number;
  readonly ok: boolean;
}

export interface CandidateRejection {
  readonly at: string;
  readonly code: CandidateRejectionCode;
  /** Why, in one sentence. Never an apology; always the mechanism. */
  readonly reason: string;
  /** The exact issues, retained. This is the durable evidence. */
  readonly issues: readonly MethodIssue[];
}

/** What admission actually did. `ALREADY_KNOWN` is a success, not a no-op. */
export const ADMISSION_EFFECTS = ["LEARNED", "ALREADY_KNOWN"] as const;
export type AdmissionEffect = (typeof ADMISSION_EFFECTS)[number];

export interface CandidateAdmission {
  readonly at: string;
  /** The route or assertion id now in project knowledge. */
  readonly admittedAs: string;
  readonly effect: AdmissionEffect;
  readonly methodVersionAfter: number;
}

export interface MethodCandidate {
  readonly id: string;
  /** The Attempt that submitted it. A candidate with no Attempt has no author. */
  readonly attemptId: string;
  readonly proposal: LearnedRoute;
  readonly submittedAt: string;
  /** The method version observed when it was submitted, not the version it was admitted at. */
  readonly observedMethodVersion: number;
  readonly lifecycle: CandidateLifecycle;
  readonly validation: CandidateValidation | null;
  readonly admission: CandidateAdmission | null;
  /** Retained forever on a refusal. A rejection is evidence, never a silence. */
  readonly rejection: CandidateRejection | null;
  /** The model's own provenance statements, kept for audit and never copied into the proposal. */
  readonly modelClaims?: {
    readonly observedOn: string | null;
    readonly permission: string | null;
    readonly recordClass: string | null;
  };
  /** Historical seed evidence that the proposal provenance was re-derived from its durable artifact record. */
  readonly provenanceRederived?: {
    readonly at: string;
    readonly rule: string;
    readonly derivedFrom: readonly string[];
    readonly before: { readonly origin: string; readonly observedOn: string | null; readonly permission: string | null };
  };
}

export interface CandidateStore {
  /** The store format, not the method version. */
  readonly storeVersion: 1;
  readonly updatedOn: string | null;
  readonly candidates: readonly MethodCandidate[];
}

export function emptyCandidateStore(): CandidateStore {
  return { storeVersion: 1, updatedOn: null, candidates: [] };
}

/** Derived from what the candidate is, so identical offers on one day collide and a replay computes the same id. */
export function methodCandidateId(attemptId: string, routeId: string, submittedAt: string): string {
  return `mc-${fingerprint([attemptId, routeId, submittedAt])}`;
}

export class CandidateLifecycleRefused extends Error {
  readonly candidateId: string;
  readonly from: CandidateLifecycle;
  readonly to: CandidateLifecycle;

  constructor(candidateId: string, from: CandidateLifecycle, to: CandidateLifecycle) {
    super(
      `CANDIDATE LIFECYCLE REFUSED: ${candidateId} cannot go ${from} -> ${to}. ` +
        `From ${from} the permitted next states are ${CANDIDATE_TRANSITIONS[from].join(", ") || "(none — it is terminal)"}. ` +
        "A terminal candidate is history and is never rewritten.",
    );
    this.name = "CandidateLifecycleRefused";
    this.candidateId = candidateId;
    this.from = from;
    this.to = to;
  }
}

function transition(c: MethodCandidate, to: CandidateLifecycle): void {
  if (!CANDIDATE_TRANSITIONS[c.lifecycle].includes(to)) {
    throw new CandidateLifecycleRefused(c.id, c.lifecycle, to);
  }
}

function replace(store: CandidateStore, next: MethodCandidate, on: string): CandidateStore {
  return {
    storeVersion: 1,
    updatedOn: on,
    candidates: store.candidates.map((c) => (c.id === next.id ? next : c)),
  };
}

export function findCandidate(store: CandidateStore, id: string): MethodCandidate | null {
  return store.candidates.find((c) => c.id === id) ?? null;
}

/** Record an offer; idempotent by derived id. */
export function proposeCandidate(
  store: CandidateStore,
  input: {
    attemptId: string;
    proposal: LearnedRoute;
    submittedAt: string;
    observedMethodVersion: number;
  },
): { store: CandidateStore; candidate: MethodCandidate; already: boolean } {
  const id = methodCandidateId(input.attemptId, input.proposal.id, input.submittedAt);
  const existing = findCandidate(store, id);
  if (existing) return { store, candidate: existing, already: true };

  const candidate: MethodCandidate = {
    id,
    attemptId: input.attemptId,
    proposal: input.proposal,
    submittedAt: input.submittedAt,
    observedMethodVersion: input.observedMethodVersion,
    lifecycle: "PROPOSED",
    validation: null,
    admission: null,
    rejection: null,
  };
  return {
    store: {
      storeVersion: 1,
      updatedOn: input.submittedAt,
      candidates: [...store.candidates, candidate],
    },
    candidate,
    already: false,
  };
}

export function markValidated(
  store: CandidateStore,
  id: string,
  validation: CandidateValidation,
): { store: CandidateStore; candidate: MethodCandidate } {
  const c = findCandidate(store, id);
  if (!c) throw new Error(`no method candidate ${id}`);
  transition(c, "VALIDATED");
  const next: MethodCandidate = { ...c, lifecycle: "VALIDATED", validation };
  return { store: replace(store, next, validation.at), candidate: next };
}

export function markAdmitted(
  store: CandidateStore,
  id: string,
  admission: CandidateAdmission,
): { store: CandidateStore; candidate: MethodCandidate } {
  const c = findCandidate(store, id);
  if (!c) throw new Error(`no method candidate ${id}`);
  transition(c, "ADMITTED");
  const next: MethodCandidate = { ...c, lifecycle: "ADMITTED", admission };
  return { store: replace(store, next, admission.at), candidate: next };
}

/** Refuse a candidate durably: the reason and exact issues stay on the record. */
export function markRejected(
  store: CandidateStore,
  id: string,
  rejection: CandidateRejection,
): { store: CandidateStore; candidate: MethodCandidate } {
  const c = findCandidate(store, id);
  if (!c) throw new Error(`no method candidate ${id}`);
  transition(c, "REJECTED");
  const next: MethodCandidate = { ...c, lifecycle: "REJECTED", rejection };
  return { store: replace(store, next, rejection.at), candidate: next };
}

/** Counts by lifecycle. Every state named, including the zeroes. */
export function candidateCounts(store: CandidateStore): Record<CandidateLifecycle, number> {
  const counts = Object.fromEntries(
    CANDIDATE_LIFECYCLE_STATES.map((s) => [s, 0]),
  ) as Record<CandidateLifecycle, number>;
  for (const c of store.candidates) {
    if (CANDIDATE_LIFECYCLE_STATES.includes(c.lifecycle)) counts[c.lifecycle] += 1;
  }
  return counts;
}

/** Every rejected candidate, newest submission last. The durable refusal corpus. */
export function rejectedCandidates(store: CandidateStore): MethodCandidate[] {
  return store.candidates.filter((c) => c.lifecycle === "REJECTED");
}

/** A stable key for an issue, so "did this candidate INTRODUCE it" is decidable. */
export function issueKey(i: MethodIssue): string {
  return `${i.id} ${i.rule}`;
}

/** The canonical validators, never a second set of rules; issues are de-duplicated by (id, rule, detail). */
export function methodStoreIssues(
  k: MethodKnowledge,
  conclusions: readonly PriorConclusion[] = [],
): MethodIssue[] {
  const seen = new Set<string>();
  const out: MethodIssue[] = [];
  for (const i of [...validateKnowledge(k, conclusions), ...validateClaims(k)]) {
    const key = `${i.id}${i.rule}${i.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out;
}

/** Issues the prospective store raises that the current one does not, so a writer is never blamed for inherited ones. */
export function introducedIssues(
  before: MethodKnowledge,
  after: MethodKnowledge,
  conclusions: readonly PriorConclusion[] = [],
): { introduced: MethodIssue[]; preExisting: number } {
  const baseline = new Set(methodStoreIssues(before, conclusions).map(issueKey));
  const all = methodStoreIssues(after, conclusions);
  return { introduced: all.filter((i) => !baseline.has(issueKey(i))), preExisting: baseline.size };
}

export class MethodStoreUnreadable extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`METHOD STORE UNREADABLE at ${path}: ${detail}. Nothing was written.`);
    this.name = "MethodStoreUnreadable";
    this.path = path;
  }
}

/** Write a JSON document by temp file and rename, so a reader never sees half a document. The pid keeps racing writers' temp paths apart. */
export function atomicWriteJson(path: string, value: unknown): number {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
  return Buffer.byteLength(body, "utf8");
}

export function readCandidateStore(path: string): CandidateStore {
  if (!existsSync(path)) return emptyCandidateStore();
  const parsed = JSON.parse(readFileSync(path, "utf8")) as CandidateStore;
  if (!Array.isArray(parsed?.candidates)) {
    throw new MethodStoreUnreadable(path, "parsed, but it is not a candidate store (no candidates array)");
  }
  return parsed;
}

export function writeCandidateStore(path: string, store: CandidateStore, stamp: string): number {
  return atomicWriteJson(path, { ...store, updatedOn: stamp });
}
