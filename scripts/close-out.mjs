#!/usr/bin/env node
/**
 * THE GATED DOOR FOR CLOSE-OUT RECORDS.
 *
 * NJ Hunt 3, item 1.5 (2026-08-22) — the CLASS, not the instance.
 *
 * The merge cadence rule in `CLAUDE.md` says a session ships its code once and
 * then may write close-out records — `docs/state.md`, the tracker, anything
 * carrying the deploy SHA or the walk numbers — as separate named commits,
 * because a document cannot name the commit that contains it. That is correct
 * and it stays. What nobody noticed is what it implies about gating:
 *
 *   `pnpm handoff --ship` calls itself "the single door everything merges
 *   through". For CODE it is. For close-out records it never was — they are
 *   committed AFTER the ship and pushed straight to `main`, through no gate at
 *   all. Every session in this repo's history has done this.
 *
 * The shape has now put a red suite on `main` twice: once from Prompt D's own
 * close-out, and again on 2026-08-22 when NJ Hunt 2's close-out commit carried
 * `scripts/shoot-nj-hunt2-0822.mts` with five `TS18046` sites. Checks #196 and
 * #197 failed, Netlify refused both deploys, and production served a build from
 * before the close-out for the rest of the day. The session reported green
 * gates truthfully — it ran them before the file existed.
 *
 * So close-out is a door, and this is the gate on it. It is the SAME gate the
 * ship uses — `pnpm gates`, which runs the set CI requires: lint, tsc, the
 * browser assertion, the suite, and the build in both modes. A doc-only
 * close-out pays for all of it and that is the price; the alternative is a
 * gate that guesses which commits are "just docs", and the commit that caused
 * this looked exactly like just docs.
 *
 * **It was `pnpm build` alone until 2026-08-25 (RO04, RULING 155)**, which
 * type-checks the tree but does not lint it. Two `react-hooks/
 * set-state-in-effect` errors passed this door and CI caught them, and `main`
 * stayed red across two merges while every local gate reported green.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 2026-08-24 — THIS TOOL NO LONGER PUSHES.
 *
 * The close-out tool refuses a separate push to `main`; records ship inside the
 * PR or not at all, because a separate push to `main` costs a full production
 * build and deploy to serve a paperwork diff. The gate above was the right
 * answer to the wrong half of the problem — it made the separate push SAFE, and
 * left it costing a full production build and deploy to serve a paperwork diff.
 * Three of the five production builds before 5 AM on 2026-08-24 were exactly
 * that.
 *
 * The objection the merge-cadence rule raises is real and is answered rather
 * than waved past: **a document cannot name the commit that contains it.** That
 * was true while the two facts a close-out record could not know in advance
 * were the deploy SHA and the `walk:all` numbers. RULING 125 moves every walk,
 * screenshot and card check onto a LOCAL production build, so the walk numbers
 * are now knowable BEFORE the ship — they are a measurement of the same bytes.
 * What remains genuinely unknowable in advance is the deploy SHA, and that is
 * an operational fact read from Netlify's deploy record after the merge. It
 * does not need to live in a commit at all.
 *
 * So the residual conflict is narrow, it is named in `docs/tracker-working.csv`
 * as a Needs Sean row, and until he rules the refusal stands — because the
 * alternative shape is an escape hatch, and `buildGate()` in `handoff.mjs`
 * already gives the reason those do not exist here.
 *
 * Usage:
 *   pnpm closeout              gate, then REPORT whether anything is unpushed
 *   pnpm closeout --dry-run    gate only
 *   pnpm closeout --no-wait    ask the server about main without waiting
 *
 * There is deliberately no skip flag and no `--push`.
 */

import { execSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { gitFor } from "./git-lite.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function say(mark, label, detail) {
  console.log(`${mark} ${label.padEnd(22)} ${detail}`);
}

/* `git` is `gitFor(ROOT)` from ./git-lite.mjs — one copy (RULING 103). */
const git = gitFor(ROOT);

/**
 * The build gate, with the two failure modes kept apart.
 *
 * `handoff.mjs` learned this the expensive way and the reasoning is recorded
 * there in full: a gate that cannot tell "the build failed" from "the gate
 * could not run" is untrustworthy in both directions. Both refuse — a check
 * that did not run may not pass — but they say different things.
 */
function gate() {
  console.log("close-out gate · pnpm gates (the gate set CI requires — RULING 155)\n");
  const started = Date.now();
  try {
    /*
     * `pnpm run gates`, NOT `pnpm run build` (RO04, 2026-08-25, RULING 155).
     * RULING 75 made this the gated door and it gated one of CI's seven
     * commands. See the note at the same change in `handoff.mjs`.
     */
    execSync("pnpm run gates", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    if (typeof error.status !== "number") {
      say("✗", "gate", `could not RUN pnpm gates (${error.message?.split("\n")[0] ?? "no status"}) — this is the gate failing, not the tree`);
      return false;
    }
    const diagnostics = out
      .split("\n")
      .filter((l) => /error TS\d+|Failed to compile|Failed to type check/.test(l))
      .slice(0, 12);
    say("✗", "gate", `pnpm gates refused (exit ${error.status})`);
    for (const line of diagnostics) console.log(`    ${line.trim()}`);
    if (diagnostics.length === 0) {
      console.log("    no TS diagnostic in the output — read the full log with `pnpm gates`");
    }
    return false;
  }
  say("✓", "gate", `pnpm gates clean in ${Math.round((Date.now() - started) / 1000)}s`);
  return true;
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const wait = !argv.includes("--no-wait");

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main") {
  say("✗", "branch", `on '${branch}' — close-out records land on main; nothing pushed`);
  process.exit(1);
}

const dirty = git("status", "--porcelain");
if (dirty) {
  say("✗", "working tree", "uncommitted changes — commit the records first, then run this");
  console.log(dirty.split("\n").slice(0, 10).map((l) => `    ${l}`).join("\n"));
  process.exit(1);
}

const ahead = Number(git("rev-list", "--count", "origin/main..HEAD") ?? "0");

/*
 * THE REFUSAL — close-out does not push to `main`.
 *
 * Anything sitting unpushed on local `main` at close-out time is, by
 * definition, a record that did not ship inside the PR. Naming the commits is
 * the point: "you have 2 unpushed commits" is a fact nobody can act on, and
 * "these two touch only `docs/`, so they belonged in the PR" is.
 */
if (ahead > 0) {
  const subjects = git("log", "--format=%h %s", "origin/main..HEAD") ?? "";
  say("✗", "unpushed", `${ahead} commit(s) ahead of origin/main — THIS TOOL DOES NOT PUSH`);
  console.log(subjects.split("\n").map((l) => `    ${l}`).join("\n"));
  console.log("");
  console.log("  Close-out records ship INSIDE the session's pull request (RULING 124 item 5).");
  console.log("  A separate push to main costs a full production build and deploy to serve a");
  console.log("  paperwork diff — three of the five production builds before 5 AM on 2026-08-24");
  console.log("  were exactly that.");
  console.log("");
  console.log("  What to do with these commits, in order of what is usually right:");
  console.log("    · squash them into the session branch and let `pnpm handoff --ship` carry them;");
  console.log("    · or, if the branch is already merged, open a second PR — the merge is the door.");
  console.log("");
  console.log("  The walk numbers no longer need the ship to be knowable: RULING 125 runs every");
  console.log("  walk against a LOCAL production build. The deploy SHA is read from Netlify's");
  console.log("  deploy record afterwards and does not belong in a commit.");
  process.exit(1);
}

say("✓", "unpushed", "0 commits ahead of origin/main — nothing tried to bypass the PR");

if (!gate()) process.exit(1);

if (dryRun) {
  say("·", "server check", "skipped (--dry-run)");
  process.exit(0);
}

/*
 * And then ask the SERVER what happened, rather than inferring it from a green
 * local gate. The local gate and the remote verdict are different questions —
 * that is item 1.6, and `scripts/main-green.mjs` carries the reasoning.
 */
const green = spawnSync(
  process.execPath,
  [join(ROOT, "scripts", "main-green.mjs"), ...(wait ? ["--wait"] : [])],
  { cwd: ROOT, stdio: "inherit" },
);
process.exit(green.status ?? 2);
