import { stateDomainFiles, streetPath } from "../lib/holdings/files.ts";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Comments stripped, so a guard cannot be satisfied by the prose beside the
// code it is about. `ROOT` is deliberately not taken from here — this file
// already has its own.
import { codeOf } from "./read-code.ts";

/**
 * M26 — the narrowing prompt, held to its spec: the author's verbatim
 * wording, the computed ambiguity trigger, and the device-locality claims.
 */

const ROOT = join(import.meta.dirname, "..");

/**
 * **WGH-5 REPLACED THE WORDING THIS GUARD USED TO PIN** (2026-08-22, the
 * author's 8/22 walkthrough, item 9.8).
 *
 * What it asserted before, and why it could not stay: the M26 prompt promised,
 * verbatim, that no house or apartment number was ever needed — absolutely —
 * while the same component rendered a house-number input on the crossing path
 * and the ballot page's separate form REFUSED to submit without one. A guard
 * pinning an absolute promise the product could not keep was holding the wrong
 * line.
 *
 * The removal is deliberate and is recorded here rather than done quietly:
 * RULING 62 says a test file may not lose guards silently, so this is REWRITTEN
 * to the same strength against the copy that replaced it, not deleted. Three
 * guards where there was one, and the claim they defend is the keepable one —
 * street first, a house number only when the street itself crosses a boundary.
 */
test("the address prompt asks for a STREET by default, and says so", () => {
  const source = readFileSync(
    join(ROOT, "components", "address", "address-prompt.tsx"),
    "utf8",
  );
  assert.ok(
    source.includes("What street do you live on?"),
    "the default ask must be for a street",
  );
  /*
   * **THE PROMISE MOVED AGAIN, FOR THE SAME REASON IT MOVED THE FIRST TIME.**
   * (Session C, 2026-08-31.)
   *
   * The version this guard used to pin — "a house number only when the street
   * itself crosses a boundary" — was still not keepable. With no number the
   * resolver probes a fixed ladder of sample house numbers, and a street whose
   * Census range excludes them all comes back FAILED. The owner's own road is
   * numbered 10701-10899, so all four probes missed and the product told him
   * it could not place his street while promising it did not need a number.
   *
   * So the guard is REWRITTEN to the copy that replaced it rather than
   * loosened, exactly as RULING 62 required the last time: both reasons a
   * number is wanted are named, and the absolute promise still may not return.
   */
  assert.ok(
    source.includes(
      "We ask for your street, and for a house number when the street crosses a boundary or when",
    ),
    "the promise must name BOTH reasons a house number is wanted",
  );
  assert.ok(
    !source.includes("house number only when the street itself crosses a"),
    "the boundary-only promise is retired: it was false for any street the sample ladder misses",
  );
  // The absolute promise may never come back: it was false on the same screen
  // as a form asking for the thing it said was never needed.
  assert.ok(
    !source.includes("no house or apartment number needed"),
    "the absolute never-a-house-number promise is retired and must not return",
  );
});

test("a street that did not place without a number is ASKED for one, not refused", () => {
  /*
   * The reader-facing half of WGH-22. A FAILED resolution with no house number
   * supplied is a fact about our four sample probes, never about the street, so
   * the prompt must ask rather than assert that the street could not be placed.
   * Only a number that WAS supplied and still failed is a real failure.
   *
   * Asserted on the code with comments stripped, so the paragraph above the
   * branch explaining it cannot satisfy the guard on its own.
   */
  const code = codeOf("components", "address", "address-prompt.tsx");
  const failedBranch = code.indexOf('result.status === "FAILED"');
  assert.ok(failedBranch > 0, "the FAILED branch must exist");

  const ask = code.indexOf('setPhase("NEEDS_NUMBER")', failedBranch);
  const declare = code.indexOf('setPhase("FAILED")', failedBranch);
  assert.ok(ask > 0, "the FAILED branch must be able to ask for a house number");
  assert.ok(
    ask < declare,
    "the ask must come BEFORE the refusal, or a street we simply could not probe " +
      "is reported to the reader as a street we could not place",
  );
  assert.ok(
    code.includes("!withNumber"),
    "the ask must be conditional on no number having been supplied yet",
  );
});

test("the house-number field exists ONLY on the split path, and names its reason", () => {
  const source = readFileSync(
    join(ROOT, "components", "address", "address-prompt.tsx"),
    "utf8",
  );
  const houseInput = source.indexOf('aria-label="House number"');
  const streetAsk = source.indexOf("What street do you live on?");
  assert.ok(houseInput > 0 && streetAsk > 0, "both asks must exist");
  // The split branch returns before the street ask, so the house-number input
  // is unreachable unless the reader's own street turned out to be split.
  assert.ok(
    houseInput < streetAsk,
    "the house-number input must live in the split branch, above the street ask",
  );
  assert.ok(
    source.includes("houseNumberReason(split)"),
    "the ask must name which boundary is split and which office it decides",
  );
  // An apartment FIELD, not the word: the component's own docblock says there
  // is no apartment field, and a guard that banned the word would fail on the
  // sentence promising it.
  assert.ok(
    !/(aria-label|placeholder)="[^"]*(apartment|apt\b|unit)[^"]*"/i.test(source),
    "there is no apartment field — not optional, not collapsed, absent",
  );
});

test("the house number is dropped whatever the request returned", () => {
  const source = readFileSync(
    join(ROOT, "components", "address", "address-prompt.tsx"),
    "utf8",
  );
  const finallyAt = source.indexOf("} finally {");
  assert.ok(finallyAt > 0, "the send path must have a finally block");
  assert.ok(
    source.slice(finallyAt, finallyAt + 300).includes('setHouseNumber("")'),
    "item 9.6: resolve, store the jurisdiction ids, discard the number",
  );
});

test("the street index exists for the exemplar zips, ambiguity computed", () => {
  const summary = JSON.parse(
    readFileSync(join(ROOT, "lib", "registry", "street-index-summary.json"), "utf8"),
  ) as { zips: Record<string, { municipalities: number; schoolDistricts: number; streets: number }> };

  // The two exemplars the author named. Counts are whatever the data says —
  // asserted >1 on at least one axis (the trigger), never a literal.
  for (const zip of ["85641", "07866"]) {
    const entry = summary.zips[zip];
    assert.ok(entry, `${zip} must be in the ambiguity summary`);
    assert.ok(
      entry.municipalities > 1 || entry.schoolDistricts > 1,
      `${zip}: the prompt only exists where the answer changes`,
    );
    assert.ok(entry.streets > 0, `${zip}: an index with no streets is broken`);
    // The per-zip file the client fetches actually exists and parses.
    const file = JSON.parse(
      readFileSync(join(ROOT, streetPath(ROOT, zip)!), "utf8"),
    ) as { municipalities: unknown[]; schoolDistricts: unknown[]; streets: Record<string, unknown> };
    assert.equal(file.municipalities.length, entry.municipalities);
    assert.equal(file.schoolDistricts.length, entry.schoolDistricts);
    assert.equal(Object.keys(file.streets).length, entry.streets);
  }
});

test("every written index file is ambiguous — no prompt where nothing changes", () => {
  const summary = JSON.parse(
    readFileSync(join(ROOT, "lib", "registry", "street-index-summary.json"), "utf8"),
  ) as { zips: Record<string, { municipalities: number; schoolDistricts: number }> };
  const files = stateDomainFiles(ROOT, "streets").filter((n) => n.endsWith(".json"));
  assert.equal(
    files.length,
    Object.keys(summary.zips).length,
    "summary and files drifted",
  );
  for (const [zip, entry] of Object.entries(summary.zips)) {
    assert.ok(
      entry.municipalities > 1 || entry.schoolDistricts > 1,
      `${zip}: an unambiguous zip must not carry a prompt file`,
    );
  }
});

test("the narrowing store never transmits — the code has no network write", () => {
  const hook = readFileSync(join(ROOT, "hooks", "use-narrowing.ts"), "utf8");
  // The hook owns the two keys and must be purely local: no fetch, no
  // beacon, no XHR anywhere in it.
  assert.ok(hook.includes("wtp.selected_divisions"));
  assert.ok(hook.includes("wtp.selected_street"));
  for (const banned of ["fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket"]) {
    assert.ok(!hook.includes(banned), `use-narrowing.ts must not contain ${banned}`);
  }
});
