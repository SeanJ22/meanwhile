import assert from "node:assert/strict";
import test from "node:test";

import {
  MEASURE_PROVISIONS,
  PROVISION_KIND_LABEL,
  provisionById,
  provisionsForContest,
  type ProvisionKind,
} from "../lib/ballot/measure-provisions.ts";
import { getMeasureAnalyses, analysisForContest } from "../lib/ballot/analyses.ts";
import { MEASURE_SUMMARIES } from "../lib/ballot/measure-summary.ts";

/**
 * P01 — the decomposition is held to the same standard as the summaries.
 *
 * A provision is a CLAIM ABOUT A REAL BALLOT MEASURE that a reader will react
 * to, and the reaction is sold. So every one of them has to be traceable to the
 * state's own adopted analysis, has to describe rather than advocate, and has
 * to keep a stable id — a renumbered id silently orphans every reaction already
 * collected against it.
 */

const KINDS: ProvisionKind[] = [
  "FUNDING",
  "PROGRAM",
  "OVERSIGHT",
  "SUNSET",
  "START",
];

test("every measure with an analysis is decomposed, and nothing else is", () => {
  const file = getMeasureAnalyses();
  assert.ok(file !== null, "no analyses file — the citations have nothing to resolve against");

  const analysed = new Set(file.analyses.map((a) => a.contestId));
  const decomposed = new Set(MEASURE_PROVISIONS.map((p) => p.contestId));

  /* Both directions. A measure with no provisions renders as a measure nobody
   * can react to, which is P01 unfinished wearing a finished face; a provision
   * for a contest we hold no analysis of is a claim with no source. */
  const undecomposed = [...analysed].filter((id) => !decomposed.has(id));
  assert.deepEqual(
    undecomposed,
    [],
    `these measures have an official analysis but no provisions: ${undecomposed.join(", ")}`,
  );

  const unsourced = [...decomposed].filter((id) => !analysed.has(id));
  assert.deepEqual(
    unsourced,
    [],
    `these provisions belong to a contest with no analysis record: ${unsourced.join(", ")}`,
  );

  // The denominator, stated rather than implied.
  assert.equal(analysed.size, 11, `expected the 11 AZ measures, found ${analysed.size}`);
});

test("every provision cites the analysis of its own measure", () => {
  for (const provision of MEASURE_PROVISIONS) {
    const record = analysisForContest(provision.contestId);
    assert.ok(record !== null, `${provision.id}: no analysis record for its contest`);
    assert.equal(
      provision.citesUrl,
      record.analysisUrl,
      `${provision.id} cites ${provision.citesUrl}, but its measure's analysis is ${record.analysisUrl}. ` +
        "Six of eleven hand-typed URLs were wrong on the first draft; the citation is read " +
        "off the record for exactly that reason.",
    );
  }
});

test("a provision's summary and its measure's summary cite the same document", () => {
  /* The two curated layers describe the same measure from the same source. If
   * they ever cite different documents, one of them was written from something
   * else — which is the failure neither layer is allowed to have. */
  for (const summary of MEASURE_SUMMARIES) {
    const provisions = provisionsForContest(summary.contestId);
    if (provisions.length === 0) continue;
    for (const provision of provisions) {
      assert.equal(
        provision.citesUrl,
        summary.summarizesUrl,
        `${provision.id} and the measure summary cite different documents`,
      );
    }
  }
});

test("ids are unique, stable-shaped, and resolvable", () => {
  const seen = new Set<string>();
  for (const provision of MEASURE_PROVISIONS) {
    assert.ok(!seen.has(provision.id), `duplicate provision id: ${provision.id}`);
    seen.add(provision.id);
    assert.match(
      provision.id,
      /^[a-z0-9:-]+#[a-z0-9-]+$/,
      `${provision.id} is not shaped <contestId>#<slug>`,
    );
    assert.ok(
      provision.id.startsWith(`${provision.contestId}#`),
      `${provision.id} does not name its own contest`,
    );
    assert.equal(provisionById(provision.id)?.id, provision.id);
  }
  assert.equal(provisionById("ballot-az-pima:prop-141#not-a-provision"), null);
});

test("every kind is one of the five, and every kind has a reader-facing label", () => {
  for (const provision of MEASURE_PROVISIONS) {
    assert.ok(
      KINDS.includes(provision.kind),
      `${provision.id} carries the kind ${provision.kind}, which is not one of the five`,
    );
  }
  for (const kind of KINDS) {
    const label = PROVISION_KIND_LABEL[kind];
    assert.ok(label && label.length > 0, `${kind} has no reader-facing label`);
    // No identifier reaches a reader: the label may not be the enum value.
    assert.notEqual(label, kind, `${kind}'s label is the enum value itself`);
    assert.doesNotMatch(label, /^[A-Z_]+$/, `${kind}'s label reads like an identifier`);
  }
});

test("no provision advocates, ranks, or recommends", () => {
  /*
   * The same vocabulary gate the summaries carry. These are DESCRIPTIONS of
   * what a measure would do; the moment one says whether that is good, the
   * product has recommended, and its neutrality claim is gone.
   */
  const ADVOCACY =
    /\b(should|must vote|vote (?:yes|no)|we recommend|recommended|best choice|good for|bad for|harmful|beneficial|dangerous|common ?sense|extreme|radical|reasonable|fair(?:er|est)?|unfair|protects? (?:us|you)|attacks?)\b/i;
  const offenders: string[] = [];
  for (const provision of MEASURE_PROVISIONS) {
    for (const [field, text] of [
      ["label", provision.label],
      ["what", provision.what],
    ] as const) {
      const hit = ADVOCACY.exec(text);
      if (hit) offenders.push(`${provision.id} (${field}): ${JSON.stringify(hit[0])}`);
    }
  }
  assert.deepEqual(offenders, [], `advocacy vocabulary in provisions:\n  ${offenders.join("\n  ")}`);
});

test("no internal identifier reaches a reader through a provision", () => {
  for (const provision of MEASURE_PROVISIONS) {
    for (const text of [provision.label, provision.what]) {
      assert.doesNotMatch(text, /ocd-division\//, `${provision.id} renders an OCD-ID`);
      assert.doesNotMatch(text, /ballot-az-pima:/, `${provision.id} renders a contest id`);
      assert.doesNotMatch(text, /\b[A-Z]{2,}_[A-Z_]+\b/, `${provision.id} renders an enum value`);
    }
  }
});

test("every provision says something, and says it in plain language", () => {
  for (const provision of MEASURE_PROVISIONS) {
    assert.ok(provision.label.trim().length >= 8, `${provision.id}: label is too thin to read`);
    assert.ok(provision.what.trim().length >= 40, `${provision.id}: 'what' is too thin to read`);
    // A label is a name, not a paragraph — it is what a reaction is attached to.
    assert.ok(
      provision.label.length <= 90,
      `${provision.id}: the label is a paragraph (${provision.label.length} chars)`,
    );
    assert.doesNotMatch(
      provision.label,
      /\.$/,
      `${provision.id}: the label ends in a full stop, so it is a sentence, not a name`,
    );
  }
});

test("the shape of the decomposition, stated as measured", () => {
  /*
   * MEASURED, NOT EXPECTED. Not every measure has all five kinds and it would
   * be a defect if it did: Proposition 141 funds nothing and expires never, and
   * manufacturing a sunset provision for it would be inventing a claim about a
   * real measure. These numbers are what the eleven analyses actually contain,
   * recorded so a later edit that quietly adds or drops one is visible.
   */
  const byKind: Record<string, number> = {};
  for (const provision of MEASURE_PROVISIONS) {
    byKind[provision.kind] = (byKind[provision.kind] ?? 0) + 1;
  }
  assert.equal(MEASURE_PROVISIONS.length, 52, `provision count changed: ${MEASURE_PROVISIONS.length}`);
  /*
   * THE CENSUS, BEFORE AND AFTER RULING 7C (2026-08-18), SIDE BY SIDE.
   *
   *            before   after
   *   FUNDING      10      10
   *   PROGRAM      26      26
   *   OVERSIGHT    12      12
   *   SUNSET        4       2   <- narrowed to expiry and renewal only
   *   START         -       2   <- the fifth kind
   *   total        52      52
   *
   * TWO PROVISIONS MOVED, both pure commencement dates with nothing expiring
   * and nothing renewed in either: prop-143#starts-2028 and prop-144#starts-2028.
   * The other two SUNSET rows were re-derived against the narrowed definition
   * and stay — prop-316#freeze-window ends on a stated date, and
   * prop-319#ten-year-renewal is renewal in the strict sense.
   *
   * The total is unchanged at 52, which is the check that matters: a kind
   * change that altered the number of provisions would mean a provision had
   * been invented or dropped, and both are claims about a real measure.
   */
  assert.deepEqual(byKind, {
    FUNDING: 10,
    PROGRAM: 26,
    OVERSIGHT: 12,
    SUNSET: 2,
    START: 2,
  });
  assert.equal(
    Object.values(byKind).reduce((a, b) => a + b, 0),
    52,
    "the kinds no longer sum to the provision count",
  );

  // Every measure has at least one provision; the largest is Proposition 212.
  const perContest = new Map<string, number>();
  for (const provision of MEASURE_PROVISIONS) {
    perContest.set(provision.contestId, (perContest.get(provision.contestId) ?? 0) + 1);
  }
  for (const [contestId, n] of perContest) {
    assert.ok(n >= 1, `${contestId} has no provisions`);
  }
  assert.equal(perContest.get("ballot-az-pima:prop-212"), 11);
  assert.equal(perContest.get("ballot-az-pima:prop-141"), 3);
});

test("Proposition 141's absences survive the fifth kind", () => {
  /*
   * RULING 7C, 5e. Proposition 141 has no oversight and no clock, and that is a
   * MEASURED absence in the Legislative Council's own enumeration rather than a
   * gap in our reading. A new kind must not quietly fill it: the failure mode of
   * adding a bucket is that something gets swept into it to make the taxonomy
   * look complete, and a manufactured provision is a false claim about a real
   * measure.
   *
   * If 141 ever does gain a kind, that is a finding requiring evidence from the
   * analysis — not a default, and not this test being relaxed.
   */
  const kinds = MEASURE_PROVISIONS.filter(
    (p) => p.contestId === "ballot-az-pima:prop-141",
  ).map((p) => p.kind);

  assert.deepEqual(
    kinds.slice().sort(),
    ["FUNDING", "PROGRAM", "PROGRAM"],
    "Proposition 141's provision kinds changed",
  );
  for (const absent of ["OVERSIGHT", "SUNSET", "START"] as const) {
    assert.ok(
      !kinds.includes(absent),
      `Proposition 141 gained a ${absent} provision. It has none in the analysis — ` +
        "if this is real it needs the citation, and if it is not it is an invented claim.",
    );
  }

  /* And no provision of 141's carries a date at all, which is WHY it has no
   * clock. Asserted on the text rather than on the kind, so a mis-kinded
   * provision cannot satisfy both halves by accident. */
  for (const provision of MEASURE_PROVISIONS.filter(
    (p) => p.contestId === "ballot-az-pima:prop-141",
  )) {
    assert.ok(
      !/\b(19|20)\d{2}\b/.test(provision.what),
      `${provision.id} carries a year, so 141 may have a clock after all`,
    );
  }
});

test("the fifth kind's name and label carry no stance", () => {
  /*
   * A kind whose name implies a provision is good or bad tilts every reaction
   * it collects. That is the vote-recommendation ban arriving through the back
   * door of a taxonomy, and it is treated with the same seriousness.
   *
   * The labels are also what a reader sees, so they take the 15-year-old test:
   * plain words, no identifier, no jargon.
   */
  const LOADED =
    /\b(good|bad|better|worse|best|worst|fair|unfair|safe|risky|reform|loophole|protect|threat|burden|relief|giveaway|handout|common.?sense)\b/i;
  for (const [kind, label] of Object.entries(PROVISION_KIND_LABEL)) {
    assert.doesNotMatch(label, LOADED, `${kind}'s label takes a side: "${label}"`);
    assert.doesNotMatch(
      label,
      /[A-Z]{2,}|_|ocd-division/,
      `${kind}'s label reads like an identifier: "${label}"`,
    );
    assert.ok(label.length <= 40, `${kind}'s label is too long to sit on a chip: "${label}"`);
  }

  /* The two clock kinds must not read as each other — the whole point of 7C is
   * that "does this expire" and "when does this start" are different questions
   * and were being answered by one bucket. */
  assert.notEqual(PROVISION_KIND_LABEL.SUNSET, PROVISION_KIND_LABEL.START);
  assert.match(PROVISION_KIND_LABEL.START, /starts/i);
  assert.match(PROVISION_KIND_LABEL.SUNSET, /ends|renew/i);
});
