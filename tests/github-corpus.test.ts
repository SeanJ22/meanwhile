import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { licenceIdentifier } from "../lib/hunt/github-corpus.ts";

const ROOT = join(import.meta.dirname, "..");

/* ========================================================================== */
/* Item 2 — the two GitHub corpora, walked over git rather than over HTTP     */
/* ========================================================================== */

/**
 * These guards read the COMMITTED EVIDENCE, never the network. A test that
 * cloned would be a live call in the unit suite, which `CLAUDE.md` forbids —
 * `tests/fixtures/` holds bytes a server actually sent, and this artifact is
 * the same idea for a walk.
 */
const walk = JSON.parse(
  readFileSync(join(ROOT, "data", "hunt", "congress-corpus-walk.json"), "utf8"),
) as {
  corpora: Array<{
    slug: string;
    sha: string;
    licenceFile: string | null;
    licenceIdentifier: string | null;
  }>;
  directory: {
    assertion: { verdict: string; stated: number; extracted: number };
    membersInCorpus: number;
    matchedToHeld: number;
    heldNoLongerCurrent: number;
  };
  portraits: {
    assertion: { verdict: string; stated: number; extracted: number };
    owedAndInCorpus: number;
    owedAndNotInCorpus: string[];
    retrievedAndVerified: number;
    committedIntoRepo: number;
    rows: Array<{ bioguide: string; bytes: number; sha256: string; width: number; height: number }>;
  };
};

test("corpora: the licence was read from each repository's OWN LICENSE file", () => {
  assert.equal(walk.corpora.length, 2, "both corpora must be recorded");
  for (const corpus of walk.corpora) {
    assert.ok(corpus.licenceFile, `${corpus.slug} has no licence file recorded`);
    assert.equal(
      corpus.licenceIdentifier,
      "CC0 1.0 Universal",
      `${corpus.slug} licence was not confirmed as CC0 from its own file`,
    );
    assert.match(corpus.sha, /^[0-9a-f]{40}$/, `${corpus.slug} is not pinned to a commit`);
  }
});

test("corpora: the licence reader identifies CC0 and refuses to guess", () => {
  const cc0 = readFileSync(join(ROOT, "docs", "sources.md"), "utf8");
  assert.ok(cc0.includes("CC0 1.0 Universal"), "sources.md does not record the licence");
  assert.equal(licenceIdentifier("Creative Commons Legal Code\nCC0 1.0 Universal\n"), "CC0 1.0 Universal");
  assert.equal(licenceIdentifier("MIT License\n"), "MIT");
  assert.equal(
    licenceIdentifier("Some prose that names no licence at all."),
    null,
    "an unrecognised licence must be null — never assumed from an organisation name",
  );
});

test("corpora: RULING 100 — both count assertions MATCHED, neither is NOT_ASSERTABLE", () => {
  assert.equal(walk.directory.assertion.verdict, "MATCHED");
  assert.equal(walk.directory.assertion.stated, 537);
  assert.equal(walk.directory.assertion.extracted, 537);

  assert.equal(walk.portraits.assertion.verdict, "MATCHED");
  assert.equal(
    walk.portraits.assertion.stated,
    walk.portraits.assertion.extracted,
    "the portrait corpus stated one size and extraction produced another",
  );
});

test("corpora: 537 of 537 sitting members match people we already hold", () => {
  assert.equal(walk.directory.membersInCorpus, 537);
  assert.equal(walk.directory.matchedToHeld, 537);
  assert.equal(walk.directory.heldNoLongerCurrent, 0);
});

test("corpora: every owed portrait was retrieved AND verified as a real image", () => {
  assert.equal(
    walk.portraits.retrievedAndVerified,
    walk.portraits.owedAndInCorpus,
    "a portrait the corpus holds was not retrieved",
  );
  assert.ok(walk.portraits.rows.length > 0, "no portrait rows recorded");
  for (const row of walk.portraits.rows) {
    assert.match(row.sha256, /^[0-9a-f]{64}$/, `${row.bioguide} has no real hash`);
    assert.ok(row.bytes > 1024, `${row.bioguide} is ${row.bytes} bytes — not a portrait`);
    assert.ok(row.width > 0 && row.height > 0, `${row.bioguide} has no readable dimensions`);
  }
});

test("corpora: RULING 20 holds — no portrait byte was committed to the repo", () => {
  assert.equal(
    walk.portraits.committedIntoRepo,
    0,
    "portraits and PDF corpora do not go in git; the store is R57",
  );
  for (const row of walk.portraits.rows) {
    assert.ok(
      !readFileSync(join(ROOT, "data", "hunt", "congress-corpus-walk.json"), "utf8").includes(
        `"data":"`,
      ),
      "the evidence artifact must carry provenance, never image bytes",
    );
    assert.ok(row.bioguide.length > 0);
  }
});

test("corpora: the members the corpus genuinely does not carry are NAMED, not counted", () => {
  /*
   * RULING 105's middle number: a body this product decided not to cover and a
   * body it failed to reach need different responses, and only naming them
   * keeps the two apart. Three sitting members have no portrait in the
   * pictorial directory, and they are a FINDING rather than a rounding error.
   */
  assert.ok(Array.isArray(walk.portraits.owedAndNotInCorpus));
  for (const bioguide of walk.portraits.owedAndNotInCorpus) {
    assert.match(bioguide, /^[A-Z]\d{6}$/, `${bioguide} is not a bioguide id`);
  }
});

/* ========================================================================== */
/* The rung is in the SHARED code path, not in a session script               */
/* ========================================================================== */

test("corpora: the tracked official-photo fetcher is retired from production", () => {
  assert.equal(existsSync(join(ROOT, "scripts", "fetch-official-photos.mts")), false);
  const promoter = readFileSync(join(ROOT, "scripts", "promote-registry-runtime.mts"), "utf8");
  assert.match(promoter, /processRegisteredManualCandidate/);
  assert.doesNotMatch(promoter, /writeFile(?:Sync)?\s*\(/);
});

test("corpora: reviewed portrait bindings enter the canonical registry package with exact source receipts", () => {
  const plane = readFileSync(join(ROOT, "lib", "registry", "runtime-data-plane.ts"), "utf8");
  assert.match(plane, /officialPhotos/);
  assert.match(plane, /RUNTIME_SOURCE_NOT_RECEIPTED/);
  assert.match(plane, /manualSourceReceipt/);
});

test("corpora: sources.md records both repositories with licence, tier and access method", () => {
  const sources = readFileSync(join(ROOT, "docs", "sources.md"), "utf8");
  for (const slug of ["unitedstates/congress-legislators", "unitedstates/images"]) {
    assert.ok(sources.includes(slug), `${slug} is not in the register`);
  }
  assert.match(sources, /### unitedstates\/images[\s\S]{0,2000}?Last walked:\*\* 2026-08-23/);
  assert.match(sources, /### unitedstates\/images[\s\S]{0,2000}?CC0 1\.0 Universal/);
  assert.match(sources, /### unitedstates\/images[\s\S]{0,2000}?\*\*Tier:\*\* A/);
});
