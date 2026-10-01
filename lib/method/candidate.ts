/**
 * **THE ADMISSION GATE: A DURABLE CANDIDATE, AND THE ONE GOVERNED WRITE PATH
 * INTO CANONICAL METHOD KNOWLEDGE.** (2026-08-29.)
 *
 * Two things live here because they are one thing. A candidate is something
 * OFFERED to project knowledge; the governed writer is the only door it can come
 * through; and every canonical write is the admission of something.
 *
 * ## The defect this closes, exactly
 *
 * `runLearnBatch` was an UNCONDITIONAL canonical writer. It read
 * `data/method/knowledge.json`, called `learnBatch`, and `writeFileSync`'d the
 * result. There was no validation gate on that path at all — not a weak one, not
 * one with an escape hatch, none. A route carrying an outcome value off the
 * closed set, a claim class the validator refuses, a `NATIONWIDE` applicability
 * on one state's evidence: every one of those landed in the canonical store, and
 * the first thing that noticed was `pnpm method:check`, afterwards, if somebody
 * ran it. The store's own history records that sequence happening twice — the
 * `effort` note and the `outcome` note in `validateKnowledge` are both accounts
 * of a bad value reaching the canonical store while the check reported PASSED.
 *
 * A validator that runs after the write is a report. A validator that runs
 * before it is a gate. **`writeMethodStore` is the gate**, and it is a gate
 * rather than a convention because no caller can forget to call something it has
 * to call to write at all.
 *
 * ## Why a REJECTED candidate is durable
 *
 * The obvious implementation of "refuse a bad route" is to not write it and
 * print why. That loses the evidence the moment the terminal scrolls. A rejected
 * candidate is a real finding: it says an Attempt proposed something, what it
 * proposed, which method version it was looking at, and exactly which rule
 * refused it. **Silence is not a rejection record.** A route rejected three
 * times for the same issue is a signal; three unrecorded refusals are three
 * sessions each discovering it alone.
 *
 * ## What the version precondition does and does not do
 *
 * `expectedVersion` is optimistic concurrency: a writer that read version N
 * refuses to overwrite a store that has since become N+1, and says so with both
 * numbers. It NARROWS the read-modify-write window; it does not eliminate it,
 * because the check and the rename are two syscalls and nothing here holds a
 * lock. What would close it is a lock file or a single-writer daemon, and
 * neither exists yet — so the honest statement is the one in this paragraph
 * rather than a claim of atomicity the code cannot keep.
 *
 * ## Time
 *
 * No function in this file reads a clock. Every date is a parameter, from
 * `pnpm stamp`. `process.pid` appears in the temp-file name, which is process
 * identity rather than time, and is what keeps two concurrent writers from
 * clobbering each other's temp file before the rename.
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

/* ------------------------------------------------------------------ THE CANDIDATE */

/**
 * The lifecycle, reconciled with the code that actually exists.
 *
 * `PROPOSED -> VALIDATED -> ADMITTED | REJECTED` is the intended path. A
 * candidate may also go `PROPOSED -> REJECTED` directly, and that is not a
 * shortcut past validation: it is the case where the store moved underneath the
 * submitter, or the proposal could not be read at all, so there was never a
 * prospective store to validate. Recording that as REJECTED with its own code is
 * the point — the alternative is a candidate stuck at PROPOSED forever, which
 * reads as "still being considered".
 */
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

/**
 * One route offered to project knowledge, and what became of it.
 *
 * `proposal` is a `LearnedRoute` — the SAME shape `learnBatch` accepts, imported
 * rather than re-declared. A forked proposal type would drift from the thing it
 * proposes within one session, and then a candidate would validate against a
 * shape the store cannot hold.
 */
export interface MethodCandidate {
  readonly id: string;
  /** The Attempt that submitted it. A candidate with no Attempt has no author. */
  readonly attemptId: string;
  readonly proposal: LearnedRoute;
  readonly submittedAt: string;
  /**
   * **THE METHOD VERSION OBSERVED WHEN IT WAS SUBMITTED.** Not the version it
   * was admitted at. A candidate conceived against v55 and admitted at v61 was
   * reasoned about under v55's knowledge, and a replay that used the later
   * number would be replaying a different decision.
   */
  readonly observedMethodVersion: number;
  readonly lifecycle: CandidateLifecycle;
  readonly validation: CandidateValidation | null;
  readonly admission: CandidateAdmission | null;
  /** Retained forever on a refusal. A rejection is evidence, never a silence. */
  readonly rejection: CandidateRejection | null;
  /**
   * **THE MODEL'S OWN PROVENANCE STATEMENTS, RECORDED AND NEVER USED.**
   * (RULING 243, 2026-09-02.) `proposal.origin`, `proposal.note` and the
   * claims' statements carry MACHINE-derived values (observedOn from the
   * artifact record, permission from the retrieval verdict, recordClass from
   * the obligation). What the model said about those facts is kept here so an
   * audit can see the disagreement; it is never copied into the proposal.
   * Optional: candidates submitted before the ruling carry none.
   */
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

/**
 * The candidate's id, DERIVED from what it is rather than assigned.
 *
 * Same reasoning as every control-plane id: two workers that independently
 * submit the same proposal on the same day collide instead of creating two
 * records of one offer, and a replay computes the same id. `submittedAt` is in
 * the digest so a genuine resubmission on a later date is a distinct record —
 * re-offering a route the store has since changed under is a different event.
 */
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

/**
 * Record an offer. Idempotent by derived id: re-proposing the identical offer
 * returns the existing record rather than a second copy of it, so a replayed
 * Attempt does not inflate the candidate corpus.
 */
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

/**
 * Refuse a candidate, DURABLY.
 *
 * The reason and the exact issues are retained on the record. A refusal that
 * only printed would be indistinguishable, an hour later, from a proposal
 * nobody ever made.
 */
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

/* ------------------------------------------------------------------- VALIDATION */

/** A stable key for an issue, so "did this candidate INTRODUCE it" is decidable. */
export function issueKey(i: MethodIssue): string {
  return `${i.id} ${i.rule}`;
}

/**
 * **THE CANONICAL VALIDATORS, BOTH OF THEM, AND NO SECOND SET OF RULES.**
 *
 * `validateKnowledge` already composes `validateClaims`, so naming both here is
 * belt and braces — and it is deliberate. The one thing that must never happen
 * on this path is a fork: a gate that implements "its own" idea of a valid store
 * would drift from the validator `pnpm method:check` runs, and then the gate and
 * the check would disagree about the same bytes. The union is de-duplicated by
 * (id, rule, detail) so calling both costs nothing.
 */
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

/**
 * Issues the prospective store raises that the current one does not.
 *
 * Refusing on INTRODUCED issues rather than on ALL issues is the same rule
 * `runClaimAmendment` already applies, and it exists so a writer is never
 * blamed for a defect it inherited. A store carrying a pre-existing issue is
 * still reported; it just does not make every subsequent write impossible,
 * which would be a gate that has to be disabled to fix the thing it is
 * complaining about.
 */
export function introducedIssues(
  before: MethodKnowledge,
  after: MethodKnowledge,
  conclusions: readonly PriorConclusion[] = [],
): { introduced: MethodIssue[]; preExisting: number } {
  const baseline = new Set(methodStoreIssues(before, conclusions).map(issueKey));
  const all = methodStoreIssues(after, conclusions);
  return { introduced: all.filter((i) => !baseline.has(issueKey(i))), preExisting: baseline.size };
}

/* ------------------------------------------------------- FILE WRITES */

export class MethodStoreUnreadable extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`METHOD STORE UNREADABLE at ${path}: ${detail}. Nothing was written.`);
    this.name = "MethodStoreUnreadable";
    this.path = path;
  }
}

/**
 * Write a JSON document by TEMP FILE AND RENAME.
 *
 * A truncating write that dies halfway leaves a syntactically broken canonical
 * store, and `data/method/knowledge.json` is the file every later session reads
 * to know what the project has learned. Rename is atomic within a filesystem, so
 * a reader sees either the old document or the new one and never half of either.
 *
 * The pid in the temp name is process identity, not a clock: two writers racing
 * must not share a temp path, or the loser corrupts the winner's bytes before
 * either rename happens.
 */
export function atomicWriteJson(path: string, value: unknown): number {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
  return Buffer.byteLength(body, "utf8");
}

/* ------------------------------------------------------- THE DURABLE CANDIDATE STORE */

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
