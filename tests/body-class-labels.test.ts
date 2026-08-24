import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  APPOINTED_LED,
  BODY_CLASS_LABELS,
  bodyClassLong,
  bodyClassShort,
  governVerbMayAttach,
} from "../lib/registry/body-class-labels.ts";
import { TRIBAL_NATIONS, tribalNationsInState } from "../lib/registry/tribal-nations.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * **RULING 118** — an appointed official never carries the govern verb.
 * **RULING 119** — a sovereign tribal nation is its own category of government.
 * (Both Sean's decisions of 2026-08-24, closing `NS07` and `NS08`.)
 */

test("every body class has a reader label and a stated reason", () => {
  for (const [key, label] of Object.entries(BODY_CLASS_LABELS)) {
    assert.ok(label.short.length > 0, `${key} has no short label`);
    assert.ok(label.long.length > 0, `${key} has no long label`);
    // A stripped rule reads as guidance: the reason travels with the value.
    assert.ok(label.why.length > 20, `${key} does not say WHY the verb rule is what it is`);
    // Plain language: no enum leaks to a reader.
    assert.doesNotMatch(label.short, /_/, `${key} short label looks like an enum`);
    assert.doesNotMatch(label.long, /_/, `${key} long label looks like an enum`);
  }
});

test("RULING 118 — the govern verb never attaches to an appointed-led body", () => {
  for (const bodyClass of APPOINTED_LED) {
    assert.equal(
      governVerbMayAttach(bodyClass),
      false,
      `${bodyClass} is led by an appointed person and must not carry the govern verb`,
    );
  }
  assert.equal(governVerbMayAttach("EXECUTIVE_AGENCY"), false);
  // The two that legitimately DO govern a territory a reader can be inside of.
  assert.equal(governVerbMayAttach("GOVERNING"), true);
  assert.equal(governVerbMayAttach("REGIONAL"), true);
});

test("RULING 119 — a sovereign nation is labelled as one, and the verb does not attach", () => {
  assert.equal(bodyClassShort("SOVEREIGN_TRIBAL"), "Sovereign nation");
  assert.equal(bodyClassLong("SOVEREIGN_TRIBAL"), "Sovereign tribal nation");
  /*
   * Not caution — honesty. Tribal jurisdiction turns on membership and land
   * status, and this product resolves a reader by geography alone.
   */
  assert.equal(governVerbMayAttach("SOVEREIGN_TRIBAL"), false);
  assert.match(BODY_CLASS_LABELS.SOVEREIGN_TRIBAL.why, /neither federal nor state nor local/i);
});

test("a private association is never presented as a government", () => {
  assert.equal(governVerbMayAttach("PRIVATE_ASSOCIATION"), false);
});

test("NO SURFACE KEEPS ITS OWN CLASS-LABEL MAP — the duplicate-implementation guard", () => {
  /*
   * **RULING 103.** There were THREE copies of these labels, and the third was
   * a BINARY — `bodyClass === "GOVERNING" ? "Governing" : "Advisory"` — which
   * would have called a sovereign tribal nation advisory the day one shipped.
   * Grepping the symptom could not find them: they shared no string.
   *
   * So this searches by SHAPE (RULING 110): any component that maps a
   * bodyClass to its own hardcoded label literal.
   */
  const dirs = ["components", "app"];
  const offenders: string[] = [];
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...walk(rel));
      else if (/\.tsx?$/.test(entry.name)) out.push(rel);
    }
    return out;
  };
  for (const file of dirs.flatMap(walk)) {
    const source = readFileSync(join(ROOT, file), "utf8");
    // Shape 1: a Record keyed on bodyClass with literal labels in it.
    if (/Record<[^>]*bodyClass[^>]*>\s*=\s*\{[^}]*GOVERNING:\s*"/.test(source)) {
      offenders.push(`${file} — keeps its own bodyClass label map`);
    }
    // Shape 2: the binary. This is the one that was actually shipped.
    if (/bodyClass\s*===\s*"GOVERNING"\s*\?\s*"/.test(source)) {
      offenders.push(`${file} — decides the label with a GOVERNING/else binary`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "class labels come from lib/registry/body-class-labels.ts and nowhere else",
  );
});

test("the instrument catches a real instance — the binary it was written for", () => {
  /*
   * RULING 110: a sweep that cannot find the defect it was written for is a
   * sweep reporting green about nothing. This is the shipped copy verbatim.
   */
  const theRealThing = `{body.bodyClass === "GOVERNING" ? "Governing" : "Advisory"}`;
  assert.match(theRealThing, /bodyClass\s*===\s*"GOVERNING"\s*\?\s*"/);
});

test("RULING 119 — the three nations are named, with a federal code behind each id", () => {
  assert.equal(TRIBAL_NATIONS.length, 3);
  const names = TRIBAL_NATIONS.map((n) => n.name);
  assert.ok(names.includes("Navajo Nation"));
  assert.ok(names.includes("Tohono O'odham Nation"));
  assert.ok(names.includes("Pascua Yaqui Tribe"));

  for (const nation of TRIBAL_NATIONS) {
    // A guessed identifier is a LEAD. Every id is keyed on the Census code...
    assert.match(nation.ocdId, /^ocd-division\/country:us\/aiannh:\d{4}$/);
    assert.ok(nation.ocdId.endsWith(nation.censusAiannhCode), "the id is keyed on the Census code");
    // ...and carries the ANSI code, which is the stabler of the two.
    assert.match(nation.ansiCode, /^\d{8}$/);
    assert.match(nation.provenance, /Census 2020 AIANNH/, "every row says where it came from");
    assert.ok(nation.states.length > 0);
  }
});

test("the three Pima-area nations resolve for Arizona", () => {
  const az = tribalNationsInState("AZ");
  assert.equal(az.length, 3, "all three hold territory in or adjacent to Pima County");
  // The Navajo Nation crosses three states, which is why states is a list.
  const navajo = TRIBAL_NATIONS.find((n) => n.name === "Navajo Nation");
  assert.deepEqual(navajo?.states, ["AZ", "NM", "UT"]);
  // ...and it is not an Arizona-only fact.
  assert.equal(tribalNationsInState("NM").length, 1);
  assert.equal(tribalNationsInState("UT").length, 1);
  // A control: a state with none of them returns none, rather than everything.
  assert.equal(tribalNationsInState("NH").length, 0);
});

test("the minted identifier declares itself as minted", () => {
  /*
   * The canonical OCD registry has no tribal division type. That is a FINDING
   * and the module says so — a later session must not read these ids as
   * looked-up when they were built from a federal code by this project.
   */
  const source = readFileSync(join(ROOT, "lib", "registry", "tribal-nations.ts"), "utf8");
  assert.match(source, /PROJECT-MINTED/);
  /*
   * Whitespace-tolerant, because the sentence is line-wrapped in a doc comment
   * and a literal-string search would report "not found" about text that is
   * plainly there — which is the wrong-FORM search RULING 110 names.
   */
  const prose = source.replace(/\s*\n\s*\*\s*/g, " ");
  assert.match(prose, /no tribal division type/i);
});
