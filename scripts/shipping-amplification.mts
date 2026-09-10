#!/usr/bin/env tsx
/**
 * `pnpm ship:amplification` — **HOW MANY TIMES WAS ONE CHANGE CERTIFIED, AND
 * HOW LONG DID THE OWNER WAIT?** (FCP-9E, 2026-09-07.)
 *
 * ## The number this exists to make visible
 *
 * > The metric is not merely Actions cost. It is **owner time stranded waiting
 * > for machinery.**
 *
 * On 2026-09-07 one logical change — MapTiler quota isolation — bought runs
 * #804 through #808 and roughly forty-five minutes in which the owner could not
 * proceed. Nothing in this repository measured that. Actions cost was visible
 * on a billing page; the wait was visible only to the person doing the waiting.
 *
 * ## What it reads, and what it refuses to guess
 *
 * One shipping transaction is reconstructed per merge commit on `main`:
 *
 * ```
 *   the merge commit        the shipped tree
 *   parent 1                the base
 *   parent 2                the certified candidate
 *   runs at parent 2        the pre-merge certifications
 *   runs at the merge       the post-merge ones
 * ```
 *
 * **A run's KIND is measured, not inferred from its duration.** The jobs API is
 * asked whether the expensive steps actually ran — the install, the browser,
 * the suite, the builds. A run whose `Test` step is `skipped` did not run the
 * suite, whatever it cost. A run whose jobs cannot be read is `UNKNOWN` and is
 * counted separately rather than assumed cheap, because assuming cheap would
 * make every unreadable run improve the score.
 *
 * Minutes come from the platform's own `/timing` endpoint. On a public
 * repository the BILLABLE figure is zero — Actions minutes are free there — so
 * the runner's wall-clock is used instead and the footnote says so. A run that
 * reports neither prints NOT MEASURED, never `0`, which would assert a
 * measurement nobody took.
 *
 *   pnpm ship:amplification                 the last 10 merges
 *   pnpm ship:amplification --merges=30     more history
 *   pnpm ship:amplification --sha=<merge>   one transaction, in detail
 *   pnpm ship:amplification --json          machine-readable
 *
 * Read-only. It calls `gh api` and git, writes nothing, and exits 0 even when
 * it finds defects — it is a measurement, and a measurement that failed the
 * build would be a gate wearing a report's name.
 */

import { execFileSync } from "node:child_process";

import {
  openTransaction,
  recordCertification,
  recordMerge,
  isRefusal,
  type CertificationKind,
  type CertificationOutcome,
  type CertificationRecord,
  type ShippingTransaction,
} from "../lib/control-plane/shipping/transaction.ts";
import {
  readAmplification,
  rollUpAmplification,
  type AmplificationReading,
} from "../lib/control-plane/shipping/amplification.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const arg = (name: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const MERGES = Number(arg("merges") ?? 10);
const ONE = arg("sha");
const AS_JSON = argv.includes("--json");

/**
 * The expensive steps, by the exact name `build-check.yml` gives them. A run
 * that ran any of these bought the expensive tier; a run that ran none of them
 * did not. Anchored on step NAMES rather than on durations, because a slow
 * cheap run and a fast full run are both real and duration cannot tell them
 * apart.
 */
const EXPENSIVE_STEPS = [
  "Install",
  "Test",
  "Install the browser the suite needs",
  "Build (the command netlify.toml gives Netlify)",
];

/** Steps whose presence names the run's cheap kind, in precedence order. */
const ATTESTATION_STEPS: ReadonlyArray<{ step: string; kind: CertificationKind }> = [
  { step: "Certified tree reused — this tree already passed", kind: "TREE_EQUIVALENCE_ATTESTATION" },
  { step: "Preflight was red — nothing expensive was bought", kind: "PREFLIGHT_REFUSED" },
];

function git(...args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
  } catch {
    return null;
  }
}

function gh<T>(path: string): T | null {
  try {
    const out = execFileSync("gh", ["api", path], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60_000,
    });
    return JSON.parse(out) as T;
  } catch {
    return null;
  }
}

const repo = process.env.GITHUB_REPOSITORY ?? "SeanJ22/meanwhile";

interface RunSummary {
  readonly id: string;
  readonly name: string;
  readonly headSha: string;
  readonly conclusion: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

function runsAt(sha: string): readonly RunSummary[] | null {
  const body = gh<{ workflow_runs?: unknown[] }>(
    `repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`,
  );
  if (body === null) return null;
  return (body.workflow_runs ?? []).map((r) => {
    const run = r as Record<string, unknown>;
    return {
      id: String(run.id),
      name: String(run.name ?? ""),
      headSha: String(run.head_sha ?? ""),
      conclusion: run.conclusion === null || run.conclusion === undefined ? null : String(run.conclusion),
      startedAt: String(run.run_started_at ?? run.created_at ?? ""),
      endedAt: run.updated_at ? String(run.updated_at) : null,
    };
  });
}

/**
 * What did this run actually buy?
 *
 * `UNKNOWN` when the jobs could not be read. It is a real value here and it is
 * counted as such: a reader that treated an unreadable run as cheap would score
 * every API failure as an improvement.
 */
function kindOf(runId: string): { kind: CertificationKind | "UNKNOWN"; why: string } {
  const body = gh<{ jobs?: unknown[] }>(`repos/${repo}/actions/runs/${runId}/jobs?per_page=100`);
  if (body === null) return { kind: "UNKNOWN", why: "the jobs could not be read" };
  const ran = new Set<string>();
  for (const j of body.jobs ?? []) {
    for (const s of ((j as Record<string, unknown>).steps ?? []) as unknown[]) {
      const step = s as Record<string, unknown>;
      if (step.conclusion !== "skipped" && step.conclusion !== null) {
        ran.add(String(step.name ?? ""));
      }
    }
  }
  if (ran.size === 0) return { kind: "UNKNOWN", why: "no step reported a conclusion" };
  const expensive = EXPENSIVE_STEPS.filter((s) => ran.has(s));
  if (expensive.length > 0) {
    return { kind: "FULL", why: `ran ${expensive.join(", ")}` };
  }
  for (const row of ATTESTATION_STEPS) {
    if (ran.has(row.step)) return { kind: row.kind, why: `ran "${row.step}" and nothing expensive` };
  }
  return { kind: "UNKNOWN", why: "no expensive step and no attestation step reported" };
}

/**
 * Runner minutes, or null when the platform reported none.
 *
 * **BILLABLE IS ZERO ON THIS REPOSITORY AND THAT IS NOT THE ANSWER.** Measured
 * 2026-09-07 against run 34150760247: `billable.UBUNTU.total_ms` is 0 with
 * three jobs, because Actions minutes are free on a public repository, while
 * `run_duration_ms` is 792000 — thirteen real minutes of runner time and
 * thirteen real minutes of the owner not proceeding.
 *
 * Reporting the billable zero would say a run cost nothing, which is true about
 * the invoice and false about everything this measurement is for. So billable
 * wins when it is non-zero, and the platform's own wall-clock is used when it is
 * not. `billableWasZero` says which, so the footnote can be honest about it.
 */
function minutesOf(runId: string): { minutes: number | null; billableWasZero: boolean } {
  const body = gh<{
    billable?: Record<string, { total_ms?: number }>;
    run_duration_ms?: number;
  }>(`repos/${repo}/actions/runs/${runId}/timing`);
  if (body === null) return { minutes: null, billableWasZero: false };
  let ms = 0;
  for (const platform of Object.values(body.billable ?? {})) {
    if (typeof platform.total_ms === "number") ms += platform.total_ms;
  }
  if (ms > 0) return { minutes: ms / 60_000, billableWasZero: false };
  const wall = body.run_duration_ms;
  if (typeof wall === "number" && wall > 0) {
    return { minutes: wall / 60_000, billableWasZero: true };
  }
  return { minutes: null, billableWasZero: false };
}

function outcomeOf(conclusion: string | null): CertificationOutcome {
  if (conclusion === "success") return "GREEN";
  if (conclusion === "cancelled") return "CANCELLED";
  if (conclusion === null) return "IN_FLIGHT";
  return "RED";
}

interface Reconstructed {
  readonly reading: AmplificationReading;
  readonly mergeSha: string;
  readonly candidateSha: string;
  readonly treeReused: boolean;
  readonly unknownRuns: number;
  readonly billableWasZero: boolean;
}

function reconstruct(mergeSha: string): Reconstructed | { readonly problem: string } {
  const parentLine = git("rev-list", "--parents", "-n", "1", mergeSha);
  const parents = parentLine === null ? [] : parentLine.split(/\s+/).slice(1);
  if (parents.length !== 2) {
    return { problem: `${mergeSha.slice(0, 8)} is not a two-parent merge` };
  }
  const [base, candidate] = parents;
  const mergeTree = git("rev-parse", `${mergeSha}^{tree}`);
  const candidateTree = git("rev-parse", `${candidate}^{tree}`);

  const subject = git("log", "-1", "--format=%s", mergeSha) ?? mergeSha.slice(0, 8);

  let txn: ShippingTransaction = openTransaction({
    id: `txn-${mergeSha.slice(0, 12)}`,
    headline: subject,
    denominator: [],
    now: git("log", "-1", "--format=%cI", candidate) ?? new Date().toISOString(),
  });

  let unknownRuns = 0;
  let billableWasZero = false;
  const record = (run: RunSummary): void => {
    const { kind } = kindOf(run.id);
    const timing = minutesOf(run.id);
    if (timing.billableWasZero) billableWasZero = true;
    if (kind === "UNKNOWN") unknownRuns += 1;
    const entry: CertificationRecord = {
      kind: kind === "UNKNOWN" ? "FULL" : kind,
      outcome: outcomeOf(run.conclusion),
      runId: run.id,
      sha: run.headSha,
      tree: null,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      runnerMinutes: timing.minutes,
      invalidation: null,
      invalidationEvidence: null,
    };
    txn = recordCertification(txn, entry);
  };

  /*
   * UNKNOWN is recorded as FULL above, deliberately. The reading is a cost
   * measurement, and a run nobody could classify may have been expensive; the
   * count of unknowns is reported beside the number so the reader can see how
   * much of the answer rests on that.
   */
  for (const sha of [candidate, mergeSha]) {
    const runs = runsAt(sha);
    if (runs === null) continue;
    for (const run of runs) {
      if (run.name !== "Build check") continue;
      record(run);
    }
  }

  if (mergeTree !== null) {
    const merged = recordMerge(txn, { sha: mergeSha, tree: mergeTree });
    if (!isRefusal(merged)) txn = merged;
  }

  return {
    reading: readAmplification(txn),
    mergeSha,
    candidateSha: candidate,
    treeReused: mergeTree !== null && mergeTree === candidateTree,
    unknownRuns,
    billableWasZero,
  };
}

/* ------------------------------------------------------------------ main --- */

const merges = ONE
  ? [ONE]
  : (git("log", "--merges", "--format=%H", `-${MERGES}`, "main") ?? "").split("\n").filter(Boolean);

if (merges.length === 0) {
  console.error("ship:amplification · no merge commits found on main — nothing to measure");
  process.exit(1);
}

const results: Reconstructed[] = [];
const problems: string[] = [];
for (const sha of merges) {
  const out = reconstruct(sha);
  if ("problem" in out) problems.push(out.problem);
  else results.push(out);
}

if (AS_JSON) {
  console.log(JSON.stringify({ results, problems }, null, 2));
  process.exit(0);
}

console.log("");
console.log("SHIPPING AMPLIFICATION — full hosted certifications per logical change");
console.log("");
console.log(
  "  merge     tree=cert  FULL  cheap  cancelled  minutes  owner wait  headline",
);
console.log(`  ${"-".repeat(96)}`);

for (const r of results) {
  const a = r.reading;
  const minutes = a.runnerMinutes === null ? "  NOT MEAS" : `${a.runnerMinutes.toFixed(1).padStart(9)}`;
  const wait = a.ownerWaitMinutes === null ? "  NOT MEAS" : `${a.ownerWaitMinutes.toFixed(0).padStart(7)}m`;
  console.log(
    `  ${r.mergeSha.slice(0, 8)}  ${(r.treeReused ? "YES" : "no ").padEnd(9)}  ` +
      `${String(a.fullCertifications).padStart(4)}  ${String(a.cheapAttestations).padStart(5)}  ` +
      `${String(a.supersededCertifications).padStart(9)}  ${minutes}  ${wait}  ` +
      `${a.headline.slice(0, 44)}`,
  );
  for (const row of a.beyondFirst) {
    console.log(`            ↳ beyond the first: run ${row.runId ?? "?"} — ${row.reason}`);
  }
  if (r.unknownRuns > 0) {
    console.log(
      `            ↳ ${r.unknownRuns} run(s) could not be classified and are counted as FULL`,
    );
  }
}

const rollup = rollUpAmplification(results.map((r) => r.reading));
const eligible = results.filter((r) => r.treeReused).length;

console.log("");
console.log(
  "  " +
    floorLine(
      floored("merges measured", "git log --merges on main", merges.length, results.length),
    ),
);
console.log(
  `  full certifications        ${rollup.fullCertifications} across ${rollup.transactions} transaction(s)` +
    `${rollup.certificationsPerTransaction === null ? "" : ` — ${rollup.certificationsPerTransaction.toFixed(2)} each`}`,
);
console.log(`  cheap attestations         ${rollup.cheapAttestations}`);
console.log(`  superseded / cancelled     ${rollup.supersededCertifications}`);
console.log(
  `  hosted runner minutes      ${rollup.runnerMinutes === null ? "NOT MEASURED" : rollup.runnerMinutes.toFixed(1)}`,
);
console.log(
  `  mean owner wait            ${rollup.meanOwnerWaitMinutes === null ? "NOT MEASURED" : `${rollup.meanOwnerWaitMinutes.toFixed(0)} minutes`}`,
);
console.log(
  `  tree-equivalent merges     ${eligible} of ${results.length} — each of these can attest instead of ` +
    "re-certifying on the main side (FCP-9C)",
);
console.log(`  defects                    ${rollup.defects.length}`);
if (results.some((r) => r.billableWasZero)) {
  console.log("");
  console.log(
    "  Minutes above are RUNNER WALL-CLOCK. GitHub reports billable=0 for this repository",
  );
  console.log(
    "  because Actions minutes are free on a public repo; the wall-clock is the real runner",
  );
  console.log("  time, and the real time the owner spent unable to proceed.");
}
for (const defect of rollup.defects.slice(0, 10)) {
  console.log(`     ${defect.defect} · ${defect.transactionId} · ${defect.detail}`);
}
for (const problem of problems) console.log(`  could not measure: ${problem}`);
console.log("");
