import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  bodyAccountingFor,
  looseName,
} from "../lib/registry/body-name-match.ts";
import { CURATED_BODIES } from "../lib/registry/curated-bodies.ts";
import registry from "../lib/registry/registry.json" with { type: "json" };

/**
 * **TWO INSTRUMENTS, ONE ANSWER.** (NH Hunt 5, 2026-08-21.)
 *
 * On 2026-08-21 `pnpm twig:pair` reported LAKE TODD VILLAGE DISTRICT as HELD,
 * matched by curated name, one body. `docs/gap-ledger.md`, generated from the
 * same registry minutes later, printed *"2 of these govern part of this zip
 * and are not in the registry"* — Lake Todd being one of the two.
 *
 * The ledger had not got the lookup wrong. It never did one: the sentence was
 * a constant, true the day it was written and false from the moment NH Hunt 4
 * wired the district. That is the coverage-note failure RULING 59 deleted,
 * reappearing one layer down in the document RULING 59 makes load-bearing —
 * the gap ledger is now the ONLY place the known-but-not-reached enumeration
 * lives, so a false absence there sends the next session to hunt something
 * already caught, and tells the author a body is dark when it is lit.
 *
 * The fix is a shared matcher rather than a corrected sentence, because a
 * corrected sentence would have been a second implementation of the same
 * question and free to disagree with the first all over again.
 */

const BODY_NAMES = [...CURATED_BODIES, ...registry.bodies].map(
  (b) => b.name ?? "",
);

test("a shouting Census name matches its quiet registry spelling", () => {
  assert.equal(
    bodyAccountingFor("LAKE TODD VILLAGE DISTRICT", BODY_NAMES),
    "Lake Todd Village District",
  );
});

test("a Census GOVERNMENT matches the BODY inside it (RULING 9)", () => {
  // The Census names the government; this product renders the body. Without
  // suffix-stripping these are two different strings and the district reads
  // as dark.
  assert.equal(
    bodyAccountingFor("MERRIMACK COUNTY CONSERVATION DISTRICT", BODY_NAMES),
    "Merrimack County Conservation District Board of Supervisors",
  );
});

test("a government this registry genuinely does not hold reports absent", () => {
  for (const dark of [
    "EASTMAN VILLAGE DISTRICT",
    "SULLIVAN COUNTY CONSERVATION DISTRICT",
  ]) {
    assert.equal(
      bodyAccountingFor(dark, BODY_NAMES),
      undefined,
      `${dark} is not held here and must not be matched into looking held — ` +
        "a false POSITIVE is worse than the false negative this fixed, " +
        "because it removes a body from the hunt queue silently",
    );
  }
});

test("an empty or missing name never matches anything", () => {
  // The failure mode of a loose matcher: "" prefix-matches every string.
  for (const nothing of [null, undefined, "", "   ", "!!!"]) {
    assert.equal(
      bodyAccountingFor(nothing, BODY_NAMES),
      undefined,
      `${JSON.stringify(nothing)} must not match — an empty key would mark ` +
        "every unresolved government as held",
    );
  }
});

test("looseName survives punctuation, case and doubled spaces", () => {
  assert.equal(looseName("Lake  Todd Village-District, Inc."), "LAKE TODD VILLAGE DISTRICT INC");
  assert.equal(looseName(null), "");
});

test("both instruments call the shared matcher, neither rolls its own", () => {
  for (const path of ["scripts/twig-pair.mts", "scripts/build-gap-ledger.mts"]) {
    const src = readFileSync(path, "utf8");
    assert.ok(
      src.includes("bodyAccountingFor"),
      `${path} must ask the shared matcher`,
    );
    assert.ok(
      !/BOARD OF SUPERVISORS\|BOARD OF DIRECTORS/.test(src),
      `${path} has its own copy of the suffix list again. Two copies is how ` +
        "twig:pair and the gap ledger came to disagree about Lake Todd.",
    );
  }
});

test("the ledger states its held/dark split as a reconciling pair", () => {
  const src = readFileSync("scripts/build-gap-ledger.mts", "utf8");
  // The emitted STRING, not the doc block above it — the headstone in that
  // file quotes the deleted sentence verbatim, which is the point of a
  // headstone, and a check that could not tell the two apart would fail on
  // its own explanation.
  const emitted = src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
    })
    .join("\n");
  assert.ok(
    !emitted.includes("of these govern part of this zip and are not in"),
    "the unconditional 'are not in the registry' sentence is back. It " +
      "asserts an absence without looking, which is the defect.",
  );
  assert.ok(
    emitted.includes("bodyAccountingFor(d.name, REGISTRY_BODY_NAMES)"),
    "the split must be computed from the registry, not assumed",
  );
  assert.ok(
    src.includes("IN THE REGISTRY:") && src.includes("NOT IN THE REGISTRY:"),
    "both halves must be NAMED, not counted — RULING 57: a count is not a name",
  );
});
