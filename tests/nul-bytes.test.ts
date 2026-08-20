import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * F01-continued session 2, item 0A (2026-08-19) — a source file that ripgrep
 * cannot see.
 *
 * A `.ts`/`.tsx` file containing a **literal NUL character** — a `\u0000`
 * separator written as the raw byte rather than the escape — is classified as
 * BINARY by ripgrep and by `git grep` without `-a`. The file is then SKIPPED,
 * silently. Every class sweep this repo has ever run used that instrument, so
 * every one of them reported "nothing else found" about a corpus it had not
 * finished reading.
 *
 * That is the exact failure this codebase's method cannot tolerate: a sweep
 * that could not look and a sweep that found nothing produce the same output,
 * and only one of them is a finding. Same family as the
 * operation-that-can-do-nothing rule in CLAUDE.md.
 *
 * Three files carried it. `components/ballot/pick-control.tsx` (2 bytes) was
 * found and fixed by session 1. `lib/meetings/list-attribution.ts` (1) and
 * `lib/signal/aggregate.ts` (3) were found by session 2's repo-wide byte scan
 * — which is to say session 1's own sweep of the class missed two thirds of
 * it, because it was run with the skipping tool.
 *
 * The fix in every case is the ESCAPE, `\u0000`, which produces a
 * byte-identical string at runtime and a file every tool can read.
 */

const ROOT = join(import.meta.dirname, "..");

/**
 * Every tracked or newly-written file whose bytes are meant to be TEXT.
 *
 * `--others --exclude-standard` alongside `--cached` for the same reason
 * `tests/mojibake.test.ts` does it: an uncommitted file is exactly when this
 * check earns its keep, and plain `git ls-files` cannot see one.
 *
 * The extension filter is what makes this a check about SOURCE rather than
 * about binaries. 942 of the repo's tracked files contain NUL bytes and
 * every one of them is a PNG, a JPEG, an `.ico` or an `.xlsx` — files whose
 * whole point is to be bytes. Flagging those would be a check nobody could
 * leave switched on.
 */
function textFiles(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64e6 },
  )
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) =>
      /\.(ts|tsx|js|jsx|mjs|mts|cjs|cts|json|md|css|scss|html|yml|yaml|csv|txt|sql|sh|ps1|toml)$/i.test(
        f,
      ),
    );
}

test("0A: no tracked source file contains a literal NUL byte", () => {
  const files = textFiles();

  // The denominator, stated. A scan whose corpus quietly emptied would pass
  // forever, and this test exists precisely because a silent skip is the
  // defect.
  assert.ok(
    files.length > 700,
    `only ${files.length} source-class files matched — the scan lost its corpus`,
  );

  const offenders: string[] = [];
  for (const file of files) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(ROOT, file));
    } catch {
      continue;
    }
    const count = bytes.filter((b) => b === 0).length;
    if (count > 0) {
      const at = bytes.indexOf(0);
      const line = bytes.subarray(0, at).toString("utf8").split("\n").length;
      offenders.push(
        `${file}: ${count} NUL byte(s), first at line ${line} — ` +
          `write the separator as the escape \\u0000, not the raw character`,
      );
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "a literal NUL byte makes ripgrep and `git grep` skip the file SILENTLY, " +
      "so every class sweep of this repo would miss it:\n" +
      offenders.join("\n"),
  );
});

/**
 * The detector must actually detect. Built from a codepoint, never typed as a
 * literal — a test that spelled the defect out would be a permanent offender
 * in the corpus the scan above reads. Same discipline as the mojibake test.
 */
test("0A: the byte check catches the shape it is guarding against", () => {
  const NUL = String.fromCharCode(0);
  const planted = Buffer.from(`const key = \`\${a}${NUL}\${b}\`;`, "utf8");
  assert.equal(planted.filter((b) => b === 0).length, 1);

  const clean = Buffer.from("const key = `${a}\\u0000${b}`;", "utf8");
  assert.equal(
    clean.filter((b) => b === 0).length,
    0,
    "the escape form must produce no NUL byte in the file",
  );

  // …and the escape must still produce the SAME string at runtime, which is
  // why this fix is behaviour-preserving rather than a change of separator.
  assert.equal("\u0000", NUL);
});
