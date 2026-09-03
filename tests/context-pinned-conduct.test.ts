/**
 * **The Discovery conduct block is PINNED in `context.md`, and since RULING 106
 * nothing in that file is trimmed at all.**
 * (Pinned 2026-08-22, the author's Discovery Conduct brief, item 8. Cap removed
 * 2026-08-23, `NS09`, the author's ruling C extended: there are no caps
 * anywhere.)
 *
 * ## What changed, and why the tests below changed shape rather than count
 *
 * `context.md` was generated under a 40 KB cap and shrank to fit by dropping
 * tracker-change rows and clipping P0 notes. The pinned block was exempt from
 * that cascade, and these tests proved the exemption at a punishing cap —
 * which was the right proof for a file that could shrink.
 *
 * There is no cascade now. So the question moved: it is no longer *does the
 * exemption hold under pressure*, it is **does the file carry everything, and
 * is what it claims to carry VERBATIM actually verbatim**. A generated
 * orientation file with no size limit can creep toward reproducing `CLAUDE.md`
 * and leave two authorities that disagree; the answer is not a cap, it is that
 * every section says where it came from and any block claimed verbatim is
 * tested against its source.
 *
 * ## Why a pinned block at all, when everything else here is an index
 *
 * Every other section is headings, counts and pointers, on the principle that a
 * session needing the text reads the file. That is right, and it is exactly
 * wrong here: the failure RULING 88 exists to fix is a session **not knowing
 * there was anything to look up**. A pointer reads as *more rules about
 * hunting, consult if stuck*, which is how the three previous fixes were
 * absorbed and then not applied.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildContext, CAP_BYTES, CONTEXT_REPO_PATH, writeContext } from "../scripts/context-file.mjs";
import { currentLawText } from "../lib/governance/current-law.ts";

const ROOT = process.cwd();

const OPTIONS = {
  gitFacts: [],
  generatedAt: "test",
  stampToday: "2026-08-23",
};

test("context resolves frozen tracker holding pointers without rewriting the source", async () => {
  const trackerPath = join(ROOT, "docs/tracker.csv");
  const source = readFileSync(trackerPath);
  const plan = JSON.parse(readFileSync(join(ROOT, "data/state-holdings/move-plan.json"), "utf8"));
  const move = plan.rows.find((row: { newPath: string }) => row.newPath.endsWith("/az-pima-2026.json"));
  assert.ok(move, "the migrated ballot holding must be in the finite plan");
  assert.ok(source.toString().includes(move.oldPath), "the historical source must exercise relocation");
  const built = await buildContext(OPTIONS);
  assert.ok(built.text.includes(move.newPath), "the current context must point to the moved holding");
  assert.ok(!built.text.includes(move.oldPath), "the generated context may not restore the old pointer");
  assert.deepEqual(readFileSync(trackerPath), source, "the frozen source must remain byte-identical");
});

/**
 * The clauses the pinned block must carry, word for word.
 *
 * Every one is a heading or a sentence from `CLAUDE.md`'s own text, and each is
 * asserted against BOTH files — so this fails whether the law loses it or the
 * generator does, and a reader of the failure can tell which.
 */
const VERBATIM = [
  "RULING 88 — ",
  "RULING 89 — ",
  "RULING 94 — ",
  "RULING 95 — ",
  "RULING 96 — ",
  "RULING 97 — ",
  "RULING 98 — ",
  "RULING 99 — ",
  // The clause most likely to be lost, and the one the whole rule turns on.
  // Matched as a single line: the law wraps it mid-sentence.
  "The invention is the deliverable, not the yield.",
];

test("context.md carries the Discovery conduct block verbatim from CLAUDE.md", async () => {
  const built = await buildContext(OPTIONS);
  const law = currentLawText(ROOT);

  // The conduct rulings moved out of a CLAUDE.md section and into canonical
  // ledger records served through `docs/governance/policies/discovery.md`
  // (RULING 173). The pin follows the law; the discipline is unchanged, and
  // what is asserted is still that context.md quotes its source verbatim.
  assert.ok(
    built.text.includes("## DISCOVERY CONDUCT"),
    "context.md no longer carries the pinned conduct block",
  );

  for (const clause of VERBATIM) {
    assert.ok(law.includes(clause), `current law no longer contains ${JSON.stringify(clause)}`);
    assert.ok(built.text.includes(clause), `context.md dropped ${JSON.stringify(clause)}`);
  }
});

/* ========================================================================== */
/* RULING 106 — no generated document carries a size cap                      */
/* ========================================================================== */

test("RULING 106: there is no cap, and nothing is trimmed to meet one", async () => {
  assert.equal(
    CAP_BYTES,
    Infinity,
    "a byte cap is back on context.md. RULING 106: a cap forces silent trimming, " +
      "which is a partial that reconciles and reports success. Where a generated " +
      "file grows, remove duplication in the SOURCE — never clip the output.",
  );
  const built = await buildContext(OPTIONS);
  assert.equal(built.truncated, false, "the build reports something was trimmed");
  assert.deepEqual(built.truncation, [], "the build names something as trimmed");
  assert.doesNotMatch(
    built.text,
    /Truncated to fit/,
    "the generated file still announces a truncation it no longer performs",
  );
});

test("RULING 106: the shrink cascade is gone from the generator's source", async () => {
  /*
   * The behavioural test above passes on a small tracker even with a cascade
   * present, because a cascade that never fires looks like no cascade. This
   * reads the source: the loops that dropped rows and clipped notes must not
   * exist, so they cannot fire on a busy day nobody is watching.
   */
  const src = readFileSync(join(ROOT, "scripts", "context-file.mjs"), "utf8");
  assert.doesNotMatch(src, /while \(limit > 0 && Buffer\.byteLength/, "the row-dropping loop is back");
  assert.doesNotMatch(src, /while \(notes > 40 && Buffer\.byteLength/, "the note-clipping loop is back");
  assert.match(src, /export const CAP_BYTES = Infinity;/, "CAP_BYTES is no longer Infinity");
});

test("RULING 106: a stated size is REPORTED and never acted on", async () => {
  /*
   * A caller may still ask how big the file is against a number. What it must
   * not do is trim to meet it — so the same build, given a punishing figure,
   * returns identical TEXT and says it is over.
   */
  const uncapped = await buildContext(OPTIONS);
  const measured = await buildContext({ ...OPTIONS, cap: 16 * 1024 });
  assert.equal(
    measured.text,
    uncapped.text,
    "a stated size changed the OUTPUT — that is the cascade, wearing a parameter",
  );
  assert.equal(measured.truncated, false, "nothing was trimmed, so nothing may be reported as trimmed");
  assert.ok(
    measured.truncation.some((t: string) => t.includes("OVER THE STATED SIZE")),
    `being over a stated size must be said out loud; got ${JSON.stringify(measured.truncation)}`,
  );
  assert.ok(uncapped.bytes > 0);
});

test("RULING 106: the tracker-change section renders all ten rows", async () => {
  /*
   * The section the cap kept eating, restored. `readStatusChanges(10)` is the
   * WALK depth and is not a cap on the output — the ten it recovers are the ten
   * it prints. A run that recovers fewer than ten from a shallow history is
   * legitimate; a run that recovers ten and prints fewer is the defect.
   */
  const built = await buildContext(OPTIONS);
  const recovered = built.counts.statusChanges;
  assert.doesNotMatch(
    built.text,
    /recovered status change\(s\) are missing from this section/,
    "recovered status changes are missing from the section that should carry them",
  );
  if (recovered > 0) {
    assert.match(
      built.text,
      /\| Date \| ID \| From → To \| Commit \|/,
      "the tracker-change table is absent while changes were recovered",
    );
  }
});

test("RULING 106: P0 notes render at their full length", async () => {
  const src = readFileSync(join(ROOT, "scripts", "context-file.mjs"), "utf8");
  assert.match(
    src,
    /const NOTE_CHARS = 130;/,
    "the P0 note length moved — it is the author's number, and the cascade used to walk it down to 90",
  );
});

/* ========================================================================== */
/* The provenance discipline that replaces the cap                            */
/* ========================================================================== */

test("every section of context.md states where it came from", async () => {
  /*
   * Uncapped, a generated orientation file can creep toward reproducing
   * `CLAUDE.md` and leave two authorities that disagree. The cap was never
   * what prevented that; this is. Every `## ` section carries a `Source:` line
   * — or is one of the two that are self-evidently their own source, named
   * here rather than exempted silently.
   */
  const built = await buildContext(OPTIONS);
  const SELF_EVIDENT = new Set([
    // The file's own header block.
    "# we-the-people — current context",
  ]);
  const lines = built.text.split("\n");
  const missing: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^## /.test(lines[i])) continue;
    const heading = lines[i].trim();
    if (SELF_EVIDENT.has(heading)) continue;
    /*
     * Both directions. A provenance line may sit just ABOVE a heading — the
     * pinned block's does, deliberately, so a reader landing on the heading is
     * told whose words these are before reading them — or inside the section.
     * A forward-only window called that missing and was itself the defect.
     */
    const window = lines.slice(Math.max(0, i - 8), i + 14).join("\n");
    if (!/Source:|Verbatim from|read from|Generated by|from `/i.test(window)) {
      missing.push(heading);
    }
  }
  assert.deepEqual(
    missing,
    [],
    "these sections do not say where their content came from. Uncapped, this file " +
      "must be readable as a set of sourced extracts rather than as a second " +
      "authority competing with CLAUDE.md.",
  );
});

test("a block claimed VERBATIM is tested against its source, and divergence fails", () => {
  /*
   * **Proof that the guard bites, rather than a claim that it does.**
   *
   * The check above compares the generated file against `CLAUDE.md`. This
   * demonstrates the comparison FAILING when the two diverge: an altered
   * clause is not found in the law, exactly as an altered generated file would
   * not be found in it. Same comparison, run against a mutation, so the test
   * cannot pass by never having compared anything.
   */
  const law = currentLawText(ROOT);
  for (const clause of VERBATIM) {
    assert.ok(law.includes(clause), `sanity: ${JSON.stringify(clause)} is in the law`);
    // One character changed anywhere in the clause and the match is gone.
    const altered = clause.replace(/.$/, "~");
    assert.ok(
      !law.includes(altered),
      `the comparison does not distinguish ${JSON.stringify(clause)} from an altered copy`,
    );
  }
  // And the whole-block form: a paraphrase of the pinned heading fails.
  assert.ok(!law.includes("## DISCOVERY CONDUCT AND EXPANSION"));
});

/* ========================================================================== */
/* RULING 108 — anything a session must read at session start lives in the repo */
/* ========================================================================== */

test("RULING 108: the repo copy of context.md exists", () => {
  /*
   * The file every session is told to open first was written to the Drive
   * mirror ONLY. A session has a shell and a clone and no way into Drive, so
   * the orientation document was unreadable by every session that was told to
   * read it — and the work of uncapping it, restoring its tracker-change
   * section and restoring P0 notes to full length all landed where none of them
   * could see it.
   */
  const abs = join(ROOT, CONTEXT_REPO_PATH);
  assert.ok(existsSync(abs), `${CONTEXT_REPO_PATH} is absent — a session cannot read the mirror`);
  const bytes = readFileSync(abs, "utf8").length;
  assert.ok(bytes > 10_000, `${CONTEXT_REPO_PATH} is ${bytes} bytes — that is not the orientation file`);
});

test("RULING 108: the repo copy carries the pinned conduct block verbatim", () => {
  /*
   * The same provenance discipline the built text is already held to, applied
   * to the COMMITTED copy. A repo file that has drifted from CLAUDE.md is two
   * authorities that disagree about the law, which is the failure RULING 106
   * named when it removed the cap.
   */
  const committed = readFileSync(join(ROOT, CONTEXT_REPO_PATH), "utf8");
  const law = currentLawText(ROOT);
  const start = law.indexOf("## RULING 88");
  assert.ok(start > 0, "current law no longer carries the conduct rulings");
  // A handful of load-bearing sentences from the section, each of which must
  // survive the copy byte-for-byte.
  for (const line of [
    "**Every hunt report carries an EXPANSION section listing routes that did not",
    "**A hunt report with an empty expansion section FAILS THE ITEM**",
    "**A recorded absence with no stuck-protocol block is VOID and the field returns",
  ]) {
    assert.ok(law.includes(line), `CLAUDE.md no longer carries: ${line}`);
    assert.ok(committed.includes(line), `${CONTEXT_REPO_PATH} has drifted from CLAUDE.md at: ${line}`);
  }
});

test("RULING 108: the generator writes the repo copy first and never guards it", () => {
  /*
   * The behavioural test above passes on a stale committed file. This reads the
   * source: the repo write must be unguarded and must come BEFORE the mirror,
   * so an unreachable Drive cannot cost a session its orientation file.
   */
  const src = readFileSync(join(ROOT, "scripts", "context-file.mjs"), "utf8");
  const repoWrite = src.indexOf(`writeFileSync(join(repoRoot, CONTEXT_REPO_PATH)`);
  const mirrorWrite = src.indexOf(`writeFileSync(join(mirrorDir, "context.md")`);
  assert.ok(repoWrite > 0, "the generator no longer writes a repo copy");
  assert.ok(mirrorWrite > 0, "the generator no longer writes the mirror copy");
  assert.ok(repoWrite < mirrorWrite, "the mirror is written before the repo copy — the order is the ruling");

  const handoff = readFileSync(join(ROOT, "scripts", "handoff.mjs"), "utf8");
  assert.doesNotMatch(
    handoff,
    /if \(!existsSync\(MIRROR\)\) \{\s*warn\("context"[\s\S]{0,120}?return;/,
    "handoff returns early when the mirror is absent — that is the bug, and it wrote no file at all",
  );
});

test("RULING 108: an unreachable mirror does not stop the repo copy", async () => {
  /*
   * The exact condition a session runs under: no Drive. The repo write must
   * still happen and the mirror failure must be REPORTED rather than thrown.
   */
  /*
   * **The write is REDIRECTED, and that is `NH195`.** This test used to run
   * the real generator against the real repo root, so every `pnpm test`
   * overwrote `docs/context.md` with `generatedAt: "test"` and no git facts
   * — and the next session opened its orientation file on that. The proof is
   * unchanged in substance: the repo copy is still written, still first,
   * still unguarded. It is asserted at a temp root instead of at ours, and
   * the real file is compared before and after so a regression is caught
   * here rather than by a session reading fixture values as orientation.
   */
  const sandbox = mkdtempSync(join(tmpdir(), "wtp-context-"));
  mkdirSync(join(sandbox, "docs"), { recursive: true });
  const before = readFileSync(join(ROOT, CONTEXT_REPO_PATH), "utf8");
  try {
    const built = await writeContext(null, { ...OPTIONS, repoRoot: sandbox });
    assert.equal(built.repoPath, CONTEXT_REPO_PATH);
    assert.equal(built.mirrored, false, "no mirror was given, so none may be reported as written");
    assert.ok(existsSync(join(sandbox, CONTEXT_REPO_PATH)), "the repo copy was not written");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  assert.equal(
    readFileSync(join(ROOT, CONTEXT_REPO_PATH), "utf8"),
    before,
    "the suite overwrote the real docs/context.md — that is NH195 and it must never come back",
  );
});
