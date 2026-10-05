/**
 * SC-16: operational readiness counted apart from civic completeness.
 *
 * ACQ (finding sources), REC (recovery), PUB (public delivery) and ASK (answers)
 * are about how well the system works, not what a place's residents are owed.
 * They are counted here as their own readiness counts with the evidence behind
 * each witnessed row, and are never added to a place's civic completeness
 * (place-measures.ts reads only the "core" and "extension" rows).
 *
 * A row nothing witnesses is "not measured". It is never a pass.
 */
import { CHECKLIST_ITEMS, CHECKLIST_FAMILIES } from "./checklist-map.ts";

export const READINESS_GROUPS = ["ACQ", "REC", "PUB", "ASK"] as const;
export type ReadinessGroup = (typeof READINESS_GROUPS)[number];

export type ReadinessState = "witnessed" | "failing" | "not_measured";

export interface ReadinessWitness {
  readonly state: "witnessed" | "failing";
  /** What was read, in plain English, shown beside the count. */
  readonly evidence: string;
}

export interface ReadinessRow {
  readonly id: string;
  readonly state: ReadinessState;
  readonly evidence: string | null;
}

export interface ReadinessCount {
  readonly group: ReadinessGroup;
  readonly name: string;
  readonly witnessed: number;
  readonly failing: number;
  readonly notMeasured: number;
  readonly of: number;
  readonly rows: readonly ReadinessRow[];
}

/** The ids counted as rows in a group. Shared rows count under the row they fold into. */
export function readinessItemIds(group: ReadinessGroup): readonly string[] {
  return Object.keys(CHECKLIST_ITEMS)
    .filter(id => id.startsWith(`${group}-`) && CHECKLIST_ITEMS[id]?.countsAs === "row")
    .sort();
}

/** A witness recorded for a shared id counts for the row it folds into. */
function witnessFor(id: string, witnesses: Readonly<Record<string, ReadinessWitness | undefined>>): ReadinessWitness | undefined {
  if (witnesses[id]) return witnesses[id];
  for (const [other, rule] of Object.entries(CHECKLIST_ITEMS)) {
    if (rule?.countsAs === "shared" && rule.into === id && witnesses[other]) return witnesses[other];
  }
  return undefined;
}

export function readinessCounts(witnesses: Readonly<Record<string, ReadinessWitness | undefined>>): readonly ReadinessCount[] {
  return READINESS_GROUPS.map(group => {
    const rows: ReadinessRow[] = readinessItemIds(group).map(id => {
      const w = witnessFor(id, witnesses);
      return { id, state: w ? w.state : "not_measured", evidence: w?.evidence ?? null };
    });
    const count = (s: ReadinessState) => rows.filter(r => r.state === s).length;
    return {
      group,
      name: CHECKLIST_FAMILIES[group]?.name ?? group,
      witnessed: count("witnessed"),
      failing: count("failing"),
      notMeasured: count("not_measured"),
      of: rows.length,
      rows,
    };
  });
}

/** Counts already held that witness the recovery (REC) rows. A count we do not have is null. */
export interface RecoveryEvidence {
  /** Bank entries a worker was handed at dispatch, and how many it then used or rejected with a reason. */
  readonly bankEntriesInherited: number | null;
  readonly bankEntriesUsed: number | null;
  /** Failure debts, and how many carry a saved reason. */
  readonly failureDebts: number | null;
  readonly failureDebtsWithReason: number | null;
  /** Absences on record, and how many keep their attempted routes and a recheck date. */
  readonly absences: number | null;
  readonly absencesWithRecheck: number | null;
  /** Findings written back to the shared manual by the supported path. */
  readonly manualWriteBacks: number | null;
}

/** Maps what already exists onto REC rows. Only rows with a real reading are returned. */
export function recoveryWitnesses(e: RecoveryEvidence): Readonly<Record<string, ReadinessWitness>> {
  const out: Record<string, ReadinessWitness> = {};
  if (e.bankEntriesInherited !== null) {
    out["REC-08"] = e.bankEntriesInherited > 0
      ? { state: "witnessed", evidence: `${e.bankEntriesInherited} Bank entries were recorded as handed to workers at dispatch.` }
      : { state: "failing", evidence: "No Bank entry has been recorded as handed to a worker." };
  }
  if (e.bankEntriesInherited !== null && e.bankEntriesUsed !== null && e.bankEntriesInherited > 0) {
    out["REC-09"] = { state: e.bankEntriesUsed > 0 ? "witnessed" : "failing", evidence: `${e.bankEntriesUsed} of ${e.bankEntriesInherited} handed entries show use or a reason for not using them.` };
  }
  if (e.failureDebts !== null && e.failureDebtsWithReason !== null) {
    out["REC-01"] = {
      state: e.failureDebtsWithReason === e.failureDebts ? "witnessed" : "failing",
      evidence: `${e.failureDebtsWithReason} of ${e.failureDebts} failure debts carry a saved reason.`,
    };
  }
  if (e.absences !== null && e.absencesWithRecheck !== null) {
    out["REC-13"] = {
      state: e.absencesWithRecheck === e.absences ? "witnessed" : "failing",
      evidence: `${e.absencesWithRecheck} of ${e.absences} absences keep their routes and a recheck date.`,
    };
  }
  if (e.manualWriteBacks !== null) {
    out["REC-10"] = e.manualWriteBacks > 0
      ? { state: "witnessed", evidence: `${e.manualWriteBacks} findings were written back to the shared manual.` }
      : { state: "failing", evidence: "No finding has been written back to the shared manual." };
  }
  return out;
}
