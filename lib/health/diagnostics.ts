/**
 * **RED CREATES WORK, AND ONLY A GREEN CLOSES IT.** (A.1 WI3, 2026-08-30.)
 *
 * ## What was missing, stated plainly
 *
 * `diagnosticWorkItemFor` existed in Session A and **nothing ever called it**.
 * The reader harness computed RED verdicts, printed them, wrote them into a
 * run record, and stopped. A red question produced a line of console output
 * and no obligation anywhere — so the contract that says a reader must be able
 * to learn a fact had no mechanism by which failing to learn it caused
 * anything to happen.
 *
 * And the helper itself, had it been called, would not have closed the gap:
 * it wrote the completion condition into `why` as PROSE and attached
 * `{...DEFAULT_CONTRACT}`, which asks for a validation record and nothing
 * about the question. The item could have been closed by a validator that
 * never asked the question again.
 *
 * ## The three obligations this module discharges
 *
 * ```
 *   CREATE      every RED gets a typed diagnostic WorkItem, diagnosed with a
 *               failure class BEFORE anything is dispatched
 *   PERSIST     into the durable control plane, deduplicated — one open item
 *               per red instance, not one per run
 *   CLOSE       mechanically, and only on a canonical run at or after the
 *               item's creation SHA evaluating THAT instance GREEN
 * ```
 *
 * Deduplication is free rather than clever: `workItemId` is a pure function of
 * (project, subject, obligation) and the obligation string carries the
 * instance id, so the same red question on ten runs derives one id ten times.
 * The repository's idempotent `put` then makes the second write a no-op
 * success rather than a duplicate. That is the whole mechanism, and it is the
 * mechanism the control plane was built with — nothing here re-implements it.
 *
 * ## Why the closer lives here and not in the runner
 *
 * A runner that closes its own findings is a runner grading its own homework.
 * This module reads the item's contract, reads the run record, and applies the
 * contract's own rule; the runner supplies the record and is not consulted
 * about whether the rule was met.
 */

import {
  evaluateCompletion,
  type CompletionSnapshot,
} from "../control-plane/completion.ts";
import {
  createWorkItem,
  isTerminalState,
  type WorkItem,
} from "../control-plane/work-item.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";

import type { FailureClass, ReaderQuestionInstance } from "./reader-question.ts";

/* ------------------------------------------------------------- creation */

/**
 * The diagnostic WorkItem for a red reader question, with a REAL contract.
 *
 * `testedSha` is the tree the failure was observed on and it is required, not
 * optional-with-a-default: an item anchored to nothing can never be shown to
 * have been fixed, and `evaluateCompletion` refuses an unanchored requirement
 * rather than closing on any green that wanders past.
 */
export function readerDiagnostic(
  instance: ReaderQuestionInstance,
  failureClass: FailureClass,
  detail: string,
  testedSha: string | null,
  now: string,
): WorkItem {
  return createWorkItem({
    project: "pilot-health",
    subject: instance.subjectBodyId ?? `zip:${instance.zip}`,
    /* The instance id is IN the obligation, which is what makes the derived
       id stable across runs and therefore what makes deduplication automatic
       rather than a lookup someone has to remember to do. */
    obligation: `reader-diagnostic:${failureClass}:${instance.id}`,
    why:
      `Reader question ${instance.id} (${JSON.stringify(instance.questionText)}) was submitted ` +
      `through the product's Ask interaction at zip ${instance.zip} and the rendered answer ` +
      `failed with class "${failureClass}": ${detail}`,
    priority: "P1",
    contract: {
      instrumentEvidence: {
        instrument: "READER_SUITE",
        instanceId: instance.id,
        createdAtSha: testedSha,
        requiredVerdict: "GREEN",
      },
      /* A reader question is answered by the reader surface, and the surface
         either answers it or does not. There is no separate validator whose
         record would add anything, and requiring one would mean an item could
         sit open with the question long since green. */
      requiresValidation: false,
    },
    now,
  });
}

/* ----------------------------------------------------------- persistence */

/** What one persist pass did, so the run record can state it rather than assume it. */
export interface DiagnosticPersistence {
  readonly created: readonly string[];
  /** Already open from an earlier run. Deduplicated, not re-created. */
  readonly existing: readonly string[];
}

/**
 * Persist every diagnostic, deduplicated.
 *
 * A `put` of an IDENTICAL value under an existing id is a no-op success and a
 * `put` of a DIFFERENT value is an `IdentityCollision` — the repository's own
 * rule. The `why` of a re-created item carries this run's detail, which WOULD
 * differ between runs, so an existing item is read first and left alone rather
 * than re-put. The obligation has not changed; only the sentence describing
 * the latest observation of it has, and rewriting history to hold the newest
 * phrasing is exactly what append-only storage exists to prevent.
 */
export async function persistDiagnostics(
  repos: ControlPlaneRepositories,
  items: readonly WorkItem[],
  now: string,
): Promise<DiagnosticPersistence> {
  const created: string[] = [];
  const existing: string[] = [];
  for (const item of items) {
    const already = await repos.workItems.read(item.id);
    if (already !== null) {
      existing.push(item.id);
      continue;
    }
    await repos.workItems.put(item.id, item, now);
    created.push(item.id);
  }
  return { created, existing };
}

/* --------------------------------------------------------------- closing */

/**
 * A run's verdicts, in the shape the closer needs.
 *
 * `testedSha` is the tree the run measured. A run with no SHA closes NOTHING:
 * it cannot be placed relative to any item's creation, and "it was green
 * somewhere" is not evidence that the code that failed now passes.
 */
export interface InstrumentRun {
  readonly instrument: "READER_SUITE" | "VISUAL_SUITE";
  readonly testedSha: string | null;
  /** Ids this run evaluated GREEN. Nothing else may be inferred from the run. */
  readonly greenInstanceIds: readonly string[];
}

export interface DiagnosticClosure {
  readonly closed: readonly string[];
  /** Items checked and left open, with the refusal that kept them open. */
  readonly refused: readonly { readonly id: string; readonly why: string }[];
}

/**
 * Close every diagnostic whose contract this run satisfies. Nothing else.
 *
 * The qualifying test is ANCESTRY, not equality: a run on a later commit that
 * contains the item's creation SHA is evidence about the fixed code, and
 * requiring an exact match would mean an item could only ever be closed by a
 * run on the very commit that failed — which by construction is red.
 *
 * `isAncestor` is supplied by the caller because ancestry is a git question
 * and this module does not shell out. A caller that cannot answer it passes a
 * function returning false, and nothing closes: refusing to close is always
 * the safe direction.
 */
export async function closeSatisfiedDiagnostics(
  repos: ControlPlaneRepositories,
  run: InstrumentRun,
  isAncestor: (ancestor: string, descendant: string) => boolean,
  now: string,
): Promise<DiagnosticClosure> {
  const closed: string[] = [];
  const refused: { id: string; why: string }[] = [];
  const greens = new Set(run.greenInstanceIds);

  for (const row of await repos.workItems.list()) {
    const item = row.value;
    const evidence = item.contract.instrumentEvidence;
    if (evidence === null || evidence.instrument !== run.instrument) continue;
    if (isTerminalState(item.state)) continue;

    /* The run must be placeable relative to the failure, and the instance must
       be one this run actually evaluated green. Both, or neither closes it. */
    const qualifies =
      run.testedSha !== null &&
      evidence.createdAtSha !== null &&
      isAncestor(evidence.createdAtSha, run.testedSha);

    const snapshot: CompletionSnapshot = {
      item,
      routeTasks: [],
      validations: [],
      audits: [],
      contradictions: [],
      upstreamStates: new Map(),
      denominatorComplete: null,
      instrumentGreens:
        qualifies && greens.has(evidence.instanceId)
          ? new Set([evidence.instanceId])
          : new Set<string>(),
      now,
    };

    const verdict = evaluateCompletion(snapshot, "VERIFIED_COMPLETE");
    if (!verdict.mayComplete) {
      refused.push({
        id: item.id,
        why: verdict.refusals.map((r) => `${r.code}: ${r.subject}`).join("; "),
      });
      continue;
    }

    await repos.workItems.compareAndSet(
      item.id,
      row.revision,
      {
        ...item,
        state: "VERIFIED_COMPLETE",
        transitions: [
          ...item.transitions,
          {
            from: item.state,
            to: "VERIFIED_COMPLETE",
            at: now,
            by: `${run.instrument.toLowerCase()}`,
            why:
              `a canonical ${run.instrument} run on ${run.testedSha} evaluated ` +
              `${evidence.instanceId} GREEN; that tree contains ${evidence.createdAtSha}, ` +
              "the commit the failure was observed on",
          },
        ],
      },
      now,
    );
    closed.push(item.id);
  }
  return { closed, refused };
}
