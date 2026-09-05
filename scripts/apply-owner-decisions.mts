/**
 * **THE SYNC THE DECISION CARDS PROMISE.** (ADM-16, the 9.4.26 evening admin
 * feedback. `pnpm decisions:sync`.)
 *
 * The card says the owner's answer is *"recorded here at once and carried
 * into the tracker at the next sync, where the row closes and the work it
 * implies is opened for a session."* Until this script existed, "the next
 * sync" was `pnpm decisions:apply` run by a person, and nothing scheduled it —
 * so the sentence was a promise about a step nobody was going to take. The
 * owner's own words: *"make sure decisions are flowing somewhere and I'm not
 * just marking them independently in the site and nothing happens to it."*
 *
 * This is the unattended form of that step, and the standing runner runs it
 * after every cycle, BEFORE it republishes the console (`CONSOLE_PUBLISHERS`
 * in `scripts/pilot-runner.mts`), so the republished cards already exclude
 * the rows he closed. Three legs, in order, each its own child process:
 *
 * ```
 *   1  owner:decisions:pull        the control plane's decision log →
 *                                  docs/tracker-owner-decisions.json
 *   2  tracker:move --only=dashboard --session=dashboard-decision-nonhunt
 *                                  close the rows he decided, in his name;
 *                                  open the work each implies (DEC rows) and
 *                                  the gaps he sent with "Go fix these"
 *                                  (FIX rows); regenerate the views
 *   3  owner:canonicalize          record on each intent what it became —
 *                                  the resolved row, the rows opened — so the
 *                                  card's receipt can name them
 * ```
 *
 * ## What it does NOT do
 *
 * It does not import the owner's workbook (`--only=dashboard`), it does not
 * commit, and it does not push. The tracker stores and their generated views
 * change in the runner's checkout, exactly as `data/method/candidates.json`
 * already does; the next session that integrates the main checkout commits
 * them (RULING 266's single door). A leg that fails is PRINTED with its exit
 * and last stderr line and stops the legs after it — a canonicalize over a
 * move that did not happen would record closes that do not exist — but it
 * never throws into the runner: a sync one cycle late is a defect the next
 * cycle repairs.
 *
 * ## Idempotent by construction
 *
 * A pull merges by intent id; the applier refuses an intent a row's `Closed by`
 * already names; the canonicalizer skips an intent whose `#resolved` twin is
 * in the log. Running this every cycle with nothing new decided writes nothing
 * new anywhere.
 *
 * `--dry-run` runs the pull and prints what the applier WOULD do (the move
 * script's own plan output), moving nothing.
 */
import { spawnSync } from "node:child_process";

import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const ROOT = process.cwd();
const DRY_RUN = process.argv.includes("--dry-run");
const LEG_TIMEOUT_MS = 4 * 60_000;

interface Leg {
  readonly name: string;
  readonly args: readonly string[];
  /** Whether the leg writes anything the next leg depends on. */
  readonly writes: boolean;
}

const LEGS: readonly Leg[] = [
  { name: "pull decisions", args: ["--env-file=.env.local", "--experimental-strip-types", "scripts/owner-decisions-pull.mts"], writes: true },
  {
    name: "apply to the tracker",
    args: ["scripts/tracker.mjs", "move", "--only=dashboard", "--session=dashboard-decision-nonhunt"],
    writes: true,
  },
  { name: "canonicalize", args: ["--env-file=.env.local", "--experimental-strip-types", "scripts/canonicalize-owner-decisions.mts"], writes: true },
];

function say(line: string): void {
  console.log(`decisions:sync · ${line}`);
}

function runLeg(leg: Leg): { ok: boolean; seconds: number; lastLine: string; stdout: string } {
  const started = Date.now();
  const run = spawnSync(process.execPath, [...leg.args, ...(DRY_RUN && leg.name === "apply to the tracker" ? ["--dry-run"] : [])], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: LEG_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  const lines = `${run.stdout ?? ""}\n${run.stderr ?? ""}`.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
  const lastLine = lines.at(-1) ?? (run.error ? run.error.message : "(no output)");
  return { ok: run.status === 0, seconds, lastLine, stdout: run.stdout ?? "" };
}

function main(): void {
  say(`${DRY_RUN ? "DRY RUN — " : ""}${LEGS.length} legs in ${ROOT}`);
  const outcomes: string[] = [];
  for (const leg of LEGS) {
    if (DRY_RUN && leg.name === "canonicalize") {
      say("canonicalize: skipped on a dry run (nothing was applied to record)");
      outcomes.push("canonicalize skipped");
      break;
    }
    const result = runLeg(leg);
    // The move script's own summary lines are the sync's evidence; keep them.
    const kept = result.stdout
      .split("\n")
      .filter((l) => /dashboard decisions|fix queue|intents applied|follow-ups opened|rows opened|not applied|REFUSED|written|resolved;|pulled/.test(l))
      .map((l) => `    ${l.trimEnd()}`);
    if (kept.length > 0) console.log(kept.join("\n"));
    if (result.ok) {
      say(`${leg.name}: OK (${result.seconds}s)`);
      outcomes.push(`${leg.name} OK`);
      continue;
    }
    say(`${leg.name}: FAILED (${result.seconds}s) — ${result.lastLine}`);
    outcomes.push(`${leg.name} FAILED`);
    if (leg.writes) {
      say("stopping here: a later leg would record work the failed leg did not do");
      process.exitCode = 1;
      break;
    }
  }
  // RULING 159: the legs that ran clean, of the legs this sync has.
  const ok = outcomes.filter((o) => o.endsWith(" OK")).length;
  say(`${floorLine(floored("legs OK", "this sync's leg list", LEGS.length, ok))} · ${outcomes.join(" · ")}`);
}

main();
