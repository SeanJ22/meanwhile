/**
 * THE GENERATED-ARTIFACT / TEMPORAL STALENESS GUARD AT THE PUSH DOOR.
 * (2026-09-03, the Daily Refresh reliability mechanism.)
 *
 * ## The failure this closes
 *
 * Automated actors — the daily refresh, the post-deploy observer, the intake
 * tripwire — push straight to `main` under the RULING 165 deploy-key bypass,
 * which is granted precisely so machine-generated data can land without a human
 * PR. But the bypass also skips the `gates` job. So a bot that changed an INPUT
 * to a registered PURE generator (say a candidate ballot) and did NOT regenerate
 * the dependent artifact (the state manifest, the questionnaire) advanced `main`
 * to a revision whose OWN deterministic invariants were already red — and then
 * the next bot commit, and the next, piled onto that red, and a human PR that
 * incorporated `main` inherited it. On 2026-09-03 the chain was
 * refresh → post-deploy → intake-tripwire, each green-pushing onto a `main`
 * whose `state-manifest --check` was stale.
 *
 * ## The rule
 *
 * `scripts/push-main.mjs` is the ONE script every scheduled pusher goes through,
 * and it already refuses a push whose paths fall outside the per-workflow
 * allowlist. This adds the second half: before advancing `main`, the tree being
 * pushed must PASS the deterministic generated-artifact / temporal invariants —
 * the read-only `checkCommand` of every registered PURE generator. If any is
 * stale, the push is REFUSED. A bot may not create a `main` revision whose own
 * required deterministic invariants are stale, whether or not this particular
 * commit is what made them so.
 *
 * ## Only what can be proven read-only
 *
 * A `checkCommand` re-derives the artifact from its committed inputs and
 * compares, WITHOUT writing — so the guard can run at the push door without
 * mutating the tree it is about to push. A PURE generator that has no
 * `checkCommand` cannot be verified this way and is not checked here; the
 * completion condition for those is `pnpm regen` (generator-source drift) and
 * the full gate on a PR. Every generator whose input is written by the daily
 * refresh (`state-manifest`, the questionnaire invitations) carries a
 * `checkCommand`, which is what makes this guard bind on the actual failure.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { GENERATED, type GeneratedArtifact } from "./generated-register.ts";

export interface StaleArtifact {
  /** The output path(s) this check covers. */
  paths: string[];
  checkCommand: string;
  /** The first lines of the check's own output, for the refusal message. */
  detail: string;
}

export interface FreshnessReport {
  /** How many distinct check commands ran. */
  checked: number;
  stale: StaleArtifact[];
}

/** A check runner: returns whether the command exited 0 and its combined output. */
export type CheckRunner = (command: string) => { ok: boolean; output: string };

/**
 * The generators that can be verified read-only at the push door: PURE, with a
 * `checkCommand`. Grouped by command, because one command (`state-manifest
 * --check`) verifies all 56 state manifests in a single run.
 */
export function verifiableCheckCommands(
  generated: readonly GeneratedArtifact[] = GENERATED,
): { command: string; paths: string[] }[] {
  const byCommand = new Map<string, string[]>();
  for (const g of generated) {
    if (!g.pure || !g.checkCommand) continue;
    const list = byCommand.get(g.checkCommand) ?? [];
    list.push(g.path);
    byCommand.set(g.checkCommand, list);
  }
  return [...byCommand.entries()].map(([command, paths]) => ({ command, paths }));
}

/**
 * Run every verifiable check and report the stale artifacts. Pure over the
 * injected `runCheck`, so a test can plant a stale generator without spawning a
 * real process.
 */
export function checkGeneratedFreshness(opts: {
  generated?: readonly GeneratedArtifact[];
  runCheck: CheckRunner;
}): FreshnessReport {
  const commands = verifiableCheckCommands(opts.generated);
  const stale: StaleArtifact[] = [];
  for (const { command, paths } of commands) {
    const r = opts.runCheck(command);
    if (!r.ok) {
      const detail = r.output.split("\n").filter((l) => l.trim()).slice(0, 6).join("\n");
      stale.push({ paths, checkCommand: command, detail });
    }
  }
  return { checked: commands.length, stale };
}

/**
 * REGENERATE every registered PURE dependent that is currently stale, and
 * report what moved. This is the POSITIVE half of the mechanism: an automated
 * mutation that changed a generator input regenerates its dependents BEFORE the
 * commit, so the daily refresh can LAND a candidate change rather than have it
 * refused forever for want of a regenerated manifest.
 *
 * `runCheck` decides which are stale (read-only), `runGen` regenerates one
 * (running the generator's `command`). Both are injected so a test can prove
 * "stale input → dependent regenerated" without spawning a process.
 */
export function regenerateStaleDependents(opts: {
  generated?: readonly GeneratedArtifact[];
  runCheck: CheckRunner;
  runGen: (command: string) => { ok: boolean; output: string };
  log?: (line: string) => void;
}): { regenerated: string[]; failed: { command: string; output: string }[] } {
  const log = opts.log ?? (() => {});
  const stale = checkGeneratedFreshness({ generated: opts.generated, runCheck: opts.runCheck }).stale;
  const regenerated: string[] = [];
  const failed: { command: string; output: string }[] = [];
  // Map each stale check command back to the generator command that writes it.
  const genByCheck = new Map<string, GeneratedArtifact>();
  for (const g of opts.generated ?? GENERATED) {
    if (g.pure && g.checkCommand && !genByCheck.has(g.checkCommand)) genByCheck.set(g.checkCommand, g);
  }
  for (const s of stale) {
    const gen = genByCheck.get(s.checkCommand);
    if (!gen) continue;
    log(`refresh-gate: regenerating stale dependent(s) via \`${gen.command}\` (${s.paths.length} path(s))`);
    const r = opts.runGen(gen.command);
    if (r.ok) regenerated.push(...s.paths);
    else failed.push({ command: gen.command, output: r.output.split("\n").slice(0, 6).join("\n") });
  }
  return { regenerated, failed };
}

/** The default runner: spawn the command with the repo's toolchain, capture output. */
export function spawningRunner(cwd: string): CheckRunner {
  return (command: string) => {
    try {
      const output = execSync(command, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });
      return { ok: true, output };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}${err.message ?? ""}` };
    }
  };
}

/**
 * The push-door guard. Returns a decision rather than exiting, so the caller
 * (the direct-invocation block of `push-main.mjs`) decides. `verdict` is
 * `"fresh"` when nothing is stale and `"stale"` otherwise.
 */
export function guardGeneratedFreshness({
  cwd = process.cwd(),
  runCheck,
  log = console.log,
}: {
  cwd?: string;
  runCheck?: CheckRunner;
  log?: (line: string) => void;
} = {}): { verdict: "fresh" | "stale"; report: FreshnessReport } {
  // NOT APPLICABLE when the tree being pushed is not this project. The push-main
  // transport proofs push synthetic trees (a bare origin, a data file) that have
  // no `package.json` and no generator toolchain — running the check commands
  // there would fail for the absence of the toolchain, not for a stale artifact,
  // and refusing on that would be a wall wearing the clothes of a stale
  // dependency. A real runner ALWAYS has `package.json` (it ran pnpm install),
  // so this never skips the guard where it matters. The generators' own
  // freshness is proven separately in tests/push-generated-freshness.test.ts.
  if (runCheck === undefined && !existsSync(join(cwd, "package.json"))) {
    log(`push-main: generated-artifact guard NOT APPLICABLE — no package.json in ${cwd} (not this project's tree).`);
    return { verdict: "fresh", report: { checked: 0, stale: [] } };
  }
  const report = checkGeneratedFreshness({ runCheck: runCheck ?? spawningRunner(cwd) });
  if (report.stale.length === 0) {
    log(`push-main: generated-artifact guard PASSED — ${report.checked} deterministic check(s) green.`);
    return { verdict: "fresh", report };
  }
  log("");
  log("push-main: GENERATED-ARTIFACT GUARD REFUSED THIS PUSH");
  log(
    "  A registered PURE generator's output is STALE against its committed inputs. A bot may not " +
      "advance main to a revision whose own deterministic invariants are red — regenerate the " +
      "dependent artifact(s) (or revert the input) before the push.",
  );
  for (const s of report.stale) {
    log(`  STALE via \`${s.checkCommand}\`:`);
    for (const p of s.paths.slice(0, 8)) log(`    - ${p}`);
    if (s.paths.length > 8) log(`    … and ${s.paths.length - 8} more`);
  }
  log("");
  return { verdict: "stale", report };
}
