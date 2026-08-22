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
 * ship uses — `pnpm build`, the literal command `netlify.toml` gives Netlify,
 * which type-checks everything `tsconfig.json` includes, `scripts/` included.
 * A doc-only close-out passes it in the time a build takes and that is the
 * price; the alternative is a gate that guesses which commits are "just docs",
 * and the commit that caused this looked exactly like just docs.
 *
 * Usage:
 *   pnpm closeout              gate, push main, then WAIT for the tip to go green
 *   pnpm closeout --dry-run    gate only; push nothing
 *   pnpm closeout --no-wait    gate and push; report the tip without waiting
 *
 * There is deliberately no skip flag, for the reason `buildGate()` in
 * handoff.mjs already gives: an escape hatch on a gate is how the gate stops
 * meaning anything.
 */

import { execSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function say(mark, label, detail) {
  console.log(`${mark} ${label.padEnd(22)} ${detail}`);
}

function git(...args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "").trim() : null;
}

/**
 * The build gate, with the two failure modes kept apart.
 *
 * `handoff.mjs` learned this the expensive way and the reasoning is recorded
 * there in full: a gate that cannot tell "the build failed" from "the gate
 * could not run" is untrustworthy in both directions. Both refuse — a check
 * that did not run may not pass — but they say different things.
 */
function gate() {
  console.log("close-out gate · pnpm build (the command netlify.toml gives Netlify)\n");
  const started = Date.now();
  try {
    execSync("pnpm run build", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    if (typeof error.status !== "number") {
      say("✗", "gate", `could not RUN pnpm build (${error.message?.split("\n")[0] ?? "no status"}) — this is the gate failing, not the tree`);
      return false;
    }
    const diagnostics = out
      .split("\n")
      .filter((l) => /error TS\d+|Failed to compile|Failed to type check/.test(l))
      .slice(0, 12);
    say("✗", "gate", `pnpm build refused (exit ${error.status})`);
    for (const line of diagnostics) console.log(`    ${line.trim()}`);
    if (diagnostics.length === 0) {
      console.log("    no TS diagnostic in the output — read the full log with `pnpm build`");
    }
    return false;
  }
  say("✓", "gate", `pnpm build clean in ${Math.round((Date.now() - started) / 1000)}s`);
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
say("·", "to push", `${ahead} commit(s) ahead of origin/main`);

if (!gate()) process.exit(1);

if (dryRun) {
  say("·", "push", "skipped (--dry-run)");
  process.exit(0);
}

if (ahead === 0) {
  say("·", "push", "nothing to push");
} else {
  // Through push-main.mjs, which rebases and retries — the five scheduled
  // workflows push `main` too and their windows genuinely collide (R48).
  const push = spawnSync(process.execPath, [join(ROOT, "scripts", "push-main.mjs")], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (push.status !== 0) {
    say("✗", "push", `push-main.mjs exited ${push.status} — nothing reached main`);
    process.exit(1);
  }
  say("✓", "push", "records on origin/main");
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
