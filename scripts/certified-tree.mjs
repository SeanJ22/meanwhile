#!/usr/bin/env node
/**
 * `pnpm ci:certified` — **IS THE TREE ON `main` THE TREE THAT ALREADY PASSED?**
 * (FCP-9C, 2026-09-07.)
 *
 * The adapter between GitHub Actions' environment and
 * `lib/control-plane/shipping/tree-equivalence.ts`, exactly as
 * `scripts/ci-cost.mjs` is the adapter for RULING 278's predicate and
 * `scripts/netlify-ignore.mjs` is the adapter for Netlify's. **The judgement
 * is not here.** This file gathers facts and prints what the predicate said.
 *
 * ## What it is for
 *
 * Run #807 of 2026-09-07 spent a full shipping-grade certification on merge
 * commit `0251d145`, whose tree is `dc3bee39…` — the identical git object that
 * run #806 had certified on `be6e41ff` minutes earlier. Nothing had changed
 * except the commit SHA. This step is where that is noticed.
 *
 * ## Every failure path is FULL
 *
 * git cannot answer, the clone is too shallow to see the ancestry, `gh` is not
 * on the runner, the API refuses, a required context is missing or not green —
 * every one prints `certified=no` with the reason and the whole proof runs. A
 * wasted certification is the cheap failure and it is the only one this can
 * produce (RULING 24).
 *
 * ## Why it deepens the clone, and by how much
 *
 *   `build-check.yml` checks out at depth 2, which holds the merge and its two
 *   parents but not the graph between them, so `merge-base --is-ancestor`
 *   cannot be answered. A bounded `--deepen` fetches commit objects along that
 *   chain and nothing else. It costs seconds, needs no install, and if it
 *   fails the answer is FULL.
 *
 *   node scripts/certified-tree.mjs                 classify the pushed HEAD
 *   node scripts/certified-tree.mjs --sha=<sha>     classify a named commit
 *   node scripts/certified-tree.mjs --no-deepen     do not touch the network
 *   node scripts/certified-tree.mjs --attest=<job>  print what that job reused
 *
 * Exit 0 always: this reports, it does not gate. The workflow reads its output.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { gitFor } from "./git-lite.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = gitFor(ROOT);

/** How far the bounded deepen may walk before the answer becomes CANNOT_TELL. */
const DEEPEN = 128;

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const log = (line) => console.log(`certified-tree · ${line}`);

function emit(file, line) {
  if (!file) return;
  appendFileSync(file, `${line}\n`, "utf8");
}

/**
 * Ask GitHub what the required contexts reported at one commit.
 *
 * `gh` is preinstalled on every GitHub-hosted runner and authenticates from
 * `GH_TOKEN`. A missing binary, a missing token, a non-zero exit or
 * unparseable JSON all return `null`, which the predicate reads as CANNOT_TELL
 * — never as "no context passed" and never as "every context passed".
 *
 * @param {string} sha
 * @returns {{context: string, conclusion: string | null}[] | null}
 */
function readingsAt(sha) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    log("GITHUB_REPOSITORY is not set — the check runs cannot be located");
    return null;
  }
  const result = spawnSync(
    "gh",
    ["api", `repos/${repo}/commits/${sha}/check-runs?per_page=100`],
    { cwd: ROOT, encoding: "utf8", timeout: 30_000 },
  );
  if (result.status !== 0) {
    log(`gh api could not read the check runs at ${sha.slice(0, 7)}: ${(result.stderr ?? "").trim().split("\n")[0] ?? "no stderr"}`);
    return null;
  }
  /*
   * ONE PAGE, DELIBERATELY, AND THE INCOMPLETE CASE IS FAIL-CLOSED.
   *
   * `--paginate` concatenates whole JSON documents rather than merging them,
   * and there is no dependency-free way to split that stream correctly: a
   * naive split on the `}{` boundary cuts inside any string that contains one,
   * which is how the first draft of this file read a valid body as corrupt.
   * So this asks for a single page of 100. Branch protection requires three
   * contexts, and a head with more than a hundred check runs is not this
   * repository. If one page does not hold them all, the required context the
   * predicate is looking for is simply absent from the readings and the
   * verdict is CERTIFICATION_MISSING — which is FULL. The unreadable case
   * cannot become the passing one.
   */
  let parsed;
  try {
    parsed = JSON.parse((result.stdout ?? "").trim());
  } catch (error) {
    log(`the check-run body did not parse: ${error.message}`);
    return null;
  }
  const runs = Array.isArray(parsed?.check_runs) ? parsed.check_runs : [];
  const total = typeof parsed?.total_count === "number" ? parsed.total_count : runs.length;
  if (total > runs.length) {
    log(
      `${sha.slice(0, 7)} has ${total} check runs and one page held ${runs.length}; a required ` +
        "context outside this page reads as missing, which is the full proof",
    );
  }
  /*
   * The NEWEST completed run per context name. A re-run leaves the older
   * attempt in the list, and reading the first would let a superseded red
   * outrank the green that replaced it — or the reverse, which is worse.
   */
  const newest = new Map();
  for (const run of runs) {
    if (typeof run?.name !== "string") continue;
    const prior = newest.get(run.name);
    const at = run.completed_at ?? run.started_at ?? "";
    if (prior === undefined || at >= prior.at) {
      newest.set(run.name, { at, conclusion: run.conclusion ?? null });
    }
  }
  return [...newest.entries()].map(([context, v]) => ({
    context,
    conclusion: typeof v.conclusion === "string" ? v.conclusion.toLowerCase() : null,
  }));
}

async function main() {
  const output = process.env.GITHUB_OUTPUT;
  const summary = process.env.GITHUB_STEP_SUMMARY;

  const attest = arg("attest");
  if (attest) {
    log(`job "${attest}" reused an existing certification: this exact tree already passed the`);
    log("required contexts on the candidate head named above. Nothing was waived — the proof");
    log("that ran is the proof for these bytes, and no byte has changed since it ran.");
    emit(summary, `**${attest}** — certified tree reused. The shipped tree is the tree that already passed.`);
    return;
  }

  let judgeTreeEquivalence;
  let REQUIRED_CONTEXTS;
  let floored;
  let floorLine;
  try {
    ({ judgeTreeEquivalence } = await import("../lib/control-plane/shipping/tree-equivalence.ts"));
    /*
     * required-contexts.ts, NOT required-checks.ts. The latter imports `yaml`
     * to parse the workflow, and this step runs before `pnpm install` — run
     * 34160631768 answered FULL on exactly that and the attestation was inert.
     */
    ({ REQUIRED_CONTEXTS } = await import("../lib/ops/required-contexts.ts"));
    ({ floored, floorLine } = await import("../lib/ops/denominator-floor.ts"));
  } catch (error) {
    log(`the predicate would not load (${error.message}) — answering FULL`);
    emit(output, "certified=no");
    emit(output, "certified_reason=CANNOT_TELL");
    return;
  }

  const event = arg("event") ?? process.env.GITHUB_EVENT_NAME ?? "push";
  const ref = arg("ref") ?? process.env.GITHUB_REF ?? null;
  const headSha = arg("sha") ?? process.env.GITHUB_SHA ?? git("rev-parse", "HEAD");

  /*
   * Gather nothing expensive until the cheap disqualifiers are past. A pull
   * request and a push to any other ref are refused by the predicate without
   * a single git call beyond the one above, so the network is never touched
   * for a head that could not qualify anyway.
   */
  const cheapVerdict = judgeTreeEquivalence({
    event,
    ref,
    integrationRef: "refs/heads/main",
    headSha,
    parents: [],
    headTree: null,
    candidateTree: null,
    baseIsAncestorOfCandidate: null,
    requiredContexts: REQUIRED_CONTEXTS,
    readings: null,
  });
  if (cheapVerdict.reason === "NOT_AN_INTEGRATION_PUSH") {
    log(cheapVerdict.detail);
    emit(output, "certified=no");
    emit(output, `certified_reason=${cheapVerdict.reason}`);
    return;
  }

  const parentLine = headSha ? git("rev-list", "--parents", "-n", "1", headSha) : null;
  const parents = parentLine === null ? null : parentLine.split(/\s+/).slice(1);

  let baseIsAncestorOfCandidate = null;
  let headTree = null;
  let candidateTree = null;

  if (parents !== null && parents.length === 2) {
    const [base, candidate] = parents;
    if (!process.argv.includes("--no-deepen")) {
      /*
       * Bounded, and its failure is not fatal: if the graph is already present
       * the fetch is a no-op, and if it fails the ancestry question simply
       * stays unanswered and the answer becomes FULL.
       */
      const deepened = spawnSync(
        "git",
        ["fetch", `--deepen=${DEEPEN}`, "--no-tags", "origin"],
        { cwd: ROOT, encoding: "utf8", timeout: 90_000 },
      );
      if (deepened.status !== 0) {
        log(`the bounded deepen did not complete; the ancestry may be unanswerable`);
      }
    }
    const ancestry = spawnSync(
      "git",
      ["merge-base", "--is-ancestor", base, candidate],
      { cwd: ROOT, encoding: "utf8" },
    );
    /*
     * **A SHALLOW CLONE ANSWERS "NO" WHEN IT MEANS "I CANNOT SEE".**
     * (Measured 2026-09-07, emulating actions/checkout at fetch-depth 2 on
     * merge c6fa9e88.)
     *
     * git exits 0 for yes and 1 for no, and the first draft of this file read
     * those two literally. In a shallow clone the walk from the candidate hits
     * the graft boundary before it reaches the base and git exits **1** — not
     * 128 — so a missing commit is indistinguishable from a real answer.
     *
     * Exit 0 is always trustworthy: git found a path, and it cannot invent one.
     * Exit 1 is trustworthy only when the repository can see its whole history.
     * So a "no" from a still-shallow clone becomes CANNOT_TELL, which is the
     * full proof. The deepen above usually makes the clone deep enough to
     * answer honestly; when it does not, this is the difference between a
     * wrong answer and no answer.
     */
    const stillShallow =
      (git("rev-parse", "--is-shallow-repository") ?? "true").trim() !== "false";
    baseIsAncestorOfCandidate =
      ancestry.status === 0
        ? true
        : ancestry.status === 1 && !stillShallow
          ? false
          : null;
    if (ancestry.status === 1 && stillShallow) {
      log(
        "the clone is still shallow and git answered \"not an ancestor\" — which is what it also " +
          "says when it cannot see far enough, so this is CANNOT_TELL rather than a no",
      );
    }
    headTree = git("rev-parse", `${headSha}^{tree}`);
    candidateTree = git("rev-parse", `${candidate}^{tree}`);
  }

  const readings =
    parents !== null && parents.length === 2 && headTree !== null && headTree === candidateTree
      ? readingsAt(parents[1])
      : null;

  const decision = judgeTreeEquivalence({
    event,
    ref,
    integrationRef: "refs/heads/main",
    headSha,
    parents,
    headTree,
    candidateTree,
    baseIsAncestorOfCandidate,
    requiredContexts: REQUIRED_CONTEXTS,
    readings,
  });

  if (decision.verdict === "CERTIFIED_TREE_REUSED") {
    /*
     * BOTH TERMS (RULING 159). "3 contexts green" is a claim about a
     * certification and it is only readable beside how many were required; a
     * required set that resolved to nothing would otherwise satisfy itself.
     */
    log(
      floorLine(
        floored(
          "required contexts GREEN at the candidate",
          "lib/ops/required-checks.ts",
          decision.reliedOn.length,
          decision.reliedOn.length,
        ),
      ),
    );
    log(`CERTIFIED TREE REUSED — ${decision.detail}`);
    emit(output, "certified=yes");
    emit(output, "certified_reason=CERTIFIED_TREE_REUSED");
    emit(output, `certified_sha=${decision.certifiedSha}`);
    emit(output, `certified_tree=${decision.certifiedTree}`);
    emit(
      summary,
      `### Certified tree reused\n\nThis shipped tree is the tree that already passed the required ` +
        `certification.\n\n- shipped \`${(headSha ?? "").slice(0, 12)}\`\n- certified \`${(decision.certifiedSha ?? "").slice(0, 12)}\`\n` +
        `- tree \`${(decision.certifiedTree ?? "").slice(0, 12)}\` — the same git object\n- relied on: ${decision.reliedOn.join(", ")}`,
    );
    return;
  }

  log(`FULL PROOF REQUIRED (${decision.reason}) — ${decision.detail}`);
  emit(output, "certified=no");
  emit(output, `certified_reason=${decision.reason}`);
}

await main();
