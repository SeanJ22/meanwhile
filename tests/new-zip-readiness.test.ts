import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "./read-code.ts";
import type { CandidateUniverse } from "../lib/hunt/candidate-universe.ts";
import { newZipReadiness } from "../lib/hunt/source-universe.ts";
import { applicableDivisions, projectOntoZip, stateDivision } from "../lib/hunt/zip-projection.ts";

/**
 * **THE NEW-ZIP READINESS INVARIANT, AS A PERMANENT CHECK.**
 * (Session C3, lane C, 2026-09-01. RULING 229, item 5e.)
 *
 * ## The claim under test, stated exactly
 *
 * For a candidate, office or body whose canonical STATEWIDE record this project
 * ALREADY HOLDS, activating another Arizona ZIP that reaches that entity must
 * require **ZERO new external acquisition** to display the record it holds.
 *
 * A new ZIP may create applicability and linkage work — deciding which contests
 * a place is inside is real work and it is not forbidden. What it may not
 * create is a fresh source hunt for a record the Secretary of State already
 * published and the state authority already owed us.
 *
 * ## Why the ZIP below is the one it is
 *
 * **85122 — Casa Grande, Pinal County.** It is outside the 85641/85701 pilot
 * pair, it is a real Arizona ZIP, and it is present in this repository's own
 * committed geometry (`data/derived/zip-division-ids.json`), so the divisions
 * it sits in are read rather than asserted. Picking a ZIP with no committed
 * geometry would have made the test pass for the wrong reason: the projection
 * would fall back to the state division alone and the local half would never be
 * exercised.
 *
 * ## HOW "NO OUTBOUND ACQUISITION" IS ASSERTED
 *
 * `globalThis.fetch` is REPLACED for the duration of the projection with a
 * function that records the URL and throws. Every retrieval route in this
 * repository goes through `fetch`. So the assertion is not that we believe no
 * request happened — it is that a request could not have happened without
 * failing this test by name and printing the URL it tried to reach.
 *
 * That is deliberately stronger than counting requests afterwards. A count can
 * be taken before a lazy call fires; a trap that throws cannot be satisfied by
 * a call that has not happened yet.
 */

const UNIVERSE = join(ROOT, "data", "states", "az", "hunt", "az-candidate-universe-2026.json");
const ZIP_DIVISIONS = join(ROOT, "data", "derived", "zip-division-ids.json");

/** Outside the pilot pair, and in this repository's committed geometry. */
const NON_PILOT_ZIP = "85122";
const PILOT_ZIPS = ["85641", "85701"] as const;

function universe(): CandidateUniverse {
  return JSON.parse(readFileSync(UNIVERSE, "utf8")) as CandidateUniverse;
}

function overlappingDivisions(zip: string): string[] | undefined {
  const doc = JSON.parse(readFileSync(ZIP_DIVISIONS, "utf8")) as { zips: Record<string, string[]> };
  return doc.zips[zip];
}

/**
 * Run `fn` with every outbound path trapped.
 *
 * The trap throws rather than returning a stub, because a stubbed response is
 * something the code under test can succeed against — and succeeding against a
 * stub is exactly how a hidden request survives a test that was meant to forbid
 * it.
 */
function withNoNetwork<T>(fn: () => T): { result: T; attempted: string[] } {
  const attempted: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((input: unknown) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
    attempted.push(url);
    throw new Error(
      `RULING 229 VIOLATION: rendering a held record for a new ZIP attempted an outbound request to ${url}`,
    );
  }) as typeof globalThis.fetch;
  try {
    return { result: fn(), attempted };
  } finally {
    globalThis.fetch = real;
  }
}

test("the non-pilot ZIP is genuinely non-pilot, and its geometry is committed", () => {
  assert.ok(
    !PILOT_ZIPS.includes(NON_PILOT_ZIP as (typeof PILOT_ZIPS)[number]),
    "the readiness test must exercise a ZIP outside the pilot pair, or it proves nothing",
  );
  const overlapping = overlappingDivisions(NON_PILOT_ZIP);
  assert.ok(
    Array.isArray(overlapping) && overlapping.length > 0,
    `${NON_PILOT_ZIP} is absent from data/derived/zip-division-ids.json. A ZIP with no committed ` +
      "geometry would make this suite pass for the wrong reason: the projection would fall back to " +
      "the state division alone and never exercise the local half.",
  );
});

test("the canonical statewide identity carries no ZIP, county or pilot in its key", () => {
  const u = universe();
  const governor = u.candidacies.find(
    (c) => c.ocdId === stateDivision("az") && /governor/i.test(c.officeTitle),
  );
  assert.ok(governor, "the AZ candidate universe holds no statewide Governor candidacy");

  assert.doesNotMatch(
    governor.id,
    /pima|85641|85701|ballot-/i,
    `the canonical identity ${governor.id} names a county, a pilot ZIP or a pilot ballot. RULING 229: ` +
      "an identity keyed to where we happened to look first is what made a second ZIP look like a new " +
      "candidate.",
  );
  assert.ok(
    governor.pilotIds.length > 0,
    "the canonical record dropped its pilot ids — the projection is then a rename rather than a join, " +
      "and nothing downstream can still answer what one county's certified ballot said",
  );
});

test("RULING 229: activating 85122 renders held statewide records with ZERO outbound acquisition", () => {
  const u = universe();
  const overlapping = overlappingDivisions(NON_PILOT_ZIP);

  const { result, attempted } = withNoNetwork(() => {
    const { divisions, hadGeometry } = applicableDivisions({ stateCode: "AZ", overlapping });
    assert.equal(hadGeometry, true, "the committed geometry for this ZIP did not load");
    return projectOntoZip({
      zip: NON_PILOT_ZIP,
      universe: u,
      divisions,
      citation: "data/states/az/hunt/az-candidate-universe-2026.json",
    });
  });

  assert.deepEqual(
    attempted,
    [],
    "rendering a record the state authority already published, for a ZIP we already hold the geometry " +
      "for, went to the network",
  );

  const readiness = newZipReadiness(result.projection);
  assert.equal(readiness.ready, true, readiness.why);
  assert.deepEqual(result.projection.requiredFreshAcquisition, []);
  assert.equal(
    result.projection.answeredFromCorpus,
    result.projection.applicable,
    "a candidacy was neither answered from the corpus nor acquired — it was dropped, which is the " +
      "failure mode that reads to a reader as an absence",
  );
});

test("85122 actually reaches a statewide contest, so the projection is not vacuous", () => {
  /*
   * A projection that matched NOTHING would satisfy every assertion above by
   * doing nothing at all. RULING 159's floor, applied to a readiness test: an
   * empty numerator over an empty denominator is not a passing result.
   */
  const u = universe();
  const { divisions } = applicableDivisions({ stateCode: "AZ", overlapping: overlappingDivisions(NON_PILOT_ZIP) });
  const { candidacies } = projectOntoZip({
    zip: NON_PILOT_ZIP,
    universe: u,
    divisions,
    citation: "data/states/az/hunt/az-candidate-universe-2026.json",
  });

  assert.ok(
    candidacies.length > 0,
    `${NON_PILOT_ZIP} projected to ZERO candidacies out of ${u.candidacies.length} held. The readiness ` +
      "assertions above would then be true of an empty set, which is not a result.",
  );
  assert.ok(
    candidacies.some((c) => c.ocdId === stateDivision("az")),
    "the projection reached no STATEWIDE contest, so it never exercised a record the state authority " +
      "publishes once for every Arizona ZIP — which is the exact record this invariant is about",
  );
});

test("the same statewide record answers BOTH a pilot ZIP and the non-pilot ZIP, from one identity", () => {
  /*
   * The invariant is not only "no request". It is that the SAME canonical row
   * serves both places. Two rows that happened to hold the same facts under two
   * pilot-shaped keys would pass a no-network test and would still be the
   * defect: a third ZIP would need a third row.
   */
  const u = universe();
  const state = stateDivision("az");
  const fromPilot = projectOntoZip({
    zip: PILOT_ZIPS[0],
    universe: u,
    divisions: applicableDivisions({ stateCode: "AZ", overlapping: overlappingDivisions(PILOT_ZIPS[0]) }).divisions,
    citation: UNIVERSE,
  }).candidacies.filter((c) => c.ocdId === state);
  const fromNonPilot = projectOntoZip({
    zip: NON_PILOT_ZIP,
    universe: u,
    divisions: applicableDivisions({ stateCode: "AZ", overlapping: overlappingDivisions(NON_PILOT_ZIP) }).divisions,
    citation: UNIVERSE,
  }).candidacies.filter((c) => c.ocdId === state);

  assert.ok(fromPilot.length > 0, "the pilot ZIP reached no statewide contest");
  assert.deepEqual(
    fromNonPilot.map((c) => c.id).sort(),
    fromPilot.map((c) => c.id).sort(),
    "the two ZIPs resolved statewide contests to different identities. A statewide office is one " +
      "record; two keys for it means a third ZIP needs a third key.",
  );
});
