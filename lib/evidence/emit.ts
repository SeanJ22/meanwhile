/**
 * The research ledger: one committed row per rung, written AS IT HAPPENS.
 *
 * ## Why this is a file and not a habit
 *
 * A scorecard reconstructed from memory at the end of a long session is a
 * narrative, and narratives rationalize. They remember the rung that worked
 * and forget the four that did not; they remember a capability as reusable
 * because it felt reusable; they round a forty-minute dead end down to
 * nothing because nothing came of it. Every one of those errors flatters the
 * same conclusion — that the work was cheaper and cleaner than it was.
 *
 * So the ledger is append-only and written at the moment of the attempt. The
 * session report is a RENDERING of this file. Anything not in here did not
 * happen, and a cost not recorded here is not in the headline.
 *
 * ## The classification lifecycle
 *
 * Reuse cannot be known at first solve. A capability built for one town is
 * only proven reusable when a second town uses it, and that may be an hour
 * later or never. So every field carries a `provisionalClass`, written when
 * it is solved or exhausted, and a `finalClass` resolved at session end.
 * Transitions are recorded as their own immutable events rather than by
 * overwriting, because "this looked bespoke and turned out to be reusable"
 * is itself the finding the experiment is trying to measure.
 *
 * ## The honest hole
 *
 * `unmeasured` is a first-class outcome here, with a reason. Acquisition
 * outranks measurement: where capturing a timing cleanly would have cost
 * hunting time, the row says so. A hole in the instrument is strictly better
 * than a hole in the data, and pretending the hole is not there is how an
 * instrument starts lying.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export const EVIDENCE_PATH = "docs/evidence/h-03255.jsonl";

/** Where a unit of work sat in the session. */
export type Phase =
  | "retrieval"
  | "reusable-build"
  | "reuse"
  | "bespoke"
  | "verification"
  | "documentation";

/**
 * The capability classes. `C-STRUCT` and `C-AUTO` are deliberately NOT named
 * `C1`/`C2`: those names belong to the experiment's controls, and "C2 rose
 * after applying C2" is a sentence no future reader should have to parse.
 *
 * Bucket C is CURRENTLY BESPOKE, never "permanently manual". One session can
 * prove that the baseline did not automate something and that this session
 * chose not to. It cannot prove that nothing ever will.
 */
export type CapabilityClass =
  | "A1" // baseline-refreshable: the session-start recipe reproduces it
  | "A0" // inherited snapshot only: the value exists, no path refreshes it
  | "B0" // session-built, reuse intended, not yet demonstrated in-sweep
  | "B1" // session-built, reuse PROVEN in-sweep
  | "C-STRUCT" // structurally bespoke: no credible reusable path found
  | "C-AUTO" // automation candidate: named, not built
  | "D" // unresolved: ladder exhausted, wall named
  | "unmeasured";

export type RungOutcome =
  | "HIT"
  | "MISS"
  | "REFUSED"
  | "ERROR"
  | "NOT_ATTEMPTED"
  | "SUPERSEDED";

export interface EvidenceRow {
  /** ISO, from the system clock. Never a plausible-looking guess. */
  at: string;
  kind: "rung" | "field" | "transition" | "capability" | "note" | "denominator";
  subjectId: string;
  subjectType?: string;
  field?: string;
  /** Which universe this subject sits in: governs, meetings-near, or both. */
  universe?: "governs" | "meetings-near" | "both" | "ballot" | "n/a";
  /** 1–14 of `ladder vH-start`, as frozen in CLAUDE.md. */
  rung?: number;
  rungLabel?: string;
  attemptedAt?: string;
  outcome?: RungOutcome;
  url?: string;
  wallType?: string;
  provisionalClass?: CapabilityClass;
  finalClass?: CapabilityClass;
  phase?: Phase;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  activeDurationMs?: number;
  /** Set when a timing or class could not be captured cleanly, and why. */
  unmeasuredReason?: string;
  sourceFamily?: string;
  /** Free text. The row's own words, for the report to quote. */
  note?: string;
  /** Counts, always stated: an operation that can return nothing is asked. */
  counts?: Record<string, number>;
}

function ensureDir(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Appends one row. Append-only by construction — nothing here ever rewrites. */
export function emit(row: Omit<EvidenceRow, "at"> & { at?: string }): EvidenceRow {
  const full: EvidenceRow = { at: row.at ?? new Date().toISOString(), ...row } as EvidenceRow;
  ensureDir(EVIDENCE_PATH);
  appendFileSync(EVIDENCE_PATH, `${JSON.stringify(full)}\n`, "utf8");
  return full;
}

/** Reads the ledger back. Malformed lines are reported, never skipped silently. */
export function readEvidence(path: string = EVIDENCE_PATH): EvidenceRow[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "");
  const rows: EvidenceRow[] = [];
  const bad: number[] = [];
  lines.forEach((l, i) => {
    try {
      rows.push(JSON.parse(l) as EvidenceRow);
    } catch {
      bad.push(i + 1);
    }
  });
  if (bad.length) {
    throw new Error(`${path}: ${bad.length} unparseable line(s) at ${bad.join(", ")}`);
  }
  return rows;
}

/**
 * Times one unit of work and writes its row.
 *
 * Wall-clock and active duration are reported separately and both are kept.
 * A commit timestamp is an AUDIT RECEIPT proving when an artifact entered the
 * repository; it is not a stopwatch, and a commit at 14:00 says nothing about
 * whether the parser inside it took twenty minutes or two hours.
 */
export async function timed<T>(
  meta: Omit<EvidenceRow, "at" | "startedAt" | "endedAt" | "durationMs">,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = new Date().toISOString();
  const t0 = process.hrtime.bigint();
  try {
    return await fn();
  } finally {
    const t1 = process.hrtime.bigint();
    emit({
      ...meta,
      startedAt,
      endedAt: new Date().toISOString(),
      // Monotonic nanoseconds to milliseconds. Written as a Number division
      // rather than a BigInt literal so the module compiles under the repo's
      // ES target, which is below ES2020.
      durationMs: Math.round(Number(t1 - t0) / 1e6),
    });
  }
}
