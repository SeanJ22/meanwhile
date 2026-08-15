import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  findMojibake,
  hasMojibake,
  repairMojibake,
} from "../lib/text/mojibake.ts";

/**
 * M60 (2026-08-15) — no reader ever sees a decoding accident.
 *
 * The author's production report: every candidate blurb's attribution line
 * read `From the candidate's site` followed by U+00E2 U+20AC U+201D and then
 * the domain. One em-dash
 * (U+2014, `E2 80 94`) read back as cp1252 and re-encoded. One operation in
 * the 2026-08-14 photo session round-tripped the whole cards file through
 * such a decode — 28 existing em-dashes and 130 new ones, 158 in all, plus 34
 * inherited by the generated photo report, which is built from that file.
 *
 * The corruption is invisible in a diff review and survives every test that
 * only asks whether a string is non-empty. So it gets a check that walks the
 * committed text itself, over every tracked file a reader's words can come
 * from. This is the fix at the source: the data was repaired once, and this
 * is what stops the next ad-hoc shell round trip from putting it back.
 */

const ROOT = join(import.meta.dirname, "..");

/** Every tracked file whose contents can reach a reader as words. */
function readerFacingFiles(): string[] {
  // `--others --exclude-standard` alongside `--cached`: a file that is not
  // committed yet is exactly when this check is most useful, and plain
  // `git ls-files` cannot see one. (It could not see this test file either,
  // which is how three files documenting the defect went unnoticed until
  // the commit that tracked them.)
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64e6 },
  )
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx|json|md|css|mts|mjs|csv)$/.test(f))
    // Boundary geometry is machine data with no prose, and it is enormous.
    .filter((f) => !f.startsWith("public/geo/") && !f.includes("pnpm-lock"));
}

test("M60: no reader-facing string carries a mojibake signature", () => {
  const files = readerFacingFiles();
  // The denominator, stated: a check that silently scanned nothing would
  // pass forever.
  assert.ok(
    files.length > 300,
    `only ${files.length} tracked files matched — the scan lost its corpus`,
  );

  const offenders: string[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    const hits = findMojibake(text);
    if (hits.length > 0) {
      offenders.push(
        `${file}: ${hits.length} — first at ${hits[0].at}: …${hits[0].context}…`,
      );
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `mojibake in committed text:\n${offenders.join("\n")}`,
  );
});

/**
 * The corrupt sequences are BUILT FROM CODEPOINTS here, never typed as
 * literals.
 *
 * Not fussiness: the repo-wide scan above reads every tracked and untracked
 * source file, and a test that spelled the defect out would be a permanent
 * offender in the corpus it is guarding. Writing the bytes explicitly also
 * says exactly which bytes are meant, which a literal in an editor cannot.
 */
const cp = (...codes: number[]) => String.fromCodePoint(...codes);
/** U+00E2 U+20AC U+201D - an em-dash's E2 80 94 read as cp1252. */
const BROKEN_EM_DASH = cp(0x00e2, 0x20ac, 0x201d);
/** U+00C3 U+00A9 - an e-acute's C3 A9 read the same way. */
const BROKEN_E_ACUTE = cp(0x00c3, 0x00a9);
/** U+00E2 U+20AC U+2122 - a right single quote's E2 80 99. */
const BROKEN_APOSTROPHE = cp(0x00e2, 0x20ac, 0x2122);

test("M60: the detector actually detects the production sequence", () => {
  const broken = `From the candidate's site ${BROKEN_EM_DASH} cindewarmington.com`;
  assert.ok(hasMojibake(broken), "the detector missed the reported defect");
  assert.equal(findMojibake(broken).length, 1);

  assert.equal(
    repairMojibake(broken),
    "From the candidate's site \u2014 cindewarmington.com",
  );

  // The other shapes of the same accident.
  assert.ok(hasMojibake(`Andr${BROKEN_E_ACUTE}s Cano`), "the e-acute shape not detected");
  assert.ok(hasMojibake(`don${BROKEN_APOSTROPHE}t`), "the right-quote shape not detected");
  assert.equal(repairMojibake(`Andr${BROKEN_E_ACUTE}s Cano`), "Andr\u00e9s Cano");
  assert.equal(repairMojibake(`don${BROKEN_APOSTROPHE}t`), "don\u2019t");
});

test("M60: the detector leaves legitimate non-ASCII alone", () => {
  // This repo is full of real accented names, arrows and dashes. A check
  // that flags them is a check that gets switched off.
  for (const clean of [
    "Andrés Cano",
    "Alma Hernández",
    "Adelita S. Grijalva",
    "From the candidate's site — cindewarmington.com",
    "2 mi → 5 mi",
    "Muñoz",
    "Noël Anderson",
    "1,024 × 1,024",
  ]) {
    assert.equal(hasMojibake(clean), false, `false positive on "${clean}"`);
    assert.equal(repairMojibake(clean), clean, `mangled clean text "${clean}"`);
  }
});

/**
 * The repair may never invent or lose a character. It is per-sequence for
 * exactly this reason: the whole-string inverse silently turned the 32
 * em-dashes that had been written CORRECTLY into U+FFFD while reporting
 * success — the operation-that-can-do-nothing shape, wearing a repair's hat.
 */
test("M60: repairing mixed text keeps the characters that were already right", () => {
  const mixed = `good \u2014 dash, bad ${BROKEN_EM_DASH} dash, good \u2014 again`;
  const fixed = repairMojibake(mixed);
  assert.equal(fixed, "good \u2014 dash, bad \u2014 dash, good \u2014 again");
  assert.equal((fixed.match(/—/g) ?? []).length, 3);
  assert.ok(!fixed.includes("�"), "the repair produced a replacement char");
});

/**
 * The specific surface the author was looking at: the attribution line under
 * a candidate blurb. Checked against the real committed cards file, so this
 * fails if the data regresses even when the generic scan is somehow skipped.
 */
test("M60: every candidate card's blurb and source line is clean", () => {
  const cards = JSON.parse(
    readFileSync(join(ROOT, "data", "ballot", "candidate-cards-2026.json"), "utf8"),
  ) as {
    cards: Record<
      string,
      { blurb?: string | null; blurbSource?: string | null; photoSource?: string | null }
    >;
  };

  const keys = Object.keys(cards.cards);
  assert.ok(keys.length > 20, `only ${keys.length} cards — the corpus shrank`);

  let checked = 0;
  for (const [key, card] of Object.entries(cards.cards)) {
    for (const field of ["blurb", "blurbSource", "photoSource"] as const) {
      const value = card[field];
      if (typeof value !== "string") continue;
      checked++;
      assert.equal(
        hasMojibake(value),
        false,
        `${key}.${field} is corrupted: ${value}`,
      );
    }
  }
  assert.ok(checked > 40, `only ${checked} strings checked — the fields moved`);
});
