/**
 * PER-SOURCE GATE ISOLATION — THE DECISION, SEPARATED FROM ITS PLUMBING.
 * (2026-09-02, the refresh-failure session; Work Item 1.3.)
 *
 * ## What happened, twice
 *
 * The scheduled refresh of 2026-09-01 ran three sources clean — meetings,
 * nj-filing, dotgov — and every one of their artifacts was thrown away because
 * ONE test refused ONE source's data (`tests/concluded.test.ts`, New London).
 * On 2026-09-02 the same three ran clean again and five tests refused, four of
 * them about one source. Both days the reader saw what they saw yesterday, and
 * the run report said "3 clean".
 *
 * The suite is right to refuse. What was wrong is that a refusal of ONE
 * source's bytes cost EVERY source's bytes, with nothing anywhere recording
 * which source was refused or that it was owed.
 *
 * ## The rule
 *
 * A red suite is ATTRIBUTED before anything is thrown away. Each source whose
 * governed paths changed is reverted to HEAD alone, and only the failing test
 * files are re-run:
 *
 *   - a file that PASSES with source S reverted is S's — its data is what the
 *     file refuses;
 *   - a file that passes only when EVERY changed source is reverted is the
 *     refresh's jointly — every changed source is culpable;
 *   - a file that still fails with every changed source reverted is the
 *     TREE's, not any source's data. It was red on `main` before the refresh
 *     ran and it would be red on a quiet day. Nothing is committed under it,
 *     because nothing about the data was proved.
 *
 * Culprits' paths go back to HEAD and become DURABLE FRESHNESS DEBT with a
 * next-due day; survivors commit. `scripts/refresh-gate.mts` does the
 * reverting and the running; this module decides, so the decision can be held
 * against fixed inputs without a suite, a git tree or a network.
 */

import type { GateAttribution } from "./refresh-report.ts";

/**
 * The test FILES a `node --test` run reported failing, from its own output.
 *
 * The spec reporter ends a red run with a `✖ failing tests:` section whose
 * entries carry `test at tests/<file>.test.ts:<line>:<col>`. Those lines are
 * the authority; a stack frame naming a test file is accepted only inside
 * that section, and anywhere else a path in a log line is a path in a log
 * line. Deduplicated, in first-seen order.
 */
export function failingTestFiles(suiteOutput: string): string[] {
  const marker = suiteOutput.search(/failing tests:/);
  const tail = marker >= 0 ? suiteOutput.slice(marker) : "";
  const files: string[] = [];
  const seen = new Set<string>();
  const add = (f: string) => {
    const normalised = f.replace(/\\/g, "/");
    if (!seen.has(normalised)) {
      seen.add(normalised);
      files.push(normalised);
    }
  };
  for (const m of tail.matchAll(/^\s*test at ((?:tests[\\/])[^\s:]+\.test\.ts):\d+:\d+/gm)) add(m[1]!);
  if (files.length === 0) {
    // No section: the reporter died before its summary. `test at` anywhere is
    // still the reporter's own attribution and is taken; nothing else is.
    for (const m of suiteOutput.matchAll(/^\s*test at ((?:tests[\\/])[^\s:]+\.test\.ts):\d+:\d+/gm)) add(m[1]!);
  }
  return files;
}

/** One revert trial: which failing files PASSED with this source's paths at HEAD. */
export interface RevertTrial {
  sourceId: string;
  passing: readonly string[];
}

export interface AttributionInput {
  /** The files the full suite reported failing. */
  failing: readonly string[];
  /** Every source whose governed paths differ from HEAD, in cadence order. */
  changedSources: readonly string[];
  /** One trial per changed source. */
  trials: readonly RevertTrial[];
  /** The files that passed with EVERY changed source reverted, or null if that trial was not run. */
  allRevertedPassing: readonly string[] | null;
}

export type AttributionVerdict =
  /** Nothing failed. */
  | "GREEN"
  /** Every failing file belongs to a source; survivors commit, culprits become debt. */
  | "ATTRIBUTED"
  /** At least one failing file is the tree's. Nothing commits under a red the data did not cause. */
  | "TREE_RED"
  /** The suite failed and named no file, so nothing can be attributed. */
  | "UNNAMED";

export interface AttributionResult {
  verdict: AttributionVerdict;
  culprits: string[];
  survivors: string[];
  byFile: GateAttribution[];
  /** Files that fail with every changed source reverted. */
  treeFiles: string[];
}

export function attributeFailures(input: AttributionInput): AttributionResult {
  const changed = [...input.changedSources];
  if (input.failing.length === 0) {
    return { verdict: "GREEN", culprits: [], survivors: changed, byFile: [], treeFiles: [] };
  }
  const byFile: GateAttribution[] = [];
  const culprits = new Set<string>();
  const treeFiles: string[] = [];

  for (const file of input.failing) {
    const fixedBy = input.trials.filter((t) => t.passing.includes(file)).map((t) => t.sourceId);
    if (fixedBy.length === 1) {
      culprits.add(fixedBy[0]!);
      byFile.push({ file, sourceId: fixedBy[0]!, basis: `passes with ${fixedBy[0]}'s governed paths at HEAD` });
      continue;
    }
    if (fixedBy.length > 1) {
      // Reverting ANY one of several makes it pass: the file refuses the
      // COMBINATION, and every party to it is culpable.
      for (const s of fixedBy) {
        culprits.add(s);
        byFile.push({ file, sourceId: s, basis: `passes with ${s}'s governed paths at HEAD (and with ${fixedBy.filter((x) => x !== s).join(", ")}'s)` });
      }
      continue;
    }
    if (input.allRevertedPassing?.includes(file)) {
      // Only the whole refresh reverted makes it pass: jointly the changed
      // sources', and every one of them is culpable.
      for (const s of changed) {
        culprits.add(s);
        byFile.push({ file, sourceId: s, basis: "passes only with every changed source's governed paths at HEAD — the refresh's jointly" });
      }
      continue;
    }
    treeFiles.push(file);
    byFile.push({
      file,
      sourceId: null,
      basis:
        input.allRevertedPassing === null
          ? "no single source's revert makes it pass, and the all-sources trial was not run"
          : "fails with every changed source's governed paths at HEAD — the tree's, not any source's data",
    });
  }

  if (input.changedSources.length === 0 || treeFiles.length > 0) {
    return {
      verdict: "TREE_RED",
      culprits: [...culprits],
      survivors: [],
      byFile,
      treeFiles,
    };
  }
  return {
    verdict: "ATTRIBUTED",
    culprits: [...culprits],
    survivors: changed.filter((s) => !culprits.has(s)),
    byFile,
    treeFiles,
  };
}

/** The reason a refused source's row carries, built from its attributed files. */
export function refusalReason(sourceId: string, byFile: readonly GateAttribution[]): string {
  const files = byFile.filter((a) => a.sourceId === sourceId).map((a) => a.file);
  const unique = [...new Set(files)];
  return `the gate refused this source's data: ${unique.join(", ")} — its governed paths are back at HEAD and it is owed until it lands`;
}
