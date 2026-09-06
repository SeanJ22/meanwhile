#!/usr/bin/env node
/**
 * `pnpm ci:cost` — THE ONE PLACE A WORKFLOW ASKS WHAT A COMMIT COSTS TO PROVE.
 *
 * RULING 278. The predicate, the ops-only table and every reason attached to it
 * live in `lib/ops/deploy-paths.ts`, which is the ONE implementation
 * (RULING 103); this file is the adapter between GitHub Actions' environment
 * and that predicate, exactly as `scripts/netlify-ignore.mjs` is the adapter
 * between Netlify's.
 *
 * It answers TWO named questions from ONE table, because two workflows ask two
 * different things and a second table is how they would come to disagree:
 *
 *   cost=CHEAP|FULL          Can this commit change what is built, served,
 *                            migrated, read by the reader, or required by
 *                            governed proof?  `build-check.yml` consumes this.
 *   deploy=build|cancel|…    Can this commit change what a reader sees?
 *                            `post-deploy-integrity.yml` consumes this — the
 *                            SAME question `netlify-ignore.mjs` gives Netlify,
 *                            because the observer must skip exactly the commits
 *                            Netlify was told to cancel and no others.
 *
 * ## EVERY FAILURE PATH IS FULL
 *
 * The predicate will not load, git is unavailable, the clone has no parent, the
 * event is not a push, the commit is a merge whose combined diff is empty —
 * every one of those prints FULL and the whole proof runs. A classifier that
 * went cheap on its own confusion would put an unverified commit on `main`, and
 * RULING 24 is explicit that a check which cannot reach its subject must never
 * print like a passing one. A wasted check is the cheap failure and it is the
 * only one this can produce.
 *
 * ## WHY ONLY A `push`
 *
 * A pull request's range is a whole branch and its head is not yet on `main`;
 * the thing under proof is the merge result, not one commit. So a pull request
 * is never classified cheap here — it passes `null` and takes the full proof,
 * which is also why nothing about the merge train changes.
 *
 *   node scripts/ci-cost.mjs                classify HEAD (or $GITHUB_SHA)
 *   node scripts/ci-cost.mjs --sha=<sha>    classify a named commit
 *   node scripts/ci-cost.mjs --event=push   override the event (local proofs)
 *   node scripts/ci-cost.mjs --prove        RUN the cheap path's proofs
 *   node scripts/ci-cost.mjs --attest=<job> print what that job skipped, and why
 *
 * Exit 0 when it answered. Exit 1 only from `--prove`, when a proof failed.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { gitFor } from "./git-lite.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = gitFor(ROOT);

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function log(line) {
  console.log(`ci-cost · ${line}`);
}

/** Append `key=value` to a GitHub Actions file, when there is one. */
function emit(file, line) {
  if (!file) return;
  appendFileSync(file, `${line}\n`, "utf8");
}

/**
 * The changed-path list for one commit, or `null` when it could not be read.
 *
 * `null` is not "nothing changed" — keeping those apart is the same contract
 * `scripts/netlify-ignore.mjs` keeps, and for the same reason.
 *
 * `git show --name-only` on a MERGE commit prints the combined diff, which for
 * a clean merge is empty. That reads back as `[]`, which `classifyCommitCost`
 * answers UNKNOWN → FULL. A merge to `main` is a shipping candidate and must
 * be, so the degenerate case lands on the safe side by construction rather than
 * by a special case somebody could delete.
 */
function changedPaths(sha) {
  const out = git("show", "--name-only", "--format=", sha);
  if (out === null) {
    log(`git could not read the changed paths of ${sha.slice(0, 7)} — cannot classify`);
    return null;
  }
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

/**
 * The names of the steps in one `build-check.yml` job that carry the cheap-path
 * condition — read from the workflow, never kept in a list here.
 *
 * Deliberately a text scan and not a YAML parse: on the cheap path the `build`
 * job never installs, so `node_modules` is not there and `yaml` cannot be
 * imported. The receipt has to work with bare Node or it is not a receipt.
 *
 * @param {string} job  the job key, e.g. `build` or `gates`
 * @returns {string[]}
 */
function skippedStepsOf(job) {
  let text;
  try {
    text = readFileSync(join(ROOT, ".github", "workflows", "build-check.yml"), "utf8");
  } catch {
    return [];
  }
  const start = text.indexOf(`\n  ${job}:\n`);
  if (start < 0) return [];
  const rest = text.slice(start + 1);
  const nextJob = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  const block = nextJob > 0 ? rest.slice(0, nextJob + 1) : rest;

  const names = [];
  let current = null;
  for (const line of block.split("\n")) {
    const named = /^ {6}- name: (.+)$/.exec(line);
    if (named) current = named[1].trim();
    else if (/^ {6}- /.test(line)) current = null;
    if (current && line.includes("steps.cost.outputs.cost != 'CHEAP'")) {
      names.push(current);
      current = null;
    }
  }
  return names;
}

async function main() {
  const event = arg("event") ?? process.env.GITHUB_EVENT_NAME ?? "push";
  const sha = arg("sha") ?? process.env.GITHUB_SHA ?? git("rev-parse", "HEAD") ?? "";
  const output = process.env.GITHUB_OUTPUT;
  const summary = process.env.GITHUB_STEP_SUMMARY;

  log(`event=${event} sha=${sha.slice(0, 7) || "-"}`);

  let classifyCommitCost, classifyDeploy, CHEAP_PATH_PROOFS, floored, floorLine;
  try {
    ({ classifyCommitCost, classifyDeploy, CHEAP_PATH_PROOFS } = await import(
      "../lib/ops/deploy-paths.ts"
    ));
    // RULING 159's floor, from the module that owns it. Both files are
    // dependency-free TypeScript, which bare Node strips — this runs before any
    // install, in a job that may never install at all.
    ({ floored, floorLine } = await import("../lib/ops/denominator-floor.ts"));
  } catch (err) {
    log(`could not load the predicate (${err?.message ?? err}) — FULL`);
    emit(output, "cost=FULL");
    emit(output, "class=UNKNOWN");
    emit(output, "deploy=cannot-tell");
    emit(output, "proofs=");
    return 0;
  }

  // A pull request, a dispatch, a schedule: not one commit on `main`, so not a
  // question this classifier answers. `null` is the honest input and FULL is
  // the honest answer.
  const changed = event === "push" && sha ? changedPaths(sha) : null;
  if (changed === null && event !== "push") {
    log(`event is '${event}', not a push to main — the range is not one commit`);
  }

  const cost = classifyCommitCost(changed);
  const deploy = classifyDeploy(changed);

  /*
   * THE COUNT IS FLOORED (RULING 159). An unreadable or empty changed-path list
   * is COULD_NOT_ASSERT and never `0 of 0` — a measured zero here would read as
   * "no changed path is proof-bearing", which is the exact sentence that buys a
   * cheap path on a commit nobody counted.
   */
  const counted = floored(
    "ops-only paths",
    `the changed-path list of ${sha.slice(0, 7) || "an unnamed commit"}`,
    changed?.length ?? 0,
    cost.opsOnly.length,
    changed && changed.length
      ? undefined
      : "the changed-path list could not be read, so there is no population to count over",
  );
  log(floorLine(counted));

  if (changed && changed.length) {
    for (const p of cost.opsOnly.slice(0, 10)) log(`  ops-only     ${p}`);
    for (const p of cost.proofBearing.slice(0, 10)) log(`  PROOF-BEARING ${p}`);
    if (cost.proofBearing.length > 10) log(`  … and ${cost.proofBearing.length - 10} more`);
  }

  log(`CLASS ${cost.klass} — ${cost.reason}`);
  log(`COST  ${cost.cost}`);
  log(`DEPLOY ${deploy.verdict} — ${deploy.reason}`);

  emit(output, `cost=${cost.cost}`);
  emit(output, `class=${cost.klass}`);
  emit(output, `deploy=${deploy.verdict}`);
  emit(output, `proofs=${cost.proofs.join(" ")}`);

  emit(
    summary,
    [
      `### Shipping classification — \`${sha.slice(0, 7)}\``,
      "",
      `- **class** \`${cost.klass}\` · **cost** \`${cost.cost}\` · **deploy** \`${deploy.verdict}\``,
      `- ${cost.reason}`,
      cost.cost === "CHEAP"
        ? `- cheap-path proofs: ${cost.proofs.map((p) => `\`${p}\``).join(", ")}`
        : "- the full shipping proof runs.",
      "",
    ].join("\n"),
  );

  /* ----------------------------------------------------------- --attest --- */

  const attest = arg("attest");
  if (attest !== undefined) {
    if (cost.cost !== "CHEAP") {
      log(`nothing to attest — this commit is ${cost.cost}, so the '${attest}' job ran in full.`);
      return 0;
    }
    /*
     * The receipt NAMES the steps that did not run, and it reads them out of
     * the workflow rather than out of a list here. A hand-kept list would be a
     * second description of the same file, and it would be the half that goes
     * stale — which is the shape this whole ruling is about.
     */
    console.log(`CLASSIFIED ${cost.klass} — the '${attest}' job did not run its expensive steps.`);
    for (const p of cost.opsOnly) console.log(`  changed  ${p}`);
    for (const name of skippedStepsOf(attest)) console.log(`  skipped  ${name}`);
    console.log(`  proved by  ${cost.proofs.join(", ")}`);
    console.log(
      "Each skipped step's subject is unchanged by this commit. The guards named above read the " +
        "changed artifacts from disk and RAN, in the gates job, through `ci-cost --prove`.",
    );
    return 0;
  }

  if (!process.argv.includes("--prove")) return 0;

  /* ------------------------------------------------------------ --prove --- */

  if (cost.cost !== "CHEAP") {
    console.error(
      "ci-cost --prove was asked to run the cheap path's proofs on a commit classified " +
        `${cost.cost}. That is a workflow wiring fault, not a tree fault, and it is refused ` +
        "rather than answered — a cheap proof standing in for a full one is the exact " +
        "substitution RULING 278 exists to prevent.",
    );
    return 1;
  }

  const files = cost.proofs.filter((f) => CHEAP_PATH_PROOFS.includes(f));
  if (files.length !== cost.proofs.length) {
    console.error(
      `ci-cost --prove: ${cost.proofs.filter((f) => !CHEAP_PATH_PROOFS.includes(f)).join(", ")} ` +
        "is named by an ops-only artifact but is not in CHEAP_PATH_PROOFS.",
    );
    return 1;
  }

  log(`running ${files.length} cheap-path proof(s): ${files.join(", ")}`);
  const run = spawnSync(
    process.execPath,
    [
      "--test",
      "--experimental-strip-types",
      "--import",
      "./scripts/register-test-loader.mjs",
      ...files,
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  if (run.status !== 0) {
    console.error(
      "ci-cost --prove: a cheap-path proof FAILED. The commit is operational, and its own " +
        "committed shape is what these guards hold — a red one is a real defect in the " +
        "artifact a scheduled job just wrote.",
    );
    return run.status ?? 1;
  }
  log("CHEAP PATH GREEN — every guard that reads these artifacts passed.");
  return 0;
}

process.exitCode = await main();
