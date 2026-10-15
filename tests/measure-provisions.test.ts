import assert from "node:assert/strict";
import test from "node:test";

import {
  PROVISION_KIND_LABEL,
  provisionById,
  provisionsForContest,
  type ProvisionKind,
} from "../lib/ballot/measure-provisions.ts";
import { measureRecordsForBallot } from "../lib/ballot/measure-records.ts";
import { summaryForContest } from "../lib/ballot/measure-summary.ts";
import { azBallot } from "./helpers/ballot-district-fixtures.ts";

const records = measureRecordsForBallot(azBallot);
const provisions = records.flatMap(record => provisionsForContest(record.contestId, records));
const summaries = records.map(record => summaryForContest(record.contestId, records)!);

const KINDS: ProvisionKind[] = [
  "FUNDING",
  "PROGRAM",
  "OVERSIGHT",
  "SUNSET",
  "START",
];

test("a provision's summary and its measure's summary cite the same document", () => {
  for (const summary of summaries) {
    const provisions = provisionsForContest(summary.contestId, records);
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
  for (const provision of provisions) {
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
    assert.equal(provisionById(provision.id, records)?.id, provision.id);
  }
  assert.equal(provisionById("ballot-az-pima:prop-141#not-a-provision", records), null);
});

test("every kind is one of the five, and every kind has a reader-facing label", () => {
  for (const provision of provisions) {
    assert.ok(
      KINDS.includes(provision.kind),
      `${provision.id} carries the kind ${provision.kind}, which is not one of the five`,
    );
  }
  for (const kind of KINDS) {
    const label = PROVISION_KIND_LABEL[kind];
    assert.ok(label && label.length > 0, `${kind} has no reader-facing label`);
    assert.notEqual(label, kind, `${kind}'s label is the enum value itself`);
    assert.doesNotMatch(label, /^[A-Z_]+$/, `${kind}'s label reads like an identifier`);
  }
});

test("no provision advocates, ranks, or recommends", () => {
  // These are descriptions of what a measure would do; saying whether that is good is a recommendation.
  const ADVOCACY =
    /\b(should|must vote|vote (?:yes|no)|we recommend|recommended|best choice|good for|bad for|harmful|beneficial|dangerous|common ?sense|extreme|radical|reasonable|fair(?:er|est)?|unfair|protects? (?:us|you)|attacks?)\b/i;
  const offenders: string[] = [];
  for (const provision of provisions) {
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
  for (const provision of provisions) {
    for (const text of [provision.label, provision.what]) {
      assert.doesNotMatch(text, /ocd-division\//, `${provision.id} renders an OCD-ID`);
      assert.doesNotMatch(text, /ballot-az-pima:/, `${provision.id} renders a contest id`);
      assert.doesNotMatch(text, /\b[A-Z]{2,}_[A-Z_]+\b/, `${provision.id} renders an enum value`);
    }
  }
});

test("every provision says something, and says it in plain language", () => {
  for (const provision of provisions) {
    assert.ok(provision.label.trim().length >= 8, `${provision.id}: label is too thin to read`);
    assert.ok(provision.what.trim().length >= 40, `${provision.id}: 'what' is too thin to read`);
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
  // Measured, not expected: not every measure has every kind, and manufacturing one would invent a claim.
  const byKind: Record<string, number> = {};
  for (const provision of provisions) {
    byKind[provision.kind] = (byKind[provision.kind] ?? 0) + 1;
  }
  assert.equal(provisions.length, 52, `provision count changed: ${provisions.length}`);
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

  const perContest = new Map<string, number>();
  for (const provision of provisions) {
    perContest.set(provision.contestId, (perContest.get(provision.contestId) ?? 0) + 1);
  }
  for (const [contestId, n] of perContest) {
    assert.ok(n >= 1, `${contestId} has no provisions`);
  }
  assert.equal(perContest.get("ballot-az-pima:prop-212"), 11);
  assert.equal(perContest.get("ballot-az-pima:prop-141"), 3);
});

test("Proposition 141's absences survive the fifth kind", () => {
  // Proposition 141 has no oversight and no clock in its analysis; a new kind must not fill that absence.
  const kinds = provisions.filter(
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

  /* No provision of 141 carries a date; asserted on the text so a mis-kinded provision cannot satisfy both halves. */
  for (const provision of provisions.filter(
    (p) => p.contestId === "ballot-az-pima:prop-141",
  )) {
    assert.ok(
      !/\b(19|20)\d{2}\b/.test(provision.what),
      `${provision.id} carries a year, so 141 may have a clock after all`,
    );
  }
});

test("the fifth kind's name and label carry no stance", () => {
  // A kind whose name implies a stance tilts every reaction it collects.
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

  /* The two clock kinds answer different questions and must not read as each other. */
  assert.notEqual(PROVISION_KIND_LABEL.SUNSET, PROVISION_KIND_LABEL.START);
  assert.match(PROVISION_KIND_LABEL.START, /starts/i);
  assert.match(PROVISION_KIND_LABEL.SUNSET, /ends|renew/i);
});
