/**
 * **RULING 92 — fix the generator, never the artifact.**
 * (Adopted 2026-08-22, the author's ruling, NJ Hunt 6.)
 *
 * A generated artifact is never hand-corrected. The generator is fixed and the
 * artifact is regenerated. Hand-editing an output produces a file that **looks
 * fixed until it regenerates**, which is a silent class: nothing goes red, and
 * the defect returns on a schedule nobody is watching.
 *
 * ## The two instances this guard was built over
 *
 * 1. **The screenshot caption.** NJ Hunt 4 corrected it in `docs/state.md` — the
 *    generated file — and left the string in the script that writes it
 *    untouched. The script kept producing the wrong caption and the defect
 *    recurred one session later, in NJ Hunt 5.
 *
 * 2. **`data/hunt/nj-morris-municipal-sites.json`, which was worse.** Its
 *    generator had ALREADY been fixed; nobody had regenerated. The committed
 *    artifact pointed five municipalities at the wrong government's website —
 *    `morris_township` at Morris Plains', `chatham_township` at Chatham
 *    Borough's — and omitted six more. Every downstream hunt read it as current.
 *    Regenerating corrected all five and added the six.
 *
 * ## What this guard can and cannot see
 *
 * A generator that fetches from the network cannot be re-run inside a test: its
 * output legitimately changes when a government changes its website, and a test
 * that demanded byte-equality would fail on the world moving rather than on a
 * defect. So the guard is in two halves, and the first half is the one that
 * scales:
 *
 * - **Every generated artifact DECLARES its generator**, and is registered
 *   here. A file that says it is generated and names no command is a file
 *   nobody can regenerate — which is how a hand-edit becomes permanent.
 * - **Pure generators are re-run and diffed.** A generator whose inputs are all
 *   committed is deterministic, so its artifact must be byte-identical to what
 *   it produces right now.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

interface GeneratedArtifact {
  /** Repo-relative path of the committed output. */
  path: string;
  /** The command that writes it. A reader must be able to run this verbatim. */
  command: string;
  /**
   * True when every input is committed, so the output is reproducible and this
   * guard re-runs it. False for a generator that reads the network or a clock.
   */
  pure: boolean;
  /** Why it is not pure, when it is not. Stated rather than implied. */
  impurity?: string;
}

/**
 * **The register.** Adding a generator means adding a row here, in the same
 * commit — the same discipline `tests/guard-census.json` applies to guards.
 */
const GENERATED: GeneratedArtifact[] = [
  {
    path: "docs/branch-manifest.md",
    command: "corepack pnpm manifest:doc",
    pure: true,
  },
  {
    path: "lib/registry/rosters-nj-morris.ts",
    command: "corepack pnpm nj:wire",
    pure: true,
  },
  {
    path: "data/hunt/nj-morris-municipal-sites.json",
    command: "corepack pnpm nj:rosters --index",
    pure: false,
    impurity:
      "reads the county's Cities-and-Towns page over the network. THE ARTIFACT THIS " +
      "GUARD WAS BUILT OVER: it sat five municipalities deep in wrong governments while " +
      "its generator had already been fixed.",
  },
  {
    path: "data/hunt/muni-sites-nj-morris.json",
    command:
      "corepack pnpm muni:sites --wiki data/hunt/wikipedia-nj-morris.json " +
      "--state-directory data/hunt/tier-directories.json --county data/hunt/nj-morris-municipal-sites.json " +
      "--out data/hunt/muni-sites-nj-morris.json",
    pure: false,
    impurity: "control-checks every candidate URL live — a municipality's site may move or refuse",
  },
  {
    path: "data/hunt/roster-pages-muni-sites-nj-morris.json",
    command: "corepack pnpm roster:hunt --index data/hunt/muni-sites-nj-morris.json",
    pure: false,
    impurity: "walks each body's own site — the roster changes when the body changes",
  },
  {
    path: "data/hunt/tier-directories.json",
    command: "corepack pnpm tier:directory",
    pure: false,
    impurity: "walks USA.gov and the state directories live",
  },
  {
    path: "data/hunt/nj-morris-certified-winners.json",
    command: "corepack pnpm nj:winners",
    pure: false,
    impurity: "fetches the county clerk's certified PDFs; a new cycle adds a document",
  },
  {
    path: "data/hunt/wikipedia-nj-morris.json",
    command: "corepack pnpm wiki:muni --state NJ --county Morris --confirm",
    pure: false,
    impurity: "reads the encyclopedia and fetches every citation — both move",
  },
  {
    /*
     * FOUND BY THIS GUARD ON ITS FIRST RUN — it declared itself generated and
     * was in no register, which is precisely the state a hand-edit becomes
     * permanent in.
     */
    path: "lib/officials/directory-source.ts",
    command: "corepack pnpm congress:migrate",
    pure: false,
    impurity:
      "pins a SHA of the unitedstates/congress-legislators repository and stamps the date it " +
      "was read; re-running it legitimately moves both.",
  },
  {
    path: "docs/evidence/njhunt6-morris-rosters.jsonl",
    command: "corepack pnpm nj:wire",
    pure: false,
    impurity:
      "a retrieval ledger records the bytes a body sent on a DATE. Regenerating it from " +
      "today's artifacts is correct; demanding byte-equality with a past walk is not.",
  },
];

test("RULING 92: every registered generated artifact exists and names its generator", () => {
  for (const a of GENERATED) {
    assert.ok(existsSync(join(ROOT, a.path)), `${a.path} is registered as generated but is absent`);
    assert.ok(
      a.command.trim().length > 0,
      `${a.path} names no command — a file nobody can regenerate is a file a hand-edit becomes permanent in`,
    );
    if (!a.pure) {
      assert.ok(
        (a.impurity ?? "").length > 20,
        `${a.path} is marked impure with no reason. Why it cannot be re-run is the finding, not a shrug.`,
      );
    }
  }
});

test("RULING 92: a file declaring itself GENERATED is registered here", () => {
  /*
   * `git ls-files` rather than a directory walk: it is the tracked set, and it
   * does not skip a hidden path the way ripgrep does. `-z` keeps names with
   * spaces whole.
   */
  const tracked = execSync("git ls-files -z", { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter((f) => /\.(?:ts|mts|tsx|md|json|jsonl|csv)$/.test(f));

  const registered = new Set(GENERATED.map((a) => a.path));
  const declaring: string[] = [];
  for (const file of tracked) {
    if (registered.has(file)) continue;
    let head: string;
    try {
      head = readFileSync(join(ROOT, file), "utf8").slice(0, 1200);
    } catch {
      continue;
    }
    // The exact phrasing this project uses in a generated file's own header.
    if (/GENERATED by `?(?:corepack )?pnpm /.test(head)) declaring.push(file);
  }
  assert.deepEqual(
    declaring,
    [],
    "these files declare themselves generated and are not in the register above — " +
      "add them, so a hand-edit to one is visible as a diff against its generator",
  );
});

test("RULING 92: a PURE generator's artifact is byte-identical to what it produces now", () => {
  for (const a of GENERATED.filter((x) => x.pure)) {
    const full = join(ROOT, a.path);
    const committed = readFileSync(full, "utf8");
    try {
      execSync(a.command, { cwd: ROOT, stdio: "pipe", encoding: "utf8" });
      const regenerated = readFileSync(full, "utf8");
      assert.equal(
        regenerated,
        committed,
        `${a.path} differs from what \`${a.command}\` produces. ` +
          "RULING 92: fix the GENERATOR and regenerate — never hand-correct the artifact.",
      );
    } finally {
      // Never leave the tree changed by a test, whatever the outcome.
      writeFileSync(full, committed, "utf8");
    }
  }
});
