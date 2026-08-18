import assert from "node:assert/strict";
import { test } from "node:test";

import registryJson from "../lib/registry/registry.json" with { type: "json" };
import type { Registry } from "../lib/registry/types.ts";

/**
 * D24 — the canonical reconciliation, guarded (2026-08-17, g10).
 *
 * The row asked for two things: close the gap where a match exists, and
 * RECORD PER DIVISION why none exists where it does not. Both are properties
 * of the committed registry, so both are checkable here rather than trusted.
 *
 * What makes this worth a test rather than a number in a report: every one of
 * these invariants is the kind that fails silently. A join that starts
 * matching on names produces more matches and looks like progress; an
 * unmatched division with no stated reason looks exactly like one whose
 * reason is "none needed"; and a `RESOLVED`-shaped row with a null identifier
 * reads as a match to anything that counts them.
 */

const REGISTRY = registryJson as unknown as Registry;

test("every division carries a canonical verdict", () => {
  for (const d of REGISTRY.divisions) {
    assert.ok(d.canonicalMatch, `${d.ocdId} states no canonicalMatch`);
  }
});

test("a match names an identifier, and a non-match names none", () => {
  for (const d of REGISTRY.divisions) {
    if (d.canonicalMatch === "none") {
      assert.equal(
        d.canonicalOcdId,
        null,
        `${d.ocdId} claims no match and carries ${d.canonicalOcdId}`,
      );
    } else {
      assert.ok(
        d.canonicalOcdId,
        `${d.ocdId} claims a ${d.canonicalMatch} match and names no identifier`,
      );
    }
  }
});

test("every unmatched division records WHY, and none is left undetermined", () => {
  // The row's actual ask. 348 divisions used to sit at `none` with nothing
  // said about them, which is indistinguishable from nobody having looked.
  const unmatched = REGISTRY.divisions.filter((d) => d.canonicalMatch === "none");
  assert.ok(unmatched.length > 0, "the reconciliation is not expected to be total");
  for (const d of unmatched) {
    assert.ok(d.canonicalGap, `${d.ocdId} has no match and no stated reason`);
    assert.notEqual(
      d.canonicalGap,
      "UNDETERMINED",
      `${d.ocdId}: every gap in this registry has been established; ` +
        "an UNDETERMINED here means a layer was added whose reason nobody worked out",
    );
  }
});

test("a matched division states no gap", () => {
  for (const d of REGISTRY.divisions.filter((x) => x.canonicalMatch !== "none")) {
    assert.equal(
      d.canonicalGap,
      undefined,
      `${d.ocdId} matched and still carries a gap reason`,
    );
  }
});

test("nothing is matched by slug similarity any more", () => {
  /*
   * The load-bearing one. Before D24 closed, 64 divisions were matched on
   * "same terminal segment, same state" — a NAME comparison, which is what
   * CLAUDE.md forbids joining geographic entities on. Every one of them is
   * now matched on Census GEOID instead, which is an identifier both sides
   * publish.
   *
   * `census_name` is deliberately allowed and is not the same thing: it
   * builds an identifier out of the Census's own published county and number
   * and then requires that exact identifier to be IN the canonical set. No
   * similarity, no nearest match. If it ever needs to grow past New
   * Hampshire's House districts, that is a decision to make explicitly rather
   * than a threshold to loosen.
   */
  const bySlug = REGISTRY.divisions.filter(
    (d) => d.canonicalMatch === "high" || d.canonicalMatch === "low",
  );
  assert.deepEqual(
    bySlug.map((d) => `${d.ocdId} (${d.canonicalMatch})`),
    [],
    "a slug-similarity match is a review item, never a join",
  );
});

test("the census_name join stays scoped to the one case it was built for", () => {
  const named = REGISTRY.divisions.filter((d) => d.canonicalMatch === "census_name");
  assert.ok(named.length > 0, "New Hampshire's House districts should match this way");
  for (const d of named) {
    assert.equal(d.divisionType, "sldl", `${d.ocdId} is not a lower-house district`);
    assert.equal(d.state, "NH", `${d.ocdId} is outside the scope this rule was measured on`);
  }
});

test("every division carries the Census GEOID the join depends on", () => {
  // The reconciliation is only re-derivable from an exact key if the key is
  // actually retained. It was being dropped at the build, which is why the
  // canonical list's own census_geoid column went unused for four days.
  const missing = REGISTRY.divisions.filter((d) => !d.geoid);
  assert.deepEqual(
    missing.map((d) => d.ocdId),
    [],
    "a division with no GEOID cannot be reconciled on an identifier",
  );
});

test("a GEOID match is one-to-one", () => {
  // Two divisions claiming the same canonical identifier would mean the join
  // collapsed — the distinctness rule CLAUDE.md states for any keyed join.
  const seen = new Map<string, string>();
  for (const d of REGISTRY.divisions) {
    if (d.canonicalMatch === "none" || !d.canonicalOcdId) continue;
    const prior = seen.get(d.canonicalOcdId);
    assert.equal(
      prior,
      undefined,
      `${d.ocdId} and ${prior} both claim ${d.canonicalOcdId}`,
    );
    seen.set(d.canonicalOcdId, d.ocdId);
  }
});
