/**
 * **THE REMOTE BRANCH RETIREMENT MANIFEST** — builds and re-verifies
 * `data/git/branch-retirement.json`.
 *
 * ```
 * pnpm branches:retire                  # classify and PRINT. Writes nothing.
 * pnpm branches:retire --write          # also write the manifest
 * pnpm branches:retire --verify         # re-check the recorded manifest against the remote
 * pnpm branches:retire --print-deletions # print the delete commands for a human to run
 * ```
 *
 * ## THIS SCRIPT NEVER DELETES A BRANCH
 *
 * Not with a flag, not with a confirmation, not at all. There is no code path
 * here that runs `git push --delete` or `git branch -d`, and `--print-deletions`
 * writes the commands to stdout for a human to read, paste and own. That is a
 * deliberate ceiling, not an oversight: the classification is evidence for a
 * decision, and a tool that both decides and executes turns a
 * `REVIEW_REQUIRED` bug into an unrecoverable one.
 *
 * The reasoning behind each disposition — and why `git branch --merged` is the
 * wrong instrument against a squash-merging repository — is in
 * `lib/ops/branch-retirement.ts`. This file gathers facts and prints; it makes
 * no judgements of its own.
 *
 * ## Two phases, because the decisive proof is the expensive one
 *
 * Ancestry, a trial merge and a pull-request tip match are cheap and settle the
 * large majority. Integration ancestry — *is this ref an ancestor of some other
 * branch's tip that a merged PR carried into main?* — costs a `merge-base` call
 * per candidate per merged head, so it runs ONLY for refs that nothing cheaper
 * proved. At the anchor that was 9 refs, not 137.
 *
 * ## Active refs are DERIVED, never listed
 *
 * A hard-coded list of this session's branches would be wrong the moment the
 * session ended. `KEEP_ACTIVE` is instead assigned to whatever currently has a
 * registered git worktree, so re-running after the worktrees are removed
 * reclassifies those refs on the evidence rather than on a stale constant.
 * `--active <ref,...>` adds to that set for a caller who knows better.
 *
 * ## `execFileSync` throws past its buffer, and a catch-all would turn that
 * into a false fact
 *
 * Measured on this machine: the default 1 MB cap makes `execFileSync` THROW on
 * large git output. Swallowing that would report "no unique paths" for exactly
 * the branches that have the most. Every call below sets a generous `maxBuffer`
 * and lets a real error propagate; only `spawnSync` is used where a NON-ZERO
 * EXIT is itself the answer (`merge-base --is-ancestor`, a conflicting
 * `merge-tree`), and there the status is read rather than an exception caught.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyBranch,
  countDispositions,
  driftAgainstRemote,
  type BranchClassification,
  type BranchFacts,
  type IntegrationLink,
  type PullRequestLink,
  type RetirementPolicy,
} from "../lib/ops/branch-retirement.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "data", "git", "branch-retirement.json");

/** Large enough that git's output, not the buffer, decides what we learn. */
const MAX_BUFFER = 256 * 1024 * 1024;

const REMOTE = "origin";
const MAIN = `${REMOTE}/main`;

/**
 * No repository law permits automatically retiring a branch in a human's own
 * namespace. When one is adopted, its citation replaces this `null` — the rule
 * is not relaxed by editing the classifier.
 */
const OWNER_RETIREMENT_POLICY: string | null = null;
const OWNER_NAMESPACES = ["sean"] as const;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: MAX_BUFFER }).trim();
}

/** For calls whose EXIT STATUS is the answer rather than an error. */
function gitStatus(args: string[]): number {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: MAX_BUFFER }).status ?? 1;
}

function isAncestor(maybeAncestor: string, descendant: string): boolean {
  return gitStatus(["merge-base", "--is-ancestor", maybeAncestor, descendant]) === 0;
}

interface RawPullRequest {
  number: number;
  headRefName: string;
  headRefOid: string;
  state: string;
  mergedAt: string | null;
  mergeCommit: { oid: string } | null;
  title: string;
}

function readPullRequests(): RawPullRequest[] {
  const raw = execFileSync(
    "gh",
    ["pr", "list", "--state", "all", "--limit", "500", "--json", "number,headRefName,state,mergedAt,mergeCommit,headRefOid,title"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: MAX_BUFFER },
  );
  return JSON.parse(raw) as RawPullRequest[];
}

/**
 * Bring the local object store level with the remote.
 *
 * `ls-remote` names the refs, but every proof below is computed against
 * `origin/<ref>` in the LOCAL object store — so a ref whose tip moved since the
 * last fetch would be classified on commits we do not hold. The fetch is
 * deliberately WITHOUT `--prune`: pruning removes local tracking refs, and this
 * script's whole contract is that it removes nothing.
 */
function syncFromRemote(): void {
  execFileSync("git", ["fetch", REMOTE], { cwd: ROOT, encoding: "utf8", maxBuffer: MAX_BUFFER, stdio: "pipe" });
}

/** The remote's heads, read from the remote itself rather than from stale tracking refs. */
function readRemoteHeads(): { ref: string; tipSha: string }[] {
  return git(["ls-remote", "--heads", REMOTE])
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [sha, name] = line.split("\t");
      return { ref: name.replace("refs/heads/", ""), tipSha: sha };
    })
    .filter((entry) => entry.ref !== "main")
    .sort((a, b) => a.ref.localeCompare(b.ref));
}

/** Branch names that currently have a checked-out worktree. */
function worktreeBranches(): { branches: string[]; paths: string[] } {
  const branches: string[] = [];
  const paths: string[] = [];
  for (const block of git(["worktree", "list", "--porcelain"]).split("\n\n")) {
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) paths.push(line.slice("worktree ".length).replace(/\\/g, "/"));
      if (line.startsWith("branch ")) branches.push(line.slice("branch ".length).replace("refs/heads/", ""));
    }
  }
  return { branches, paths };
}

/**
 * Directories sitting in the worktree home that git no longer knows about.
 *
 * The home is derived as the directory holding the most registered worktrees,
 * so this works from any of them.
 *
 * **A removed worktree does NOT reliably leave a `.git` file behind.** Measured
 * on the twelve directories PR #215 left here: `git worktree remove` took the
 * checkout and the `.git` link with it, and what remains is a directory holding
 * nothing but the `node_modules` junction. Testing for `.git` therefore found
 * none of them — a detector that reports zero because it looked for the wrong
 * thing, which is the shape RULING 100 names.
 *
 * Two marks, either sufficient, and the manifest records which one fired:
 *
 * - a `.git` entry — a worktree abandoned without `git worktree remove`;
 * - `node_modules` present with NO `package.json` — the checkout is gone and
 *   only the dependency junction survived.
 *
 * The second is what keeps an unrelated neighbour out of a cleanup list: the
 * asset store next door has neither mark, so it is reported as IGNORED rather
 * than silently dropped. Nothing here deletes a directory; the list is for a
 * human.
 */
function staleWorktreeDirectories(
  registered: string[],
): { stale: { path: string; mark: string }[]; home: string | null; ignored: string[] } {
  const parents = new Map<string, number>();
  for (const path of registered) {
    const parent = path.replace(/\/[^/]+$/, "");
    parents.set(parent, (parents.get(parent) ?? 0) + 1);
  }
  let home: string | null = null;
  let best = 0;
  for (const [parent, count] of parents) {
    if (count > best) {
      best = count;
      home = parent;
    }
  }
  if (home === null || !existsSync(home)) return { stale: [], home, ignored: [] };

  const known = new Set(registered);
  const stale: { path: string; mark: string }[] = [];
  const ignored: string[] = [];
  for (const entry of readdirSync(home)) {
    const full = `${home}/${entry}`;
    if (!statSync(full).isDirectory()) continue;
    if (known.has(full)) continue;

    if (existsSync(join(full, ".git"))) {
      stale.push({ path: full, mark: "carries a .git entry but git does not list it as a worktree" });
    } else if (existsSync(join(full, "node_modules")) && !existsSync(join(full, "package.json"))) {
      stale.push({ path: full, mark: "node_modules with no package.json — the checkout is gone, the junction remains" });
    } else {
      ignored.push(full);
    }
  }
  return { stale: stale.sort((a, b) => a.path.localeCompare(b.path)), home, ignored: ignored.sort() };
}

interface Manifest {
  generatedAt: string;
  anchor: { mainSha: string; mainTree: string; remote: string };
  openPullRequests: number;
  policy: { ownerNamespaces: string[]; ownerRetirementPolicy: string | null; activeRefs: string[] };
  totals: { remoteBranches: number } & ReturnType<typeof countDispositions>;
  branches: BranchClassification[];
  localBranchesWithoutRemote: { ref: string; tipSha: string; lastCommitAt: string; hasWorktree: boolean }[];
  staleWorktreeDirectories: {
    home: string | null;
    directories: { path: string; mark: string }[];
    ignoredNeighbours: string[];
  };
}

function build(activeExtra: string[]): Manifest {
  syncFromRemote();
  const mainSha = git(["rev-parse", MAIN]);
  const mainTree = git(["rev-parse", `${MAIN}^{tree}`]);

  const pullRequests = readPullRequests();
  const heads = readRemoteHeads();
  const { branches: wtBranches, paths: wtPaths } = worktreeBranches();

  const policy: RetirementPolicy = {
    activeRefs: [...new Set([...wtBranches, ...activeExtra])].filter((r) => r !== "main").sort(),
    ownerNamespaces: [...OWNER_NAMESPACES],
    ownerRetirementPolicy: OWNER_RETIREMENT_POLICY,
  };

  const byHead = new Map<string, RawPullRequest[]>();
  for (const pr of pullRequests) {
    const list = byHead.get(pr.headRefName) ?? [];
    list.push(pr);
    byHead.set(pr.headRefName, list);
  }

  /*
   * Merged heads whose merge commit really is in main, and whose head object we
   * actually hold locally. A PR head from a branch deleted long ago is not in
   * the object store and cannot answer an ancestry question — recording it as
   * "not an ancestor" would be an absence asserted from a missing object.
   */
  const mergeShaInMain = new Map<string, boolean>();
  const mergedHeads: RawPullRequest[] = [];
  for (const pr of pullRequests) {
    if (pr.state !== "MERGED" || pr.mergeCommit === null) continue;
    const oid = pr.mergeCommit.oid;
    if (!mergeShaInMain.has(oid)) {
      mergeShaInMain.set(oid, gitStatus(["cat-file", "-e", `${oid}^{commit}`]) === 0 && isAncestor(oid, MAIN));
    }
    if (mergeShaInMain.get(oid) === true && gitStatus(["cat-file", "-e", `${pr.headRefOid}^{commit}`]) === 0) {
      mergedHeads.push(pr);
    }
  }

  const rows: BranchClassification[] = [];
  for (const head of heads) {
    const ref = head.ref;
    const remoteRef = `${REMOTE}/${ref}`;
    /*
     * The tip is read from the LOCAL tracking ref, because that is what every
     * proof below is computed against. `ls-remote` disagreeing after a fetch
     * means the remote moved mid-run, and classifying a ref against commits we
     * do not hold is exactly the wrong answer to give confidently — so it stops.
     */
    const tipSha = git(["rev-parse", remoteRef]);
    if (tipSha !== head.tipSha) {
      throw new Error(
        `${ref} moved during this run: ls-remote says ${head.tipSha}, the fetched tracking ref is ${tipSha}. Re-run.`,
      );
    }
    const lastCommitAt = git(["show", "-s", "--format=%cI", remoteRef]);

    const [behindMain, aheadOfMain] = git(["rev-list", "--left-right", "--count", `${MAIN}...${remoteRef}`])
      .split(/\s+/)
      .map(Number);

    const trial = spawnSync("git", ["merge-tree", "--write-tree", MAIN, remoteRef], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
    });
    const mergeHadConflicts = trial.status !== 0;
    const mergeIsNoop = !mergeHadConflicts && trial.stdout.trim().split("\n")[0] === mainTree;

    const prLinks: PullRequestLink[] = (byHead.get(ref) ?? []).map((pr) => ({
      number: pr.number,
      state: pr.state,
      mergedAt: pr.mergedAt,
      mergeSha: pr.mergeCommit?.oid ?? null,
      mergedHeadOid: pr.headRefOid,
      mergeShaInMain: pr.mergeCommit ? (mergeShaInMain.get(pr.mergeCommit.oid) ?? false) : false,
      title: pr.title,
    }));

    /*
     * Phase 1 settles most refs. Only what it leaves open pays for phase 2 —
     * the integration-ancestry scan and the unique-path listing.
     */
    const cheaplyProven =
      aheadOfMain === 0 ||
      mergeIsNoop ||
      prLinks.some((pr) => pr.state === "MERGED" && pr.mergeShaInMain && pr.mergedHeadOid === tipSha);

    let integrationAncestry: IntegrationLink[] = [];
    let uniquePaths: string[] = [];
    let cherryUnique = 0;

    if (!cheaplyProven) {
      cherryUnique = git(["cherry", MAIN, remoteRef])
        .split("\n")
        .filter((line) => line.startsWith("+")).length;

      for (const pr of mergedHeads) {
        if (pr.headRefName === ref || pr.headRefOid === tipSha) continue;
        if (isAncestor(remoteRef, pr.headRefOid)) {
          integrationAncestry.push({
            prNumber: pr.number,
            prHeadRef: pr.headRefName,
            prHeadOid: pr.headRefOid,
            mergeSha: pr.mergeCommit?.oid ?? null,
            title: pr.title,
          });
        }
      }
      integrationAncestry = integrationAncestry.sort((a, b) => a.prNumber - b.prNumber);

      if (integrationAncestry.length === 0) {
        const base = git(["merge-base", MAIN, remoteRef]);
        uniquePaths = git(["diff", "--name-only", base, remoteRef])
          .split("\n")
          .filter((line) => line.trim().length > 0);
      }
    }

    const facts: BranchFacts = {
      ref,
      tipSha,
      lastCommitAt,
      aheadOfMain,
      behindMain,
      mergeIsNoop,
      mergeHadConflicts,
      cherryUnique,
      uniquePaths,
      pullRequests: prLinks,
      integrationAncestry,
    };
    rows.push(classifyBranch(facts, policy));
  }

  const remoteRefNames = new Set(heads.map((h) => h.ref));
  const localBranchesWithoutRemote = git(["for-each-ref", "--format=%(refname:short)", "refs/heads"])
    .split("\n")
    .filter((ref) => ref.length > 0 && ref !== "main" && !remoteRefNames.has(ref))
    .map((ref) => ({
      ref,
      tipSha: git(["rev-parse", ref]),
      lastCommitAt: git(["show", "-s", "--format=%cI", ref]),
      hasWorktree: wtBranches.includes(ref),
    }));

  const worktrees = staleWorktreeDirectories(wtPaths);

  const openPullRequests = pullRequests.filter((pr) => pr.state === "OPEN").length;

  return {
    generatedAt: new Date().toISOString(),
    anchor: { mainSha, mainTree, remote: REMOTE },
    openPullRequests,
    policy: {
      ownerNamespaces: policy.ownerNamespaces as string[],
      ownerRetirementPolicy: policy.ownerRetirementPolicy,
      activeRefs: policy.activeRefs as string[],
    },
    totals: { remoteBranches: rows.length, ...countDispositions(rows) },
    branches: rows,
    localBranchesWithoutRemote,
    staleWorktreeDirectories: {
      home: worktrees.home,
      directories: worktrees.stale,
      ignoredNeighbours: worktrees.ignored,
    },
  };
}

function report(manifest: Manifest): void {
  const t = manifest.totals;
  console.log(`main            ${manifest.anchor.mainSha.slice(0, 7)}`);
  console.log(`open PRs        ${manifest.openPullRequests}`);
  console.log(`remote branches ${t.remoteBranches} (excluding main)`);
  console.log("");
  console.log(`  SAFE_DELETE      ${t.SAFE_DELETE}`);
  console.log(`  KEEP_ACTIVE      ${t.KEEP_ACTIVE}`);
  console.log(`  REVIEW_REQUIRED  ${t.REVIEW_REQUIRED}`);
  console.log(`  OWNER_BRANCH     ${t.OWNER_BRANCH}`);

  for (const kind of ["REVIEW_REQUIRED", "OWNER_BRANCH", "KEEP_ACTIVE"] as const) {
    const rows = manifest.branches.filter((b) => b.disposition === kind);
    if (rows.length === 0) continue;
    console.log("");
    console.log(`--- ${kind} (${rows.length}) ---`);
    for (const row of rows) console.log(`  ${row.ref} @ ${row.tipSha.slice(0, 7)}\n      ${row.evidence}`);
  }

  const local = manifest.localBranchesWithoutRemote;
  console.log("");
  console.log(`--- local branches with no remote counterpart (${local.length}) ---`);
  for (const row of local) {
    console.log(`  ${row.ref} @ ${row.tipSha.slice(0, 7)}${row.hasWorktree ? " (has a worktree)" : ""}`);
  }

  const stale = manifest.staleWorktreeDirectories;
  console.log("");
  console.log(`--- stale worktree directories (${stale.directories.length}) ---`);
  console.log(`  home: ${stale.home ?? "(none found)"}`);
  for (const dir of stale.directories) console.log(`  ${dir.path}\n      ${dir.mark}`);
  if (stale.ignoredNeighbours.length > 0) {
    console.log(`  ignored (no .git, not a worktree): ${stale.ignoredNeighbours.join(", ")}`);
  }
}

function readManifest(): Manifest {
  if (!existsSync(MANIFEST)) {
    console.error(`No manifest at ${MANIFEST}. Run \`pnpm branches:retire --write\` first.`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
}

function main(): void {
  const argv = process.argv.slice(2);
  const activeArg = argv.find((a) => a.startsWith("--active="));
  const activeExtra = activeArg ? activeArg.slice("--active=".length).split(",").filter(Boolean) : [];

  if (argv.includes("--verify")) {
    const recorded = readManifest();
    const drift = driftAgainstRemote(recorded.branches, readRemoteHeads());
    const clean = drift.added.length === 0 && drift.removed.length === 0 && drift.movedTip.length === 0;
    console.log(`manifest generated ${recorded.generatedAt}, ${recorded.branches.length} branches`);
    if (clean) {
      console.log("NO DRIFT — every recorded ref still exists at the recorded tip.");
      return;
    }
    console.log("DRIFT — the manifest no longer describes the remote. Re-run with --write before acting on it.");
    for (const ref of drift.added) console.log(`  ADDED    ${ref}`);
    for (const ref of drift.removed) console.log(`  REMOVED  ${ref}`);
    for (const m of drift.movedTip) {
      console.log(`  MOVED    ${m.ref} ${m.was.slice(0, 7)} -> ${m.now.slice(0, 7)}`);
    }
    process.exitCode = 1;
    return;
  }

  if (argv.includes("--print-deletions")) {
    const recorded = readManifest();
    const safe = recorded.branches.filter((b) => b.disposition === "SAFE_DELETE");
    console.log(`# ${safe.length} branch(es) classified SAFE_DELETE in a manifest generated ${recorded.generatedAt}.`);
    console.log("# THESE COMMANDS ARE NOT RUN BY THIS SCRIPT. Re-run --verify first, then paste what you accept.");
    for (const row of safe) console.log(`git push ${REMOTE} --delete ${row.ref}   # ${row.tipSha.slice(0, 7)}`);
    return;
  }

  const manifest = build(activeExtra);
  report(manifest);

  if (argv.includes("--write")) {
    mkdirSync(dirname(MANIFEST), { recursive: true });
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log("");
    console.log(`wrote ${MANIFEST}`);
  } else {
    console.log("");
    console.log("read-only. Pass --write to record this as the manifest.");
  }
}

main();
