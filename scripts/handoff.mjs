/**
 * End-of-session handoff.
 *
 *   pnpm handoff            report, sync the mirror, export transcripts
 *   pnpm handoff --check    report only; touch nothing
 *   pnpm handoff --ship     the above, then push, open a PR, merge it, and
 *                           fast-forward local main
 *
 * `--ship` exists because the author asked for a one-command close: everything
 * that is not current becomes current, the PR is created *and* merged, and the
 * next session starts clean. It is standing authorization, recorded here so the
 * behaviour is not a surprise.
 *
 * "The next session starts clean" is the part that was not true for a while.
 * `--ship` merged on GitHub and left local `main` a session behind, every time
 * — R07. It now pushes `-u` for a branch that has no upstream yet, and
 * fast-forwards local `main` after the merge, and the plain check reports a
 * stale local `main` as a warning. All three were the same assumption: that the
 * remote and the local refs would somehow keep themselves in step.
 *
 * What `--ship` will not do is commit for you. A commit needs a message that
 * says why, and generating one from a diff produces exactly the uninformative
 * history this project's tracker rules exist to prevent. So it refuses on a
 * dirty tree and tells you.
 *
 * Five surfaces have to agree before a session ends, and checking them by hand
 * is how they drift. This runs the whole sweep and prints a checklist you can
 * read at a glance:
 *
 *   1. the working tree      nothing uncommitted
 *   2. the branch            nothing unpushed
 *   3. main                  nothing unmerged, no PR left open, and the local
 *                            `main` ref actually current with origin
 *   4. the dev server        stopped, port 3000 free
 *   5. the G Drive mirror    the eight copied files byte-identical, plus
 *                            transcripts and two generated files with no repo
 *                            counterpart — `git-state.txt` (R09) and
 *                            `context.md` (R15), neither compared for drift,
 *                            both skipped by `--check` and rewritten after a
 *                            successful ship. Those ten are THE CANONICAL SET
 *                            (the author's ruling, 2026-08-17), and they live
 *                            in `scripts/mirror-set.mjs` so the copier, the
 *                            code mirror and the report cannot disagree about
 *                            what the folder holds. The folder's actual
 *                            contents are checked against the ten on every
 *                            run, and a difference is named — extra and
 *                            missing both — never reconciled.
 *
 *                            Then the CODE MIRROR (R30): a small curated set
 *                            of source files copied into `<mirror>/code/` so
 *                            the strategic reviewer can read code instead of
 *                            inferring it from reports. It runs on every
 *                            invocation, `--check` and `--ship` alike, and
 *                            `--no-code` skips it. See `scripts/mirror-code.mjs`.
 *
 * **Under `--ship` there is a sixth, and it runs before anything is pushed:**
 *
 *   6. the deploy gate       `pnpm build` — the same command Netlify runs —
 *                            with `tsconfig.tsbuildinfo` cleared first. A
 *                            failure refuses the ship and prints the
 *                            diagnostic, because Netlify's build log is
 *                            behind the author's login. See `buildGate()`
 *                            for why it is the build rather than `tsc`, and
 *                            for the pre-push hook that was rejected.
 *
 * `pnpm session:start` is the bookend, and checks the things that are wrong at
 * the *start* of a session — stale local main, a clobbered CLAUDE.md, a port
 * already in use.
 *
 * Exits non-zero if anything needs attention, so it can gate a commit hook
 * later without being rewritten.
 *
 * Without `--ship` it does not push, merge, or open a PR — it only reports on
 * them and does the two jobs that are pure copies.
 */

import { execFileSync, execSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkBranchNames } from "./check-branch-names.mjs";
import { writeContext } from "./context-file.mjs";
import { stopDevServer } from "./dev-server.mjs";
import { today } from "./doc-dates.mjs";
import { generatedAtEastern } from "./generated-at.mjs";
import { mirrorCode } from "./mirror-code.mjs";
import { COPIED_DOCS, MIRRORED_DOCS, checkMirrorContents } from "./mirror-set.mjs";
/* The workbook reader and the tracker stores — the mirror check compares a
   .xlsx by its ROWS rather than by its bytes; see workbookHoldsUnknownRows. */
import { RESOLVED_CSV, WORKING_CSV, readStore } from "./tracker-core.mjs";
import { readWorkbook } from "./xlsx.mjs";
import { tryRun as sharedTryRun } from "./try-run.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

/**
 * `tryRun`, bound to this repo's root.
 *
 * The IMPLEMENTATION is `scripts/try-run.mjs` — it was written twice and
 * `tests/duplicate-implementations.json` carried the pair (RULING 103). This is
 * a binding rather than a copy: it supplies `cwd` and nothing else.
 */
const tryRun = (cmd, args, opts = {}) => sharedTryRun(cmd, args, { cwd: ROOT, ...opts });

/** Overridable so a second machine with a different drive letter still works. */
const MIRROR =
  process.env.WTP_MIRROR ?? "G:/My Drive/we-the-people";

const EXPORTER = join(
  process.env.USERPROFILE ?? process.env.HOME ?? "",
  ".claude",
  "export-transcript.mjs",
);

/**
 * The eight copied documents, read from `scripts/mirror-set.mjs`.
 *
 * The list used to live here as a local `MIRRORED` array, and the two
 * GENERATED mirror files lived nowhere — which is how two consecutive session
 * reports named different sets as "the mirror" (seven and ten, four
 * overlapping). The canonical ten are now in one module that the document
 * mirror, the code mirror's duplicate refusal, and the report all read.
 */
const MIRRORED = COPIED_DOCS.map((d) => [d.repoPath, d.mirrorName]);

const CHECK_ONLY = process.argv.includes("--check");
const SHIP = process.argv.includes("--ship");
/** `--no-code` skips the code mirror (R30). Everything else still runs. */
const NO_CODE = process.argv.includes("--no-code");

/** `--title "..."` for the PR opened by --ship. */
function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

/* ------------------------------------------------------------------ util --- */

const results = [];
const ok = (label, detail) => results.push({ level: "ok", label, detail });
const warn = (label, detail) => results.push({ level: "warn", label, detail });
const fail = (label, detail) => results.push({ level: "fail", label, detail });

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

/*
 * `tryRun` moved to `scripts/try-run.mjs` on 2026-08-25 — it was written
 * twice and `tests/duplicate-implementations.json` carried the pair. The
 * shared one sets `maxBuffer` to 256 MB, because Node's 1 MB default made a
 * `git show` of `docs/state.md` THROW, which this function turns into
 * `null`, which a caller reads as "that version does not match".
 */

/**
 * Does this mirrored workbook hold a row id neither tracker store has?
 *
 * That is what a hand edit looks like — RULING 41: the author adds rows by hand,
 * and a session may never reword or delete one. Anything else about a rebuilt
 * `.xlsx` (entry order, zip stamps, a regenerated view) is not a reason to
 * refuse an overwrite.
 *
 * `unknown: null` means the file could not be read AS a workbook, which is a
 * different answer from "it holds nothing unknown" and is never treated as one.
 */
function workbookHoldsUnknownRows(mirrorPath, repoPath) {
  let known;
  try {
    /*
     * The two LIVE stores only. `docs/tracker.csv` is the frozen pre-rebuild
     * snapshot and carries a different column shape, so `readStore` refuses it
     * outright — and including it would be the wrong direction anyway: every id
     * added to `known` makes this guard WEAKER, and the safe error is to refuse
     * an overwrite we did not need to refuse rather than to permit one we should
     * not have.
     */
    const stores = [WORKING_CSV, RESOLVED_CSV].filter((p) => existsSync(join(ROOT, p)));
    known = new Set(stores.flatMap((p) => readStore(p).map((r) => r.ID)).filter(Boolean));
  } catch (e) {
    return { unknown: null, why: `the tracker stores would not read: ${e?.message ?? e}` };
  }
  if (known.size === 0) {
    return { unknown: null, why: "the tracker stores read as empty, so nothing could be compared" };
  }
  let sheets;
  try {
    sheets = readWorkbook(readFileSync(mirrorPath));
  } catch (e) {
    return { unknown: null, why: `${e?.message ?? e}` };
  }
  const unknown = [];
  for (const sheet of Object.values(sheets)) {
    const rows = sheet?.rows;
    if (!Array.isArray(rows) || rows.length < 2) continue;
    const idCol = rows[0].indexOf("ID");
    if (idCol < 0) continue;
    for (const row of rows.slice(1)) {
      const id = row[idCol];
      if (id && !known.has(id) && !unknown.includes(id)) unknown.push(id);
    }
  }
  void repoPath;
  return { unknown, why: "" };
}

/**
 * `git show rev:path` as raw bytes.
 *
 * Deliberately NOT `tryRun` with `encoding: "buffer"`: `tryRun` ends in
 * `.trim()`, a Buffer has no `.trim()`, so that call throws, is swallowed by
 * the catch, and returns `null` — which the caller would read as "this version
 * does not match" rather than as "the comparison never ran". A check that
 * cannot tell those two apart is the failure mode this repo keeps writing
 * down; separating them is cheaper than another instance of it.
 */
function gitShowBuffer(rev, repoPath) {
  try {
    return execFileSync("git", ["show", `${rev}:${repoPath}`], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

/**
 * Is the mirror copy already current? (R08, hardened 2026-08-17.)
 *
 * Renamed from `sameBytes` because raw bytes were the bug. The two halves of
 * the mirror step disagreed about what "same" means: this comparison read raw
 * bytes while the divergence check twenty lines below normalized CRLF first.
 * On Windows the working tree is CRLF and git stores LF, so any mirror copy
 * written with LF — by a different tool, a non-Windows checkout, or an editor
 * that normalizes on save — reads as DIFFERENT here forever. The result is a
 * full recopy every run and a permanently red line on the one gate meant to
 * catch a genuinely diverged mirror.
 *
 * It is not hypothetical arithmetic: CLAUDE.md is 45417 bytes in the working
 * tree and 45147 in git, and the 270-byte gap is exactly its 270 CRLF line
 * endings. A byte comparison across that boundary can only ever say "differs".
 *
 * Binary entries keep the raw comparison, for the reason the divergence check
 * already records: newline-normalizing a `.xlsx` compares two corrupted
 * strings. So the flag has to reach this function rather than being applied
 * only downstream of it — which is what let the two halves drift apart.
 */
function sameContent(a, b, isBinary) {
  if (!existsSync(a) || !existsSync(b)) return false;
  if (isBinary) {
    if (statSync(a).size !== statSync(b).size) return false;
    return readFileSync(a).equals(readFileSync(b));
  }
  // No size shortcut for text: two files that differ only in line endings have
  // different sizes and identical content, which is the whole case above.
  const normalize = (s) => s.replace(/\r\n/g, "\n").trimEnd();
  return normalize(readFileSync(a, "utf8")) === normalize(readFileSync(b, "utf8"));
}

/* ------------------------------------------------------------------ 1-3 --- */

// Every count below is meaningless against a stale remote. Twice in one session
// a claim about branch state was wrong because it was written before a fetch.
const fetched = tryRun("git", ["fetch", "origin", "--quiet"]) !== null;
if (!fetched) {
  warn("fetch", "could not reach origin — every git count below may be stale");
}

const branch = git("rev-parse", "--abbrev-ref", "HEAD");

/**
 * THE TREE, WITH THIS TOOL'S OWN OUTPUT SET ASIDE — AND NAMED.
 *
 * `docs/context.md` is written BY THIS SCRIPT, a few steps below. The check
 * runs first, so a run always sees the PREVIOUS run's output sitting
 * uncommitted — and `ship()` refuses on any dirty entry. **The tool blocked its
 * own door**: commit the file, run again, it writes a new one, refused again.
 *
 * That was survivable while a session could push close-out records to `main`
 * separately. **RULING 124 item 5 removed that escape**, which turned an
 * annoyance into a deadlock — found on 2026-08-24, the day the ruling shipped.
 *
 * So the generated artifact is excluded from the SHIP-BLOCKING set and stated
 * rather than silently dropped. Everything else still blocks, and the entries
 * are now NAMED: "1 uncommitted file(s)" is a number nobody can act on.
 */
const GENERATED_BY_THIS_TOOL = ["docs/context.md"];

const allDirty = git("status", "--porcelain")
  .split("\n")
  .filter((l) => l.trim() !== "");
/*
 * The PATH out of a porcelain line, without assuming a fixed prefix width.
 *
 * `git()` trims its whole output, which eats the FIRST line's leading space —
 * so " M docs/context.md" arrives as "M docs/context.md" and a `slice(3)`
 * reads "ocs/context.md". Caught on 2026-08-24 by the exclusion silently not
 * excluding anything, which is the quiet direction for this to fail in.
 */
const porcelainPath = (line) => line.replace(/^\s*\S{1,2}\s+/, "").trim();
const generatedHere = allDirty.filter((l) =>
  GENERATED_BY_THIS_TOOL.includes(porcelainPath(l)),
);
const dirty = allDirty.filter((l) => !generatedHere.includes(l));

if (dirty.length === 0) {
  ok(
    "working tree",
    generatedHere.length === 0
      ? "clean"
      : `clean apart from ${generatedHere.length} file(s) this tool writes itself: ${generatedHere.map(porcelainPath).join(", ")}`,
  );
} else {
  fail(
    "working tree",
    `${dirty.length} uncommitted file(s): ${dirty.map((l) => l.trim()).slice(0, 8).join(" · ")}` +
      (dirty.length > 8 ? ` · … and ${dirty.length - 8} more` : ""),
  );
}

// Reassigned by ship(), which creates the upstream when a new branch has none.
let upstream = tryRun("git", [
  "rev-parse",
  "--abbrev-ref",
  "--symbolic-full-name",
  "@{u}",
]);

if (!upstream) {
  fail("branch", `${branch} has no upstream — nothing is backed up`);
} else {
  const unpushed = Number(git("rev-list", "--count", `${upstream}..HEAD`));
  const behind = Number(git("rev-list", "--count", `HEAD..${upstream}`));
  if (unpushed === 0 && behind === 0) ok("branch", `${branch} matches ${upstream}`);
  else if (unpushed > 0) fail("branch", `${unpushed} commit(s) not pushed — only on this machine`);
  else warn("branch", `${behind} commit(s) on ${upstream} not pulled`);
}

const hasMain = tryRun("git", ["rev-parse", "--verify", "origin/main"]) !== null;
if (!hasMain) {
  warn("main", "no origin/main to compare against");
} else {
  const unmerged = Number(git("rev-list", "--count", "origin/main..HEAD"));
  if (unmerged === 0) ok("main", "carries everything on this branch");
  else warn("main", `${unmerged} commit(s) not merged — a PR is still needed`);

  // Cheaper and more honest than the commit count: main can be "behind" by
  // merge commits while holding an identical tree.
  const identical = tryRun("git", ["diff", "--quiet", "origin/main", "HEAD"]) !== null;
  if (identical) ok("main tree", "identical to the local tree");
  else if (unmerged === 0) warn("main tree", "differs despite no unmerged commits — look at it");
}

/** The command that would fix a stale local `main` from where we are standing. */
function ffCommand() {
  // `fetch origin main:main` updates the ref without touching the working tree,
  // but git rejects it when main is the branch you are on.
  return branch === "main"
    ? "git merge --ff-only origin/main"
    : "git fetch origin main:main";
}

/**
 * R07: local `main` against `origin/main`.
 *
 * This is the comparison nothing above makes. The branch is checked against its
 * own upstream and `main` against the branch, but the local `main` ref is never
 * checked against the remote one — so it can sit a whole session behind while
 * every other line reads clean, and the next checkout of `main` presents a
 * project containing nothing but `CLAUDE.md`. That happened.
 */
function checkLocalMain() {
  if (!hasMain) return;

  const localMain = tryRun("git", ["rev-parse", "--verify", "main"]);
  if (localMain === null) {
    warn("local main", "no local main branch");
    return;
  }

  const behind = Number(git("rev-list", "--count", "main..origin/main"));
  const ahead = Number(git("rev-list", "--count", "origin/main..main"));

  if (behind === 0 && ahead === 0) ok("local main", "matches origin/main");
  else if (ahead > 0)
    warn("local main", `diverged — ${behind} behind, ${ahead} ahead of origin/main`);
  else warn("local main", `${behind} commit(s) behind origin/main — ${ffCommand()}`);
}

checkLocalMain();

/**
 * IS `origin/main` GREEN? (NJ Hunt 3 item 1.6, 2026-08-22.)
 *
 * Every check above compares REFS. None of them asks what happened to the
 * commits after they landed, and that is the question that went unasked on
 * 2026-08-22: NJ Hunt 2's two close-out commits put `main` red, Netlify refused
 * both deploys, production stayed on the previous build for the rest of the
 * day, and this checklist printed clean throughout — because every line on it
 * was, truthfully, clean. A session may not report clean gates while leaving
 * `main` failing and production stale.
 *
 * `warn` for PENDING and for CANNOT TELL, `fail` for RED. The distinction is
 * the standing one: a check that could not reach its subject must never print
 * like a passing one, and must not print like a failure of the subject either.
 */
function checkMainGreen() {
  if (!hasMain) return;
  /*
   * NOT `tryRun`. `main-green.mjs` exits 1 on RED, 3 on PENDING and 2 on
   * cannot-tell — deliberately, so it can gate a shell — and `tryRun` throws
   * away the stdout of anything that exits non-zero. Routing this through it
   * would report every RED main as "could not ask GitHub", which is the exact
   * confusion between a failing subject and a failing check that both this
   * function and `tryRun`'s own neighbour comment exist to prevent. The verdict
   * is in the JSON on stdout; the exit code is for other callers.
   */
  const probed = spawnSync(process.execPath, [join(ROOT, "scripts", "main-green.mjs"), "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let result = null;
  try {
    result = JSON.parse((probed.stdout ?? "").trim());
  } catch {
    /* falls through to the cannot-tell branch below */
  }
  if (!result) {
    warn("main checks", "could not ask GitHub — this says NOTHING about main's tip");
    return;
  }
  const short = (result.sha ?? "unknown").slice(0, 7);
  if (result.verdict === "green") ok("main checks", `${short} green — ${result.why}`);
  else if (result.verdict === "red")
    fail(
      "main checks",
      `${short} RED — ${result.failed.join(", ")}. main is broken and production will not deploy`,
    );
  else if (result.verdict === "pending")
    warn("main checks", `${short} still running — ${result.pending.join(", ")}`);
  else warn("main checks", `${short} cannot tell — ${result.why}`);
}

checkMainGreen();
/**
 * `NS15` — does every serving surface still have its store?
 *
 * Speak Your Mind shipped live on production with its table missing: the surface
 * rendered, the route answered, every insert failed, the route caught the error,
 * and the page carried on as though the words had been kept. A reader typed
 * something they meant and this product dropped it silently.
 *
 * `pnpm db:check` would have caught it and nobody fired it. This fires it, here,
 * where a session reads its gates — and it asks the better question, because
 * `db:check` compares migration TAGS and cannot say *the Speak Your Mind box has
 * nowhere to write*.
 *
 * A `CANNOT TELL` (exit 2 — no credential, or the catalog would not answer) is a
 * WARNING and never a pass. A session without the production credential is not a
 * session that has verified anything.
 */
function checkServingSurfaces() {
  const probed = spawnSync(
    process.execPath,
    [join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), join(ROOT, "scripts", "assert-serving-tables.mts"), "--target=production"],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const out = `${probed.stdout ?? ""}${probed.stderr ?? ""}`;
  const broken = [...out.matchAll(/^ {2}BROKEN {2}(\S+)/gm)].map((m) => m[1]);
  if (probed.status === 0) {
    ok("serving surfaces", "every reader surface on production has its store");
  } else if (probed.status === 1) {
    fail(
      "serving surfaces",
      `${broken.join(", ") || "a surface"} has NO STORE on production — a reader's input is being ` +
        "accepted and dropped. Apply the committed migrations before shipping.",
    );
  } else {
    warn(
      "serving surfaces",
      "COULD NOT TELL — no credential, or the catalog would not answer. This is not a pass.",
    );
  }
}

checkServingSurfaces();


const prs = tryRun("gh", [
  "pr",
  "list",
  "--state",
  "open",
  "--json",
  "number,title",
]);

/** Null means gh could not answer — which is not the same as "none open". */
let openPrs = null;

if (prs === null) {
  warn("pull requests", "gh unavailable — check for open PRs by hand");
} else {
  const open = JSON.parse(prs || "[]");
  openPrs = open;
  if (open.length === 0) ok("pull requests", "none open");
  else {
    // A PR merges from a snapshot: anything pushed after it was opened is left
    // behind silently. That stranded commits twice in one day.
    warn(
      "pull requests",
      `${open.length} open — ${open.map((p) => `#${p.number} ${p.title}`).join("; ")}`,
    );
  }
}

/* ----------------------------------------------------------- git-state --- */

/**
 * The last verified `test` / `lint` / `build` claim, read out of `docs/state.md`
 * rather than re-run.
 *
 * Re-running the suite here would report a number nobody wrote down, and this
 * project's tracker rule is that a status is a claim a person committed to with
 * evidence — not one a script inferred on its way past. So this reports the
 * recorded claim and says which line it came from, which is checkable.
 *
 * It takes the *last* matching line in the file: `state.md` accretes downward,
 * so the newest claim is the lowest one.
 */
function lastRecordedStatus() {
  const rel = "docs/state.md";
  const path = join(ROOT, rel);
  if (!existsSync(path)) return { where: `${rel} missing` };

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  let line = null;
  let lineNo = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/\b\d+\s+tests?\b/.test(lines[i])) {
      line = lines[i];
      lineNo = i + 1;
    }
  }
  if (line === null) return { where: `no test count recorded in ${rel}` };

  const verdict = /\bfails?\b|\bfailing\b|\bred\b/i.test(line)
    ? "fail"
    : /\bpass(es|ing)?\b|\bgreen\b/i.test(line)
      ? "pass"
      : "recorded without a verdict";

  return {
    tests: line.match(/(\d+)\s+tests?\b/)[1],
    testVerdict: verdict,
    lint: /\blint\b/i.test(line) ? verdict : "not recorded",
    build: /\bbuild\b/i.test(line) ? verdict : "not recorded",
    where: `${rel}:${lineNo}`,
  };
}

/**
 * Write `git-state.txt` into the mirror.
 *
 * Unlike the five mirrored files this one has no repo counterpart — it is
 * generated, not copied, and exists so a session that opens on the mirror
 * (drive mounted, repo not yet cloned or fast-forwarded) can see where git
 * actually stood without running git. It carries the R07 check specifically,
 * because local `main` going stale is invisible from inside the repo until
 * someone checks `main` out and finds it apparently empty.
 *
 * Plain text, one fact per line, no formatting — it is meant to be read whole.
 */
/**
 * The facts, built once so `git-state.txt` and `context.md` cannot disagree.
 *
 * They are written in the same run from the same array; two independent
 * readings of git taken a few hundred milliseconds apart would be two
 * different claims about the same moment, and the mirror would hold both.
 */
let gitFacts = [];

function writeGitState() {
  if (!existsSync(MIRROR)) {
    warn("git state", "mirror drive not reachable — not written");
    return;
  }

  const lines = [];
  const put = (label, value) => lines.push(`${label}: ${value}`);

  // R18: git-state.txt is a generated mirror document, so Eastern.
  put("generated", generatedAtEastern());
  put("branch", branch);

  const subject = (rev) => tryRun("git", ["log", "-1", "--format=%s", rev]);
  const sha = (rev) => tryRun("git", ["rev-parse", rev]);

  put("head sha", sha("HEAD") ?? "unknown");
  put("head subject", subject("HEAD") ?? "unknown");

  if (!hasMain) {
    put("origin/main sha", "no origin/main");
    put("origin/main subject", "no origin/main");
  } else {
    put("origin/main sha", sha("origin/main") ?? "unknown");
    put("origin/main subject", subject("origin/main") ?? "unknown");
  }

  // The R07 check: local main against origin/main. Nothing else in this script
  // compares those two — it checks the branch against its own upstream and main
  // against the branch — which is the exact gap that let local main sit a whole
  // session behind while every other line read clean.
  const localMain = tryRun("git", ["rev-parse", "--verify", "main"]);
  put("local main sha", localMain ?? "no local main branch");

  if (!hasMain || localMain === null) {
    put("local main matches origin/main", "cannot tell — one of the two is missing");
  } else if (localMain === sha("origin/main")) {
    put("local main matches origin/main", "yes");
  } else {
    const behind = Number(git("rev-list", "--count", "main..origin/main"));
    const ahead = Number(git("rev-list", "--count", "origin/main..main"));
    const detail = [
      `${behind} commit(s) behind`,
      ahead ? `${ahead} ahead` : null,
    ]
      .filter(Boolean)
      .join(", ");
    put("local main matches origin/main", `no — ${detail}`);
  }

  put(
    "working tree",
    dirty.length === 0 ? "clean" : `dirty — ${dirty.length} changed file(s)`,
  );

  if (openPrs === null) {
    put("open prs", "unknown — gh unavailable");
  } else if (openPrs.length === 0) {
    put("open prs", "none");
  } else {
    put("open prs", String(openPrs.length));
    for (const pr of openPrs) put("open pr", `#${pr.number} ${pr.title}`);
  }

  const status = lastRecordedStatus();
  put(
    "last recorded tests",
    status.tests ? `${status.tests} (${status.testVerdict})` : "not recorded",
  );
  put("last recorded lint", status.lint ?? "not recorded");
  put("last recorded build", status.build ?? "not recorded");
  put("last recorded status from", status.where);

  writeFileSync(join(MIRROR, "git-state.txt"), lines.join("\n") + "\n", "utf8");
  gitFacts = lines;
  return true;
}

if (CHECK_ONLY) {
  ok("git state", "skipped (--check)");
} else if (writeGitState()) {
  ok("git state", "git-state.txt written to the mirror");
}

/* ----------------------------------------------------------- context.md --- */

/**
 * The seventh mirror file, and the second generated one.
 *
 * Same posture as `git-state.txt` and for the same reason: it has no repo
 * counterpart, so there is nothing to compare it against and a drift check
 * could only report noise. It is skipped by `--check` (which touches
 * nothing), written on a plain run, and rewritten after a successful
 * `--ship` because merging moves every fact in it.
 *
 * A failure here is a warning, never a failure of the handoff. The mirror's
 * job is to survive the loss of the repo; a generated convenience file that
 * could block a session from ending would be worse than not having it.
 */
async function writeContextFile(note) {
  /*
   * RULING 108 (2026-08-23). This used to RETURN here when the mirror was
   * absent, so a machine with no Drive produced no context.md at all — and a
   * session, which never has Drive, was told to open a file that was never
   * written for it. The repo copy is the primary output now and is written
   * whether or not the mirror exists; an unreachable mirror is a warning about
   * the mirror, not a reason to skip the file.
   */
  const mirrorReachable = existsSync(MIRROR);
  try {
    const built = await writeContext(mirrorReachable ? MIRROR : null, {
      gitFacts,
      // R18: the generated-at line on a generated DOCUMENT is Eastern.
      // `stampToday` below stays America/Phoenix — different question, and
      // context.md deliberately carries both.
      generatedAt: generatedAtEastern(),
      stampToday: today(),
    });
    const kb = (built.bytes / 1024).toFixed(1);
    /*
     * RULING 106 (2026-08-23): there is no cap, so the line states the SIZE
     * and stops. It used to read "N KB of 40 KB", which invites the next
     * reader to treat the second number as a budget and trim to it — and
     * trimming a generated file is the failure the ruling ends.
     *
     * Item 8c's lesson survives in the shape: the number is READ from the
     * generator, never restated here. That line said "of 20 KB" while the
     * generator had been raised to 40, so the first run after the raise
     * printed "23.0 KB of 20 KB" and looked like an overrun nothing warned
     * about.
     */
    const counts =
      `${built.counts.phases} phase(s), ${built.counts.p0} P0 row(s), ` +
      `${built.counts.ripcords} ripcord(s), ${built.counts.statusChanges} status change(s)`;
    const where = built.mirrored
      ? `${built.repoPath} and the mirror`
      : `${built.repoPath} (mirror not reachable — the repo copy is the one a session reads)`;
    ok("context", `context.md ${note} — ${where}, ${kb} KB, uncapped, ${counts}`);
    if (built.mirrorError) warn("context", `mirror copy not written — ${built.mirrorError}`);
    for (const line of built.truncation) warn("context", line);
  } catch (error) {
    warn("context", `context.md not written — ${error.message}`);
  }
}

if (CHECK_ONLY) {
  ok("context", "skipped (--check)");
} else {
  await writeContextFile("written");
}

/* ---------------------------------------------------------- dev server --- */

// Before the mirror, not after. A handoff that syncs and reports "safe to end
// the session" while something is still serving on 3000 is a false report — the
// next session's `predev` will refuse, or worse, Next slides to 3001 and the
// screenshots come from a build nobody is looking at.
{
  const { outcome, detail } = await stopDevServer({ dryRun: CHECK_ONLY });
  if (outcome === "occupied") fail("dev server", detail);
  else if (outcome === "foreign") warn("dev server", detail);
  else ok("dev server", CHECK_ONLY ? `${detail}` : detail);
}

/* ------------------------------------------------------- 3b branch names --- */

// R11: a branch named in a tracker Note has to be one this repository
// remembers. R03 requires every Done row to name its branch, and until this ran
// nothing checked that the name was real — so the requirement produced
// well-formatted fiction three times. Reports, never blocks: the rows it flags
// are history, and failing a ship over old prose would teach everyone to skip
// the line.
{
  const { unresolved, checked } = checkBranchNames(join(ROOT, "docs/tracker.csv"));
  if (unresolved.size === 0) {
    ok("branch names", `${checked} named in tracker Notes, all remembered by git`);
  } else {
    for (const [name, rowIds] of unresolved) {
      warn(
        "branch names",
        `${name} is claimed by ${rowIds.join(", ")} but is not a ref, a merge subject, or in the reflog`,
      );
    }
  }
}

/* -------------------------------------------------------------- 4 mirror --- */

if (!existsSync(MIRROR)) {
  warn("mirror", `${MIRROR} not reachable — is the drive mounted?`);
} else {
  let copied = 0;
  let already = 0;
  const problems = [];

  for (const [repoPath, mirrorName] of MIRRORED) {
    const from = join(ROOT, repoPath);
    const to = join(MIRROR, mirrorName);

    // Hoisted above the comparison (R08). `sameContent` needs to know whether
    // this entry is binary, and computing it after the call is what allowed the
    // comparison and the divergence check below to use different rules.
    const entry = MIRRORED_DOCS.find((d) => d.repoPath === repoPath);
    const isBinary = entry?.binary === true;

    if (sameContent(from, to, isBinary)) {
      already++;
      continue;
    }

    if (CHECK_ONLY) {
      problems.push(`${mirrorName} differs`);
      continue;
    }

    // Before overwriting, make sure the mirror is not holding something the
    // repo never had. A mirror that matches *any* past version of the file is
    // simply stale, which is the normal case and safe to refresh. Only one
    // matching no version in the file's history contains something unique, and
    // copying over that would lose it.
    //
    // Comparing against HEAD alone is wrong and was: it flagged every ordinary
    // stale copy as diverged the moment a new commit landed.
    //
    // BINARY entries take the same check on raw BYTES. Reading a `.xlsx`
    // through a utf8 decode and then trimming whitespace off the end compares
    // two corrupted strings, so the check would have answered "matches no
    // version" on the first ordinary update of a mirrored workbook and refused
    // it — a protection misfiring into a permanent block. `deferred.xlsx` was
    // the first binary in the set and found this before it shipped.
    // (`entry` and `isBinary` are computed above, before the sameContent call.)
    const mirrorBytes = existsSync(to)
      ? readFileSync(to, isBinary ? null : "utf8")
      : null;

    if (mirrorBytes !== null) {
      const normalize = (s) => s.replace(/\r\n/g, "\n").trimEnd();
      const target = isBinary ? mirrorBytes : normalize(mirrorBytes);

      /*
       * ── A WORKBOOK IS COMPARED BY ITS ROWS, NEVER BY ITS BYTES ────────────
       *
       * A `.xlsx` is a ZIP, and this repo rebuilds one on every `pnpm
       * tracker:views`. Two rebuilds of identical data differ in bytes — entry
       * order and stamps — so a byte comparison against committed history can
       * only pass if the mirror happens to hold the exact bytes of a commit,
       * which it generally does not: the mirror is written when a session runs,
       * and the commit is made afterwards.
       *
       * The consequence, measured 2026-08-25: the guard reported **tracker.xlsx
       * matches no version in this file's history — not overwritten, diff it by
       * hand** and FAILED the handoff, which under RULING 75 is a gate. Diffing
       * it by hand as instructed found the mirror's Working sheet held **246
       * rows, ZERO of them absent from the repo's two stores** — no hand edit at
       * all, just a copy sixteen rows behind.
       *
       * So the question is asked properly: does the mirror workbook contain a
       * ROW this repo has never held? That is what a hand edit looks like
       * (RULING 41 — the author adds rows by hand and a session may never
       * reword or delete one), and it is the only thing worth refusing over.
       * Stamps in a zip are not.
       *
       * A workbook that fails to PARSE is refused, not waved through: an
       * unreadable file is not a file we know is safe to overwrite.
       */
      if (isBinary && /\.xlsx$/i.test(repoPath)) {
        const verdict = workbookHoldsUnknownRows(to, repoPath);
        if (verdict.unknown === null) {
          problems.push(`${mirrorName} could not be read as a workbook (${verdict.why}) — not overwritten`);
          continue;
        }
        if (verdict.unknown.length > 0) {
          problems.push(
            `${mirrorName} holds ${verdict.unknown.length} row id(s) this repo has never held ` +
              `(${verdict.unknown.slice(0, 6).join(", ")}) — a hand edit, not overwritten`,
          );
          continue;
        }
        /* Every row is one this repo knows. Safe to overwrite. */
      } else {
        const revs = (
          tryRun("git", ["rev-list", "--max-count=60", "HEAD", "--", repoPath]) ?? ""
        )
          .split("\n")
          .filter(Boolean);

        const known = revs.some((rev) => {
          if (isBinary) {
            const past = gitShowBuffer(rev, repoPath);
            return past !== null && Buffer.compare(past, target) === 0;
          }
          const past = tryRun("git", ["show", `${rev}:${repoPath}`]);
          return past !== null && normalize(past) === target;
        });

        if (!known) {
          problems.push(
            `${mirrorName} matches no version in this file's history — not overwritten, diff it by hand`,
          );
          continue;
        }
      }
    }

    copyFileSync(from, to);
    copied++;
  }

  const summary = [
    already ? `${already} already current` : null,
    copied ? `${copied} copied` : null,
  ]
    .filter(Boolean)
    .join(", ");

  if (problems.length === 0)
    ok("mirror", summary || `${MIRRORED.length}/${MIRRORED.length} identical`);
  else fail("mirror", problems.join("; "));
}

/* ------------------------------------------------- the canonical ten (6b) --- */

/**
 * The folder's ACTUAL contents against the canonical ten.
 *
 * Runs LAST, after both mirrors have written. Ordering is not cosmetic here:
 * the first version checked the folder before the code mirror had created
 * `code/`, so the very first run reported `missing dir(s): code` — a real
 * failure line about a directory that existed by the time the run ended. A
 * check that reads the folder must read it after everything that writes to it.
 *
 * The author's ruling of 2026-08-17: the folder defines the set, and a
 * difference between it and the list "is a loud failure, not a silent
 * reconciliation — name what is extra and what is missing." Nothing here
 * repairs anything. Deleting what the mirror did not expect would make this
 * script capable of destroying the author's own files, and quietly adopting an
 * unexpected file into the set is how the list drifted in the first place.
 */
function reportMirrorSet() {
  const contents = checkMirrorContents(MIRROR);
  if (contents === null) {
    warn("mirror set", "drive not reachable — the canonical ten were not checked");
  } else {
    const notes = [];
    if (contents.missing.length)
      notes.push(`MISSING: ${contents.missing.join(", ")}`);
    if (contents.extra.length)
      notes.push(`EXTRA: ${contents.extra.join(", ")}`);
    if (contents.missingDirs.length)
      notes.push(`missing dir(s): ${contents.missingDirs.join(", ")}`);
    if (contents.extraDirs.length)
      notes.push(`extra dir(s): ${contents.extraDirs.join(", ")}`);

    // Declared extras are named on every run rather than filtered into
    // silence. The point of declaring one is to stop it failing the session,
    // never to stop it being visible.
    const declared = contents.declaredExtras.length
      ? ` (declared, not counted: ${contents.declaredExtras.join(", ")})`
      : "";

    // The count is READ from the set, never restated. It shipped as a literal
    // "10" for one run and printed "the canonical 10 present" on a run that
    // listed twelve — the same defect as the context generator saying "of
    // 20 KB" after its cap was raised to 40.
    if (notes.length === 0)
      ok(
        "mirror set",
        `the canonical ${MIRRORED_DOCS.length} present, nothing undeclared${declared}`,
      );
    else fail("mirror set", `${notes.join(" · ")}${declared}`);
  }
}

/**
 * All ten, by name, with bytes.
 *
 * "Seven mirror file sizes" is retired from the standing report format by the
 * same ruling — it was never seven, and a report format that undercounts the
 * folder is how a missing file goes unnoticed. A file the drive does not hold
 * prints as `absent`, never as `0`: a zero is a size, and absence is not.
 */
function reportMirrorSizes() {
  const sizes = MIRRORED_DOCS.map((d) => {
    const at = join(MIRROR, d.mirrorName);
    return `${d.mirrorName} ${existsSync(at) ? statSync(at).size : "absent"}`;
  });
  ok("mirror sizes", sizes.join(" · "));
}

/* ------------------------------------------------------- code mirror (R30) --- */

/**
 * The reviewer's read path into source. Runs on EVERY invocation — plain,
 * `--check` and `--ship` alike.
 *
 * Wiring it into `--ship` only would have meant it never ran at session close
 * in any session that ends some other way, and session close is the one moment
 * it matters. It sits after the document mirror because the duplicate refusal
 * reads the document set, and it is the last thing to touch the drive.
 */
if (NO_CODE) {
  ok("code mirror", "skipped (--no-code)");
} else {
  const result = mirrorCode({
    root: ROOT,
    mirrorPath: MIRROR,
    checkOnly: CHECK_ONLY,
    headSha: tryRun("git", ["rev-parse", "HEAD"]),
  });

  if (result.level === "fail") fail("code mirror", result.detail);
  else if (result.level === "warn") warn("code mirror", result.detail);
  else ok("code mirror", result.detail);

  // Every refusal is named on its own line. A count alone would let a file
  // drop out of the reviewer's reach without anyone reading which one.
  for (const row of result.rows.filter((r) => r.skipped)) {
    warn("code · refused", `${row.repoPath} — ${row.reason}`);
  }
  for (const name of result.removedNames ?? []) {
    warn("code · removed", `${name} — struck from the allowlist, deleted from Drive`);
  }
  for (const row of result.rows.filter((r) => r.nearCap !== undefined)) {
    warn(
      "code · near cap",
      `${row.repoPath} is ${row.bytes} bytes — ${row.nearCap} short of the per-file cap, and refused once it crosses`,
    );
  }
}

// Both mirrors have now written. Only now is reading the folder meaningful.
reportMirrorSet();
reportMirrorSizes();

/* ---------------------------------------------------------- transcripts --- */

if (CHECK_ONLY) {
  ok("transcripts", "skipped (--check)");
} else if (!existsSync(EXPORTER)) {
  warn("transcripts", `exporter not found at ${EXPORTER}`);
} else if (!existsSync(MIRROR)) {
  warn("transcripts", "mirror drive not reachable");
} else {
  const out = tryRun("node", [EXPORTER, "--out", join(MIRROR, "transcripts")]);
  if (out === null) warn("transcripts", "export failed");
  else {
    const n = (out.match(/^\d+ transcript/m) ?? [])[0] ?? "exported";
    ok("transcripts", n.replace(/^(\d+) transcript.*/, "$1 exported"));
  }
}

/*
 * THE EXPORT IS AN OUTPUT CHANNEL, AND RULING 127 PUTS REDACTION AT ONE.
 *
 * The mirror was scrubbed clean on 2026-08-24 and was dirty again the next
 * morning — six occurrences of five live credentials. Nothing un-scrubbed it.
 * The exporter simply re-wrote the same transcripts out of the local `.jsonl`
 * files, which are deliberately NOT scrubbed: they are the runtime's own state,
 * and corrupting them to remove a value that has already escaped pays a real
 * cost for no security (tracker NS11).
 *
 * So a scrub run by hand can only ever be true until the next handoff. It has
 * to sit HERE, immediately after the write, or the mirror — the surface that
 * actually leaves this machine, RULING 108 — is re-contaminated by the very
 * command whose job is to publish it.
 *
 * The scrub exits non-zero whenever it FOUND anything, scrubbed or not, so its
 * exit status is not the signal. The verdict is a fresh re-read afterwards,
 * which is RULING 113: observe the step's product at the step.
 */
if (!CHECK_ONLY && existsSync(MIRROR)) {
  const quiet = { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  try {
    execSync("pnpm run secrets:scrub-mirror", quiet);
  } catch {
    // Non-zero is the normal path — it means occurrences were found. Whether
    // they are gone is answered by the re-read below, never by this status.
  }
  let verdict;
  try {
    verdict = execSync("pnpm run secrets:sweep", quiet);
  } catch (error) {
    verdict = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  if (/0 secret occurrence\(s\) across/.test(verdict ?? "")) {
    ok("transcripts · secrets", "mirror re-read clean — 0 credential values");
  } else {
    fail(
      "transcripts · secrets",
      "the mirror still carries a credential value after the scrub — run pnpm secrets:sweep",
    );
  }
}

/* ---------------------------------------------------------------- ship --- */

/**
 * **The deploy gate** — born 2026-08-16, from a deploy that did not land.
 *
 * ## What happened
 *
 * `main@705f73b` merged green and production kept serving the previous build
 * for an hour. Netlify's build failed type-check on
 * `scripts/walk-0815g.mts(313,23): TS18048` — a walk SCRIPT, not site code.
 * The session had run `pnpm build` and seen exit 0, and had not lied: the
 * build ran BEFORE that file was written, and nothing type-checked the tree
 * again between writing it and shipping. Diagnosed rather than assumed — a
 * warm-cache `pnpm build` on the same tree reproduces the failure exactly, so
 * the stale-`.next` theory is wrong and the ordering one is right.
 *
 * ## Why the gate is `pnpm build`, not `tsc --noEmit`
 *
 * The gate has to be the check Netlify runs, and Netlify runs
 * `corepack pnpm run build`. `tsc --noEmit` is *nearly* the same pass — the
 * build prints "Running TypeScript ..." and then the identical diagnostic —
 * but `tsconfig.json` includes `.next/types/**\/*.ts`, the route types Next
 * GENERATES during a build. A bare `tsc` run checks whatever those files
 * happened to say last time, so a bad route-handler signature is exactly the
 * class of error it could miss. Running the real command removes the question
 * instead of reasoning about it.
 *
 * `tsconfig.tsbuildinfo` is cleared first because `"incremental": true` is on
 * and Netlify starts from a clean checkout. (Measured: the warm build caught
 * this error anyway — incremental does track new files. Cleared regardless,
 * because "it happened to work this time" is not a property.)
 *
 * ## Rejected alternative, recorded
 *
 * A `.githooks/pre-push` hook. It would catch a push that bypasses this
 * script, which handoff cannot — but it is installed by
 * `git config core.hooksPath .githooks`, which is per-clone and which
 * `pnpm session:start` only *reports* on. A gate that can be silently absent
 * in a fresh clone is not a gate. It would also run on every
 * work-in-progress push, and a minute of build on each is how a check gets
 * `--no-verify`d out of existence. `--ship` is the single door everything
 * merges through, it already refuses on a dirty tree, and its output is the
 * checklist a session actually reads.
 *
 * **There is deliberately no skip flag.** An escape hatch on a gate is how
 * the gate stops meaning anything, and the failure it exists to prevent cost
 * a whole session's work sitting unshipped behind a green checkmark.
 */
function buildGate() {
  try {
    rmSync(join(ROOT, "tsconfig.tsbuildinfo"), { force: true });
  } catch {
    // Not being able to clear it is survivable — the build still type-checks.
  }

  const started = Date.now();
  try {
    /*
     * `execSync` with ONE literal command string, not `execFileSync` with an
     * args array — and this was measured, not preferred.
     *
     * `execFileSync("pnpm", …)` cannot run pnpm on Windows at all: it is a
     * `.cmd` shim, and Node has refused to spawn `.cmd`/`.bat` without a
     * shell since the 2024 argument-injection fix. `execFileSync("pnpm.cmd",
     * …)` fails the same way. Adding `shell: true` to an args array works but
     * emits Node's DEP0190 warning into the middle of the checklist. A single
     * literal string has no args to escape and no injection surface — nothing
     * here is interpolated.
     *
     * The first version of this gate got that wrong, and the failure mode is
     * the one worth recording: it could not START the build, threw, and
     * reported "pnpm build failed" — refusing a ship over a tree that builds
     * clean. A gate that cannot tell "the build failed" from "the gate could
     * not run" is not trustworthy in either direction, which is why the two
     * are separated below.
     */
    execSync("pnpm run build", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    // No exit status means the command never ran — a broken gate, not a
    // broken tree. It still refuses (a check that did not run may not pass),
    // but it says which thing went wrong.
    if (typeof error.status !== "number") {
      fail(
        "ship · build",
        `refused — the gate could not RUN pnpm build (${error.message?.split("\n")[0] ?? "no status"}); this is the gate failing, not the tree`,
      );
      return false;
    }

    const out = `${error.stdout ?? ""}${error.stderr ?? ""}`;

    /*
     * THE BUILD NEVER STARTED — a third state, and it is the one that cost
     * g11 two ship attempts (2026-08-17).
     *
     * The separation above catches a gate that could not SPAWN pnpm at all
     * (no exit status). It does not catch pnpm spawning, refusing, and
     * exiting 1 without ever running the build — which is what happens when
     * the nested `pnpm` is a different version from the one `packageManager`
     * pins. Invoking handoff as `corepack pnpm handoff` puts corepack's shim
     * directory ahead on PATH, the nested `pnpm run build` resolves to a
     * DIFFERENT pnpm, and that pnpm refuses on the version guard.
     *
     * The gate then said "pnpm build failed: exit 1, and no TS diagnostic in
     * the output" about a tree that builds clean — the exact untrustworthy
     * reading this gate's own header warns about, one layer further in. A
     * check that could not RUN must never print like a failure of the thing
     * it checks (CLAUDE.md, and `walk-all`'s cannotRun for the same reason).
     *
     * Detected on the tool's OWN words rather than on the absence of a TS
     * diagnostic, because "no diagnostic" is also what a genuine non-type
     * build failure looks like.
     */
    const neverStarted = [
      /This project is configured to use [\d.]+ of pnpm/i,
      /Your current pnpm is v/i,
      /Unsupported engine/i,
      /ERR_PNPM_UNSUPPORTED_ENGINE/i,
      /command not found|is not recognized as an internal or external command/i,
    ].find((pattern) => pattern.test(out));

    if (neverStarted) {
      const words = out
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .find((l) => neverStarted.test(l));
      fail(
        "ship · build",
        `refused — the gate could not RUN pnpm build; the build never started, so this ` +
          `says NOTHING about the tree. The tool's own words: ${words}. ` +
          `If this is the corepack/pnpm version guard, run "pnpm handoff --ship" ` +
          `directly rather than through corepack.`,
      );
      return false;
    }

    // The diagnostic is the whole value here. Netlify's log is behind the
    // author's login, so a gate that only said "build failed" would move the
    // wall rather than remove it.
    const diagnostic =
      out
        .split("\n")
        .filter((l) => /error TS\d+|Failed to (compile|type check)/.test(l))
        .slice(0, 4)
        .join(" · ") || `exit ${error.status}, and no TS diagnostic in the output`;
    fail("ship · build", `refused — pnpm build failed: ${diagnostic}`);
    return false;
  }

  ok(
    "ship · build",
    `pnpm build clean in ${Math.round((Date.now() - started) / 1000)}s — the same command Netlify runs`,
  );
  return true;
}

/**
 * Push, open a PR, merge it.
 *
 * Runs only under `--ship`, and only from a clean tree — see the header. Each
 * step is skipped when it is already done, so running it twice is harmless.
 */
function ship() {
  if (dirty.length > 0) {
    fail("ship", "refused — commit first, a commit needs a message that says why");
    return;
  }
  if (tryRun("gh", ["--version"]) === null) {
    fail("ship", "refused — gh is not available");
    return;
  }
  if (!buildGate()) return;

  // R07's second gap: this used to refuse outright when a branch had no
  // upstream, so the first --ship of every session failed until someone ran
  // `git push -u` by hand. Having no upstream is the normal state of a branch
  // created this session, not an error — create it.
  if (!upstream) {
    if (tryRun("git", ["push", "-u", "origin", `HEAD:${branch}`]) === null) {
      fail("ship · push", `${branch} has no upstream and could not be pushed`);
      return;
    }
    upstream =
      tryRun("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]) ??
      `origin/${branch}`;
    ok("ship · push", `${branch} pushed, now tracking ${upstream}`);
  } else {
    const unpushed = Number(git("rev-list", "--count", `${upstream}..HEAD`));
    if (unpushed > 0) {
      if (tryRun("git", ["push", "origin", branch]) === null) {
        fail("ship", "push failed");
        return;
      }
      ok("ship · push", `${unpushed} commit(s) pushed`);
    } else {
      ok("ship · push", "nothing to push");
    }
  }

  const unmerged = Number(git("rev-list", "--count", "origin/main..HEAD"));
  if (unmerged === 0) {
    ok("ship · pr", "main already carries this branch");
    return;
  }

  // Reuse an open PR rather than opening a second one for the same branch.
  const existing = JSON.parse(
    tryRun("gh", ["pr", "list", "--head", branch, "--state", "open", "--json", "number"]) ||
      "[]",
  );

  let number = existing[0]?.number;

  if (!number) {
    const title = flag(
      "title",
      `Session handoff: ${unmerged} commit(s) from ${branch}`,
    );
    const bodyFile = flag("body-file");
    const args = ["pr", "create", "--base", "main", "--head", branch, "--title", title];
    if (bodyFile) args.push("--body-file", bodyFile);
    else args.push("--body", "Opened by `pnpm handoff --ship` at the end of a session.");

    const url = tryRun("gh", args);
    if (url === null) {
      fail("ship · pr", "could not open a PR");
      return;
    }
    number = url.trim().split("/").pop();
    ok("ship · pr", `opened #${number}`);
  } else {
    ok("ship · pr", `reusing open #${number}`);
  }

  // --merge to match this repo's existing history, which is merge commits.
  const merged = tryRun("gh", ["pr", "merge", String(number), "--merge"]);
  if (merged === null) {
    fail(
      "ship · merge",
      `#${number} did not merge — checks pending, or branch protection wants a review`,
    );
    return;
  }
  ok("ship · merge", `#${number} merged`);

  // Re-verify against the remote rather than trusting the merge reported
  // success. A PR merges from a snapshot and can leave later commits behind.
  tryRun("git", ["fetch", "origin", "--quiet"]);
  const left = Number(git("rev-list", "--count", "origin/main..HEAD"));
  if (left === 0) ok("ship · verify", "main carries everything on this branch");
  else fail("ship · verify", `${left} commit(s) still not in main after the merge`);
}

/**
 * Fast-forward local `main` to `origin/main`. R07, the headline gap.
 *
 * `gh pr merge` advances `main` on GitHub and leaves the session standing on the
 * feature branch. Nothing here ever moved the local ref, so it fell exactly one
 * session behind on every ship, and the next person to check `main` out found a
 * project with nothing in it. The recovery was always a plain fast-forward,
 * because local `main` had never held anything unique — which is precisely why
 * the script can do it.
 *
 * `git fetch origin main:main` moves the ref without touching the working tree
 * and **refuses anything that is not a fast-forward**, so a diverged `main` is
 * reported rather than flattened. Git rejects that form when `main` is the
 * branch you are standing on, so from `main` it is a `--ff-only` merge instead.
 */
function fastForwardMain() {
  if (!hasMain) return;

  const localMain = tryRun("git", ["rev-parse", "--verify", "main"]);

  if (localMain !== null) {
    const ahead = Number(git("rev-list", "--count", "origin/main..main"));
    if (ahead > 0) {
      // Never flatten this. Commits on local main that origin does not have are
      // either unpushed work or a mistake, and both need a person.
      warn(
        "ship · main",
        `local main has ${ahead} commit(s) origin/main does not — not fast-forwarded`,
      );
      return;
    }
    if (Number(git("rev-list", "--count", "main..origin/main")) === 0) {
      ok("ship · main", "local main already current");
      return;
    }
  }

  const moved =
    branch === "main"
      ? tryRun("git", ["merge", "--ff-only", "origin/main"])
      : tryRun("git", ["fetch", "origin", "main:main"]);

  if (moved === null) {
    fail("ship · main", `could not fast-forward local main — ${ffCommand()}`);
    return;
  }

  // Confirm against the ref rather than trusting the command reported success,
  // which is the same rule the merge verification above follows.
  const after = tryRun("git", ["rev-parse", "--verify", "main"]);
  if (after !== null && after === tryRun("git", ["rev-parse", "origin/main"])) {
    ok("ship · main", `local main fast-forwarded to ${after.slice(0, 7)}`);
  } else {
    fail("ship · main", "local main still does not match origin/main");
  }
}

/**
 * Did the deploy actually LAND? (2026-08-17, the author's ruling.)
 *
 * The R22 gate proves the tree BUILDS — it runs the same command Netlify runs,
 * before shipping. It cannot prove that what Netlify then served is this
 * commit. Those are different claims, and the gap between them is an hour of
 * production quietly serving the previous build, which is how R22 was born.
 *
 * `/api/build` closes it by reporting the commit the running deploy was built
 * from. Polling behaviour, which is what the g6 session did, only works when a
 * change alters observable behaviour; a doc-only or internal change has
 * nothing to poll, and this session's own work is mostly that shape.
 *
 * A TIMEOUT IS REPORTED AS A COULD-NOT-RUN, NEVER AS A FAILURE. Netlify's
 * build queue is not this script's to wait on, and an unreachable service is
 * not a missing feature — the same distinction `walk:all` draws. What it must
 * never do is report success without having seen the SHA.
 */
async function verifyDeployLanded(expectedSha) {
  const url = `${(process.env.SHOOT_BASE_URL ?? "https://sparkwtp.netlify.app").replace(/\/+$/, "")}/api/build`;
  const deadline = Date.now() + 5 * 60 * 1000;
  const short = expectedSha.slice(0, 7);
  let last = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: {
          "cache-control": "no-cache",
          // Declare ourselves (C05). This is a GET on a route that writes
          // nothing, but the rule is that automated traffic says so.
          "x-wtp-synthetic-run": `handoff-deploy-verify@${new Date().toISOString()}`,
        },
      });
      if (response.ok) {
        const body = await response.json();
        last = body.commit ?? "unknown";
        if (last === expectedSha) {
          ok("ship · deploy", `production is serving ${short} (/api/build)`);
          return;
        }
      }
    } catch {
      // Network flake or a deploy mid-swap; keep polling until the deadline.
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }

  warn(
    "ship · deploy",
    last === null
      ? `could not reach ${url} within 5 min — deploy NOT verified (could-not-run, not a failure)`
      : `production still serving ${String(last).slice(0, 7)}, expected ${short} after 5 min — deploy NOT verified`,
  );
}

if (SHIP) {
  ship();

  // Only worth asking once the merge and fast-forward actually succeeded —
  // otherwise the SHA we would be waiting for is not the one being deployed.
  if (!results.some((r) => r.level === "fail" && r.label.startsWith("ship"))) {
    const shipped = tryRun("git", ["rev-parse", "origin/main"]);
    if (shipped) await verifyDeployLanded(shipped);
  }

  // The branch, main and PR lines above were measured *before* shipping, so
  // once it succeeds they describe a state that no longer exists — and they
  // would fail the run despite everything having worked. Re-measure and
  // replace them rather than leaving a report that contradicts itself.
  if (!results.some((r) => r.level === "fail" && r.label.startsWith("ship"))) {
    const stale = new Set([
      "branch",
      "main",
      "main tree",
      "local main",
      "pull requests",
      "git state",
    ]);
    for (let i = results.length - 1; i >= 0; i--) {
      if (stale.has(results[i].label)) results.splice(i, 1);
    }

    tryRun("git", ["fetch", "origin", "--quiet"]);

    const unpushedNow = upstream
      ? Number(git("rev-list", "--count", `${upstream}..HEAD`))
      : 0;
    if (unpushedNow === 0) ok("branch", `${branch} matches ${upstream}`);
    else fail("branch", `${unpushedNow} commit(s) still not pushed`);

    const unmergedNow = Number(git("rev-list", "--count", "origin/main..HEAD"));
    if (unmergedNow === 0) ok("main", "carries everything on this branch");
    else fail("main", `${unmergedNow} commit(s) still not merged`);

    const openNow = JSON.parse(
      tryRun("gh", ["pr", "list", "--state", "open", "--json", "number,title"]) || "[]",
    );
    openPrs = openNow;
    if (openNow.length === 0) ok("pull requests", "none open");
    else
      warn(
        "pull requests",
        `${openNow.length} still open — ${openNow.map((p) => `#${p.number}`).join(", ")}`,
      );

    // The merge just moved origin/main, which is what leaves the local ref
    // behind. Fix it here, then re-measure, so the line below reports the state
    // the session actually ends in rather than the one it passed through.
    fastForwardMain();
    checkLocalMain();

    // git-state.txt was written before the push and merge, so it describes a
    // state that no longer exists — the same trap the re-measure above exists
    // to avoid. Rewrite it against the remote we just re-fetched.
    if (writeGitState()) ok("git state", "git-state.txt rewritten after shipping");

    // And context.md with it: it carries the same git facts plus tracker rows
    // that the merge commit may have moved. A stale seventh file is exactly
    // the drift the mirror exists to prevent.
    const staleContext = results.findIndex((r) => r.label === "context");
    if (staleContext !== -1) results.splice(staleContext, 1);
    await writeContextFile("rewritten after shipping");
  }
}

/* -------------------------------------------------------------- report --- */

const MARK = { ok: "  ok  ", warn: " warn ", fail: " FAIL " };

console.log(`\nhandoff — ${branch}\n`);
for (const r of results) {
  console.log(`${MARK[r.level]} ${r.label.padEnd(15)} ${r.detail}`);
}

const failed = results.filter((r) => r.level === "fail");
const warned = results.filter((r) => r.level === "warn");

console.log("");
if (failed.length === 0 && warned.length === 0) {
  console.log("All five surfaces agree. Safe to end the session.\n");
  process.exit(0);
}

if (failed.length > 0) {
  console.log(`${failed.length} item(s) need fixing before this session ends.`);
}
if (warned.length > 0) {
  console.log(`${warned.length} item(s) worth a look.`);
}
console.log("");

process.exit(failed.length > 0 ? 1 : 0);
