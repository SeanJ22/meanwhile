/**
 * `pnpm orchestration:check` — the engineering-team validator (RULING 190).
 *
 * It reads every session orchestration plan in `data/workstate/orchestration/`
 * and derives, per plan, whether independent executable work was serialized
 * without a proven dependency.
 *
 * **What it does NOT measure.** It does not count branches. A branch count
 * rewards fragmentation, and three branches rewriting one module is worse than
 * one branch rather than better. The semantic checked is the rule itself:
 * independent + executable + serialized with nothing checkable behind it.
 *
 * **The observability limit, stated rather than hidden.** Wall-clock
 * concurrency is not observable from this repository, so a plan declaring
 * `PARALLEL` is taken at its word. What is checked is the shape of the plan and
 * the justification of every serialization — the two things actually written
 * down. `concurrencyEvidence` is reported as corroboration and never scored.
 *
 *   pnpm orchestration:check          check every plan on disk
 *   pnpm orchestration:check --plan <path>
 *
 * A repository with no plan on disk is not a failure — most sessions carry one
 * workstream. A plan that exists and cannot be evaluated IS a failure, because
 * an uncheckable plan is not evidence that the rule was followed.
 *
 * ## `--closeout` — the declared plan against what actually ran
 *
 * The plan check above is a plan compared against itself, and that is its
 * ceiling: it cannot see work the plan never heard of. On 2026-08-28 a session
 * declared ten workstreams, ran thirteen, reported twelve — the BRANCH COUNT —
 * and passed. `--closeout` is the reconciliation that catches it, and it is
 * opt-in because it needs observed state the plan does not carry.
 *
 *   # observed refs given explicitly (kind:ref, or a bare ref meaning a branch)
 *   pnpm orchestration:check --closeout \
 *     --plan data/workstate/orchestration/2026-08-28-finish-aug28.json \
 *     --artifacts ws/acq,ws/ask,worktree:C:/Users/seanj/dev/wtp-wt/ask
 *
 *   # observed refs read from git — local ws/*, remote origin/ws/*, and worktrees
 *   pnpm orchestration:check --closeout --plan <path> --artifacts-from-git
 *
 *   # ids the session says it actually executed, canonical ids only
 *   pnpm orchestration:check --closeout --plan <path> --executed mtg13-legistar,ask-shape-votes
 *
 *   # the integration owner's own refs, so they are not read as unaccounted work
 *   pnpm orchestration:check --closeout --plan <path> --integration-artifacts claude/finish-aug28-integration
 *
 * `--closeout` requires `--plan`. Observed artifacts belong to ONE session, and
 * reconciling one session's refs against every plan on disk would manufacture
 * unaccounted artifacts for each plan that is not the one that ran. The refusal
 * names that rather than picking a plan for the operator.
 *
 * **What `--closeout` never does is count branches.** It reports the declared
 * workstream count and the observed artifact count as two separate numbers and
 * says in the report itself that neither is the other.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import {
  EXECUTION_ARTIFACT_KINDS,
  classifyOrchestration,
  type ExecutionArtifact,
  type ExecutionArtifactKind,
  type OrchestrationPlan,
} from "../lib/workstate/orchestration.ts";
import { reconcileCloseout } from "../lib/workstate/orchestration-closeout.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_DIR = join(ROOT, "data", "workstate", "orchestration");

const argv = process.argv.slice(2);
const flag = (name: string): string | null =>
  argv.includes(name) ? (argv[argv.indexOf(name) + 1] ?? null) : null;
const explicit = flag("--plan");
const closeout = argv.includes("--closeout");

/** `kind:ref`, or a bare ref meaning a branch. Anything else is refused by name. */
function parseArtifact(token: string): ExecutionArtifact {
  const t = token.trim();
  const at = t.indexOf(":");
  if (at > 0) {
    const kind = t.slice(0, at);
    if ((EXECUTION_ARTIFACT_KINDS as readonly string[]).includes(kind)) {
      return { kind: kind as ExecutionArtifactKind, ref: t.slice(at + 1) };
    }
  }
  // Windows worktree paths carry a drive colon, and a ref may carry one too, so
  // an unrecognised prefix is NOT an error — it is part of the ref.
  return { kind: "branch", ref: t };
}

const parseList = (v: string | null): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Observed refs, read from git rather than typed.
 *
 * `maxBuffer` is set explicitly because the default is 1 MB and `execFileSync`
 * THROWS past it — a catch-all around that turns a truncated read into a false
 * fact about how many refs exist, which is the exact class of defect this
 * script exists to catch.
 */
function artifactsFromGit(): ExecutionArtifact[] {
  const run = (args: string[]): string =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

  const out: ExecutionArtifact[] = [];
  const refs = run([
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads/ws",
    "refs/remotes/origin/ws",
  ])
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const r of refs) out.push({ kind: "branch", ref: r.replace(/^origin\//, "") });

  for (const line of run(["worktree", "list", "--porcelain"]).split("\n")) {
    const m = /^worktree (.+)$/.exec(line.trim());
    if (m) out.push({ kind: "worktree", ref: m[1].replace(/\\/g, "/") });
  }

  // De-duplicate: a local ws/x and its origin/ws/x are ONE artifact, and
  // counting them twice would inflate a number this report insists is exact.
  const seen = new Set<string>();
  return out.filter((a) => {
    const k = `${a.kind}:${a.ref}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const planPaths = explicit
  ? [explicit]
  : existsSync(PLAN_DIR)
    ? readdirSync(PLAN_DIR)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => join(PLAN_DIR, f))
    : [];

if (closeout && !explicit) {
  console.error(
    "orchestration:check --closeout requires --plan <path>.\n" +
      "Observed refs belong to ONE session. Reconciling them against every plan on disk would\n" +
      "manufacture unaccounted artifacts for every plan that is not the one that ran — a wrong\n" +
      "answer that looks like a finding. Name the plan.",
  );
  process.exit(1);
}

if (planPaths.length === 0) {
  console.log("orchestration:check   no session plan on disk");
  console.log("                      a single-workstream session owes none (RULING 190)");
  console.log("\norchestration:check PASSED");
  process.exit(0);
}

let failed = 0;

for (const p of planPaths) {
  const plan = JSON.parse(readFileSync(p, "utf8")) as OrchestrationPlan;
  const v = classifyOrchestration(plan);
  const rel = p.replace(ROOT, "").replace(/^[\\/]/, "").replace(/\\/g, "/");

  console.log(`\n${"=".repeat(72)}`);
  // RULING 159 — a plan that parses to ZERO workstreams is a FAILED read, not a
  // session that ran no work. Without this floor the report would print
  // "0 workstream(s)" and PASS, which is the exact shape of a guard agreeing
  // with a broken instrument.
  console.log(
    floorLine(
      floored("orchestration:check workstreams", rel, v.counts.workstreams, v.counts.executable),
    ),
  );
  console.log(`PLAN                  ${rel}`);
  console.log(`session               ${plan.session}`);
  console.log(`integration owner     ${plan.integrationOwner}`);
  console.log(`status                ${v.status}`);
  console.log(`                      ${v.reason}`);
  console.log(
    `counts                ${v.counts.workstreams} workstream(s), ${v.counts.executable} executable, ` +
      `${v.counts.parallel} parallel, ${v.counts.serialized} serialized, ${v.counts.blocked} blocked, ` +
      `${v.counts.readyForIntegration} ready, ${v.counts.integrated} integrated`,
  );
  console.log(`independent pairs     ${v.independentPairs.length}`);

  for (const w of plan.workstreams) {
    const deps = w.dependsOn.length > 0 ? ` <- ${w.dependsOn.join(", ")}` : "";
    console.log(`  ${w.id.padEnd(28)} ${w.disposition.padEnd(22)}${deps}`);
    if (w.disposition === "BLOCKED") console.log(`  ${" ".repeat(28)} wall: ${w.blockedReason}`);
    for (const e of w.concurrencyEvidence ?? []) {
      console.log(`  ${" ".repeat(28)} evidence: ${e}`);
    }
  }

  // Unproven dependencies are REPORTED, never fatal. The session may hold a
  // correctness reason the repository cannot see; the instrument's job is to
  // make it say so out loud, not to overrule it.
  if (v.unprovenDependencies.length > 0) {
    console.log(`\n  unproven dependencies ${v.unprovenDependencies.length} (reported, not fatal)`);
    for (const f of v.unprovenDependencies) console.log(`    ${f.rule}: ${f.detail}`);
  }

  if (v.findings.length > 0) {
    console.log(`\n  FINDINGS ${v.findings.length}`);
    for (const f of v.findings) console.log(`    ${f.rule}: ${f.detail}`);
  }

  if (v.status === "UNJUSTIFIED_SERIALIZATION" || v.status === "MALFORMED_PLAN") failed += 1;

  if (!closeout) continue;

  // --- closeout reconciliation ----------------------------------------------
  const observedArtifacts = argv.includes("--artifacts-from-git")
    ? artifactsFromGit()
    : parseList(flag("--artifacts")).map(parseArtifact);
  const r = reconcileCloseout(plan, {
    artifacts: observedArtifacts,
    executedWorkstreamIds: parseList(flag("--executed")),
    integrationArtifacts: parseList(flag("--integration-artifacts")).map(parseArtifact),
  });

  console.log(`\n${"-".repeat(72)}`);
  console.log(`CLOSEOUT              ${r.status}`);
  console.log(`                      ${r.reason}`);
  // The two numbers, printed on two lines and never multiplied together. A
  // single "N workstreams (N branches)" line is how the substitution gets made.
  console.log(`logical workstreams   ${r.counts.declaredWorkstreams} declared, ` +
    `${r.counts.declaredExecutable} executable, ${r.counts.terminal} terminal, ` +
    `${r.counts.nonTerminal} still open`);
  console.log(`  of which appended   ${r.counts.addedDuringSession} mid-session, ` +
    `${r.counts.declaredPostHoc} post hoc`);
  console.log(`execution artifacts   ${r.counts.observedArtifacts} observed, ` +
    `${r.counts.linkedArtifacts} linked, ${r.counts.unlinkedArtifacts} unaccounted`);
  console.log("                      NOT a workstream count (RULING 190)");

  for (const l of r.links) {
    const claimed = l.artifacts.length > 0 ? l.artifacts.join(", ") : "(none — declares no private ref)";
    console.log(`  ${l.workstream.padEnd(28)} ${claimed}`);
  }

  for (const n of r.notes) console.log(`\n  NOTE  ${n}`);

  if (r.findings.length > 0) {
    console.log(`\n  CLOSEOUT FINDINGS ${r.findings.length}`);
    for (const f of r.findings) console.log(`    ${f.rule}: ${f.detail}`);
  }

  if (r.status === "UNRECONCILED") failed += 1;
}

console.log();
if (failed > 0) {
  console.error(`orchestration:check FAILED — ${failed} plan(s) violate RULING 190`);
  process.exit(1);
}
console.log("orchestration:check PASSED");
