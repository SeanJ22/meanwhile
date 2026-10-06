import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CREDENTIAL_PATTERNS,
  EXCLUDED_PATHS,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  flatten,
  verifyIdMap,
} from "../scripts/mirror-code.mjs";
import { MIRRORED_DOCS, COPIED_DOCS, EXPECTED_DIRS } from "../scripts/mirror-set.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HANDOFF = readFileSync(join(ROOT, "scripts", "handoff.mjs"), "utf8");
const MIRROR_CODE = readFileSync(join(ROOT, "scripts", "mirror-code.mjs"), "utf8");

const allowlist = JSON.parse(readFileSync(join(ROOT, "docs", "mirror-code.json"), "utf8"));
const allowlistPaths: string[] = (allowlist.files ?? []).map((e: unknown) =>
  typeof e === "string" ? e : (e as { path: string }).path,
);

/**
 * The code mirror (R30), guarded — 2026-08-17.
 *
 * Source scans plus real unit checks on the pure functions. The copy itself is
 * not executed here: it writes to a Drive for Desktop folder that does not
 * exist on CI, and a test that mocks the filesystem would be testing the mock.
 * What can silently rot is the WIRING (someone moving the call out of the
 * always-run path) and the RULES (someone loosening an exclusion), and both are
 * reachable from here.
 */

/* ----------------------------------------------- 6b: the canonical ten --- */

test("the canonical mirror set lives in one place, and holds what was ruled into it", () => {
  // Ten on 2026-08-17; twelve later the same day, when the deferred census
  // (R31) was added; thirteen with the xlsx split; fourteen when the session
  // map joined (R33), placed in docs/ by hand after a session reported
  // committing a file it never committed. Growth by decision is fine — the failure this guards is the set
  // living in two places and the two disagreeing, which is what produced two
  // contradictory reports.
  // Nineteen since 2026-08-20 (Prompt E): the tracker stopped being one CSV
  // and became a workbook plus three generated views, and all four are things
  // the author opens.
  // TWENTY-THREE since 2026-08-24: the candidate questionnaire and its
  // invitation, so they can be read anywhere before anything sends, the
  // transparency draft for the same reason, and the portrait review sheet,
  // which is how photographs are reviewed from Drive.
  // TWENTY-FOUR since 2026-08-25, and it was a decision: `coverage-matrix.csv`,
  // written by `pnpm matrix` under RULING 149. It is one row per candidate and
  // one column per fact, which is a SPREADSHEET question — a thing to open in a
  // spreadsheet rather than in a terminal. It is INTERNAL and never rendered to
  // a reader; the mirror is the author's own folder rather than a reader
  // surface, and that distinction is the whole of why it belongs here and is
  // forbidden in `app/`.
  // TWENTY-FIVE since 2026-08-26, and it was a decision: `docs/rulings.md`, the
  // append-only record every brief orders sessions to read and hardcode from,
  // and the one such file that was unreachable from outside the repo. RULING
  // 108's failure aimed at a different file.
  // TWENTY-SIX since 2026-08-30, and it was a decision (Session A, Work Item
  // 7): `repo-inventory.md`, the generated repo census written by
  // `pnpm repo-map` — the reviewer reads a derived inventory from the folder
  // rather than a reconstruction from reports, and it has a repo counterpart
  // so it is drift-checkable like coverage-matrix.csv.
  // TWENTY-FIVE since 2026-10-05, and it was a decision: the approved plan's
  // CH-21 retired the gap ledger, `docs/gap-ledger.md` with it.
  assert.equal(MIRRORED_DOCS.length, 25, "the canonical set changed size — was that a decision?");

  const names = MIRRORED_DOCS.map((d) => d.mirrorName);
  for (const expected of [
    "CLAUDE.md",
    "abuse-policy.md",
    "vendor-review.md",
    "source-ladder.md",
    "defects.md",
    "state.md",
    "tracker.csv",
    "types.ts",
    "git-state.txt",
    "context.md",
    "deferred.md",
    "deferred.csv",
    "deferred.xlsx",
    "session-map.md",
    "audit-2026-08-18.md",
    "tracker.xlsx",
    "tracker.md",
    "log.md",
  ]) {
    assert.ok(names.includes(expected), `${expected} left the canonical set`);
  }

  // Dropped by the same ruling: it is not in the folder and has not been.
  assert.ok(
    !names.includes("civic-app-brief.md"),
    "civic-app-brief.md is back on the standing list — the ruling dropped it",
  );

  // Twelve copied, two generated. The generated pair have no repo counterpart,
  // which is why they cannot be drift-checked and must not be counted as if
  // they could. (Eleven until session-map.md joined on 2026-08-17, R33.)
  // Twenty-one copied since 2026-08-24: the four added then all have repo
  // counterparts, so all four are drift-checkable, which is the point of
  // putting them in the canonical set rather than declaring them extras.
  // Twenty-two copied since 2026-08-25: coverage-matrix.csv has a repo
  // counterpart, so it is drift-checkable like the rest — which is the point of
  // putting a generated artifact in the canonical set rather than declaring it
  // an extra.
  // Twenty-three copied since 2026-08-26: docs/rulings.md has a repo counterpart
  // like the rest. It is the file every brief orders sessions to read, and the
  // only such file that could not be read from outside the repo (RULING 108).
  // Twenty-four copied since 2026-08-30: docs/repo-inventory.md has a repo
  // counterpart like the rest — a generated artifact in the canonical set is
  // drift-checkable, which is why it is here and not a declared extra.
  // Twenty-three since 2026-10-05: CH-21 (the approved plan) retired docs/gap-ledger.md with the ledger script.
  assert.equal(COPIED_DOCS.length, 23);
  assert.equal(MIRRORED_DOCS.filter((d) => d.repoPath === null).length, 2);
});

test("handoff reads the canonical set rather than keeping its own copy", () => {
  assert.match(
    HANDOFF,
    /from "\.\/mirror-set\.mjs"/,
    "handoff no longer imports the shared set — the two lists can disagree again",
  );
  assert.ok(
    !/const MIRRORED = \[\s*\[/.test(HANDOFF),
    "handoff has re-grown a local literal mirror list",
  );
  assert.match(
    HANDOFF,
    /checkMirrorContents/,
    "the folder's actual contents are no longer checked against the ten",
  );
  // The ruling: a difference is a loud failure, never a silent reconciliation.
  const at = HANDOFF.indexOf("mirror set");
  assert.ok(at > 0);
  assert.match(
    HANDOFF.slice(at, at + 1400),
    /fail\("mirror set"/,
    "a mirror-set difference must FAIL, not warn",
  );
});

test("every mirror size is reported, and an absent file is not a zero", () => {
  assert.match(HANDOFF, /ok\("mirror sizes"/, "the mirror sizes are no longer reported");

  // The set's SIZE is read from the set, never restated as a literal. It
  // shipped as a hardcoded "10" for one run and printed "the canonical 10
  // present" on a run that listed twelve — the same defect as the context
  // generator saying "of 20 KB" after its cap had been raised to 40.
  assert.match(
    HANDOFF,
    /the canonical \$\{MIRRORED_DOCS\.length\} present/,
    "the mirror-set count is a hardcoded literal again — it goes stale the next time the set changes",
  );
  const at = HANDOFF.indexOf('ok("mirror sizes"');
  assert.match(
    HANDOFF.slice(at - 400, at + 200),
    /"absent"/,
    "an unreachable mirror file must print as absent — a zero is a size, absence is not",
  );
});

/* --------------------------------------------------- 6: wired everywhere --- */

test("the code mirror runs on every handoff path, not only --ship", () => {
  assert.match(HANDOFF, /mirrorCode\(/, "handoff no longer calls the code mirror");

  const call = HANDOFF.indexOf("mirrorCode({");
  const shipFn = HANDOFF.indexOf("function ship()");
  assert.ok(call > 0, "the mirrorCode call is gone");
  assert.ok(
    call < shipFn,
    "the code mirror moved inside/after ship() — it would never run on a plain handoff",
  );

  // It must not be nested under a SHIP guard.
  const before = HANDOFF.slice(0, call);
  const lastShipGuard = before.lastIndexOf("if (SHIP)");
  assert.ok(
    lastShipGuard === -1 || lastShipGuard < before.lastIndexOf("/* ---"),
    "the code mirror sits under an `if (SHIP)` guard",
  );

  assert.match(HANDOFF, /--no-code/, "the --no-code flag is gone");
});

test("every refusal is named individually, never only counted", () => {
  assert.match(
    HANDOFF,
    /warn\("code · refused", `\$\{row\.repoPath\}/,
    "refusals are no longer named one by one — a count alone hides which file left the reviewer's reach",
  );
  assert.match(
    HANDOFF,
    /warn\("code · removed"/,
    "removals are no longer named",
  );
});

/* ------------------------------------------------------ 3: the exclusions --- */

test("the hard exclusions refuse what they must", () => {
  const refuses = (p: string) => EXCLUDED_PATHS.some((x) => x.re.test(p));

  for (const p of [
    ".env",
    ".env.local",
    ".env.production",
    "certs/server.pem",
    "certs/server.key",
    "lib/credentials.ts",
    "lib/my-secret-thing.ts",
    "node_modules/foo/index.js",
    ".next/static/x.js",
    "out/index.html",
    "build/app.js",
    "coverage/lcov.info",
    ".mirror/code/x.ts",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
  ]) {
    assert.ok(refuses(p), `${p} is no longer excluded by path`);
  }

  // And does not refuse the ordinary source it exists to let through.
  for (const p of allowlistPaths) {
    assert.ok(!refuses(p), `${p} is on the allowlist but excluded by path`);
  }
});

/**
 * Credential-shaped fixtures are ASSEMBLED at runtime, never written down.
 *
 * These strings are fakes — they exist so the scan below can be proven to
 * catch the real thing. But a secret scanner cannot tell a planted fixture
 * from a leak, and it is right not to try. Netlify's scan refused
 * `main@a8f7ff2` over the two GitHub-token shapes that used to sit as
 * literals in this file, and production served the previous build until it
 * was fixed. Masking the scanner would have been the cheap answer and the
 * wrong one; the fix belongs on our side.
 *
 * So: no source file in this repo contains a literal credential shape.
 * `cred()` joins fragments — none of which is credential-shaped on its own —
 * and the matcher receives byte-for-byte the string it always did. That the
 * string is still the right string is proven by `tripped()` below, which
 * asserts each fixture trips the NAMED pattern it was written to exercise,
 * rather than merely tripping something.
 */
const cred = (...parts: string[]) => parts.join("");

test("the credential scan catches keys and connection strings", () => {
  const hits = (s: string) => CREDENTIAL_PATTERNS.some((p) => p.re.test(s));
  /** The names of every pattern `s` trips — a fixture must trip its own. */
  const tripped = (s: string) =>
    CREDENTIAL_PATTERNS.filter((p) => p.re.test(s)).map((p) => p.name);

  assert.ok(hits("ANTHROPIC_API_KEY"));
  assert.ok(hits("LEGISCAN_API_KEY"));
  assert.ok(hits("DATABASE_URL = 'x'"));
  assert.ok(hits("aws_secret_access_key"));

  // Every value-shaped fixture, with the pattern it exists to exercise. The
  // pairing is the point: a fragment typo that quietly stopped producing a
  // token shape would still `hit` something (the assembled text can trip a
  // looser pattern), and this catches that where a bare `hits` would not.
  for (const [fixture, pattern] of [
    [cred("DATABASE_URL=postgres", "://x"), "DATABASE_URL assignment"],
    [cred("sk", "-ant-", "api03-abcdefghijklmnop"), "Anthropic-style key"],
    [cred("ghp", "_abcdefghijklmnopqrstuvwxyz01"), "GitHub token (ghp_)"],
    [cred("github", "_pat_", "11ABCDEFG0abcdefghijklm"), "GitHub token (github_pat_)"],
    [cred("AKIA", "IOSFODNN7EXAMPLE"), "AWS access key id"],
    [cred("ASIA", "IOSFODNN7EXAMPLE"), "AWS access key id"],
    // The connection-string family — the reason this rule exists. `.env.local`
    // in this repo holds the PRODUCTION Neon string.
    [cred("postgres", "://user:pw@host/db"), "Postgres connection string"],
    [cred("postgresql", "://user:pw@host/db"), "Postgres connection string"],
    [cred("ep-cool-name-123456", ".us-east-2.aws.neon.tech"), "Neon host"],
  ] as const) {
    assert.ok(
      tripped(fixture).includes(pattern),
      `the fixture for ${pattern} no longer trips it — it trips [${tripped(fixture).join(", ")}]`,
    );
  }

  // And the measured false positive: a bare `sk-` matches `.ask-pill` in
  // app/globals.css six times and `ask-box` in docs/DESIGN.md. Unanchored, the
  // scan would have refused two of the twelve seeded files over CSS class
  // names — a refusal is loud, so this would have been visible, but it would
  // also have been wrong.
  assert.ok(!hits(".ask-pill { color: red }"), "`sk-` is unanchored again");
  assert.ok(!hits("components/ask/ask-box.tsx"), "`sk-` is unanchored again");
  assert.ok(!hits("the ask-answer drawer"), "`sk-` is unanchored again");
});

test("no allowlisted file trips the credential scan today", () => {
  for (const p of allowlistPaths) {
    const text = readFileSync(join(ROOT, p), "utf8");
    const hit = CREDENTIAL_PATTERNS.find((c) => c.re.test(text));
    assert.equal(
      hit?.name,
      undefined,
      `${p} matches the credential pattern ${hit?.name} — it would be refused`,
    );
  }
});

test("the size caps are the stated ones and today's allowlist fits", () => {
  // Raised from 120 KB on 2026-08-17: app/globals.css sat 2,756 bytes under
  // the old ceiling, so the tokens file was one edit from being refused.
  //
  // Raised again to 256 KB on 2026-08-25 (RO06), for the SAME file for the
  // SAME reason — it stood at 203,556 bytes with 1,244 to spare before that
  // session wrote a line. The measurement that matters is in the script: 57%
  // of that file is comment prose. A THIRD raise is the wrong answer
  // (RULING 106); the structural fix is RO06.
  //
  // **AND IT CAME BACK DOWN, the same day** (`NH180`). The structural option
  // was taken: the prose was stripped into
  // `docs/globals-css-notes.md` — 125 comment blocks moved VERBATIM, each
  // leaving a one-line pointer at its rule — and `app/globals.css` went from
  // 206,120 bytes to 134,880 with the CSS itself byte-identical (82,089 bytes
  // of code before and after, comments stripped from both sides).
  //
  // So 200 KB is the value again, with roughly 65 KB of headroom under it
  // rather than 1,244 bytes. **The assertion is what makes the reversal real**:
  // without it a later session raises the number back and nothing objects.
  assert.equal(MAX_FILE_BYTES, 200 * 1024);
  assert.equal(MAX_TOTAL_BYTES, 1.5 * 1024 * 1024);

  let total = 0;
  for (const p of allowlistPaths) {
    const bytes = readFileSync(join(ROOT, p)).byteLength;
    assert.ok(
      bytes <= MAX_FILE_BYTES,
      `${p} is ${bytes} bytes, over the ${MAX_FILE_BYTES} per-file cap — it would be refused`,
    );
    total += bytes;
  }
  assert.ok(total <= MAX_TOTAL_BYTES, `the allowlist totals ${total} bytes, over the cap`);
});

/* -------------------------------------------- 2: no duplicate of the docs --- */

test("the allowlist may not duplicate anything the document mirror carries", () => {
  const docPaths = new Set(COPIED_DOCS.map((d) => d.repoPath));
  for (const p of allowlistPaths) {
    assert.ok(
      !docPaths.has(p),
      `${p} is already mirrored as a document — two copies under two Drive IDs diverge`,
    );
  }

  // Enforced in code, not by convention: the refusal must exist in the script.
  assert.match(
    MIRROR_CODE,
    /MIRRORED_DOC_REPO_PATHS\.has\(repoPath\)/,
    "the duplicate refusal is gone from mirror-code.mjs",
  );
  assert.match(
    MIRROR_CODE,
    /MIRRORED_DOC_NAMES\.has\(row\.mirrorName\)/,
    "the mirror-name collision refusal is gone",
  );
});

test("the allowlist stays small and every entry exists", () => {
  assert.ok(allowlistPaths.length <= 15, `${allowlistPaths.length} files — the brief caps it near 15`);
  assert.ok(allowlistPaths.length > 0);
  for (const p of allowlistPaths) {
    assert.doesNotThrow(() => readFileSync(join(ROOT, p)), `${p} does not exist`);
  }
});

/* ---------------------------------------------------- 5: id map safety --- */

test("flatten encodes the path so two basenames cannot collide", () => {
  assert.equal(flatten("components/map/map-canvas.tsx"), "components__map__map-canvas.tsx");
  assert.equal(flatten("lib/meetings/snapshot.ts"), "lib__meetings__snapshot.ts");
  assert.notEqual(flatten("lib/meetings/snapshot.ts"), flatten("tests/snapshot.ts"));
});

test("an id resolving to a different file is a hard stop, not a warning", () => {
  const recorded = {
    "components/map/map-canvas.tsx": {
      id: "ID_A",
      title: "components__map__map-canvas.tsx",
    },
  };

  const good = verifyIdMap(recorded, { ID_A: "components__map__map-canvas.tsx" });
  assert.equal(good.safe, true);
  assert.equal(good.ok.length, 1);
  assert.equal(good.mismatch.length, 0);

  // The exact shape the brief reported: a recorded id now resolving to
  // git-state.txt. It must be unsafe, and must name both titles.
  const swapped = verifyIdMap(recorded, { ID_A: "git-state.txt" });
  assert.equal(swapped.safe, false, "a mismatched id no longer stops the run");
  assert.equal(swapped.mismatch[0].expected, "components__map__map-canvas.tsx");
  assert.equal(swapped.mismatch[0].actual, "git-state.txt");

  // Gone is NOT mismatch: a removed file is recoverable by re-recording, and
  // collapsing the two would turn an ordinary re-learn into a hard stop.
  const gone = verifyIdMap(recorded, { ID_B: "something-else" });
  assert.equal(gone.safe, true);
  assert.equal(gone.gone.length, 1);
  assert.equal(gone.mismatch.length, 0);
});

test("the copy addresses files by path, never by drive id", () => {
  // The structural reason a mis-addressed write cannot happen here. If a future
  // change starts writing by id, this fails and the hard stop has to move.
  assert.match(MIRROR_CODE, /copyFileSync\(join\(root, row\.repoPath\), join\(codeDir, row\.mirrorName\)\)/);
  assert.ok(
    !/copyFileSync\([^)]*driveId/.test(MIRROR_CODE),
    "the copy now takes a Drive id — the hard stop must move onto the write",
  );
});

test("the id map records the folder and the verification date", () => {
  const map = JSON.parse(readFileSync(join(ROOT, "docs", "mirror-code-ids.json"), "utf8"));
  assert.ok(map.folderId, "the folder id is gone");
  assert.match(
    map.verifiedAgainstLiveDriveOn,
    /^\d{4}-\d{2}-\d{2}$/,
    "the verification date must be a real stamp",
  );
  // Every document is ACCOUNTED FOR — either it carries a Drive id, or it is
  // declared pending and says why. The COUNT is read from the canonical set
  // rather than restated: this assertion held a literal 10 and broke the moment
  // the set grew to 13, which is the same defect the handoff's "the canonical
  // 10 present" line had, in a test this time.
  //
  // `pendingDocs` exists because a Drive id cannot be invented. A document
  // added to the set has no id until it has been copied to Drive AND
  // `pnpm mirror:ids` has run against the live folder, which is exactly the
  // "not yet recorded, never no such file" rule this file's own codeNote
  // states for the code mirror. Declaring it keeps the gap loud: the id map
  // must still cover the WHOLE set, and an undeclared missing id still fails.
  const ids = Object.values(map.docs) as string[];
  const pending: string[] = map.pendingDocs ?? [];
  assert.equal(
    ids.length + pending.length,
    MIRRORED_DOCS.length,
    `the document id map accounts for ${ids.length} recorded + ${pending.length} pending of ` +
      `${MIRRORED_DOCS.length} mirrored document(s)`,
  );
  assert.equal(
    new Set(ids).size,
    ids.length,
    "two documents share a Drive id — a join that collapsed",
  );

  // And every one is keyed by a name the set actually holds — pending included,
  // so a pending entry cannot be used to park a name that left the set.
  const names = new Set(MIRRORED_DOCS.map((d) => d.mirrorName));
  const strays = [...Object.keys(map.docs), ...pending].filter((n) => !names.has(n));
  assert.deepEqual(strays, [], `id map holds name(s) not in the mirror set: ${strays.join(", ")}`);

  // A name cannot be both recorded and pending — that is how a stale pending
  // entry survives its own resolution and stops meaning anything.
  const both = pending.filter((n) => n in map.docs);
  assert.deepEqual(both, [], `declared pending while already recorded: ${both.join(", ")}`);
});

/* --------------------------------------------------------- 4: manifest --- */

test("the manifest heads with what it is, and never hides a refusal", () => {
  assert.match(
    MIRROR_CODE,
    /READ-ONLY COPIES of repository files/,
    "the manifest's head sentence is gone — the reviewer would read copies as truth",
  );
  assert.match(MIRROR_CODE, /only source of truth/);
  assert.match(MIRROR_CODE, /stale whenever this manifest's/);

  // A skipped file appears WITH its reason rather than vanishing.
  assert.match(MIRROR_CODE, /## Refused/);
  assert.match(MIRROR_CODE, /r\.reason/);
  // An unrecorded id is named as unrecorded, never rendered as absence.
  assert.match(MIRROR_CODE, /_not yet recorded_/);
});

test("the expected mirror subdirectories are declared", () => {
  /*
   * `owner-intake` joined on 2026-08-30 (A.1 WI8): the
   * folder the owner writes defects into, replacing `defects.md` as an owner
   * surface. It is a DIRECTORY, so it is declared here rather than in the
   * mirrored-document set — the same reasoning that put `transcripts/` and
   * `code/` in this list.
   */
  assert.deepEqual(EXPECTED_DIRS, ["transcripts", "code", "owner-intake"]);
});
