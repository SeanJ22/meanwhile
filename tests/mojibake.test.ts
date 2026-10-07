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
 * No reader ever sees a decoding accident: an em-dash's UTF-8 bytes read back as cp1252 is invisible in a diff and
 * survives every non-empty check, so the committed text itself is scanned.
 */

const ROOT = join(import.meta.dirname, "..");

/** Every tracked file whose contents can reach a reader as words. */
function readerFacingFiles(): string[] {
  // `--others --exclude-standard` alongside `--cached`, so an uncommitted file is scanned too.
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

/** The corrupt sequences are built from codepoints, never typed as literals, so this file is not an offender in its own scan. */
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
  // A check that flags real accented names, arrows and dashes gets switched off.
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

/** The repair is per-sequence, so correctly written characters are never turned into U+FFFD. */
test("M60: repairing mixed text keeps the characters that were already right", () => {
  const mixed = `good \u2014 dash, bad ${BROKEN_EM_DASH} dash, good \u2014 again`;
  const fixed = repairMojibake(mixed);
  assert.equal(fixed, "good \u2014 dash, bad \u2014 dash, good \u2014 again");
  assert.equal((fixed.match(/—/g) ?? []).length, 3);
  assert.ok(!fixed.includes("�"), "the repair produced a replacement char");
});
