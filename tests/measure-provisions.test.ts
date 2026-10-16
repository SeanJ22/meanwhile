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
import { azBallot, azPlaceMeasures } from "./helpers/ballot-district-fixtures.ts";

const ballots = [azBallot, ...azPlaceMeasures.flatMap(place => Object.values(place.ballots))];
const records = ballots.flatMap(ballot => measureRecordsForBallot(ballot));
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

test("every source provision has readable text and a concise label", () => {
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

test("state and place provisions preserve each held source part without invented kinds", () => {
  const byKind: Record<string, number> = {};
  for (const provision of provisions) {
    byKind[provision.kind] = (byKind[provision.kind] ?? 0) + 1;
  }
  assert.equal(provisions.length, 17, `provision count changed: ${provisions.length}`);
  assert.deepEqual(byKind, { PROGRAM: 17 });
  assert.equal(
    Object.values(byKind).reduce((a, b) => a + b, 0),
    17,
    "the kinds no longer sum to the provision count",
  );

  const perContest = new Map<string, number>();
  for (const provision of provisions) {
    perContest.set(provision.contestId, (perContest.get(provision.contestId) ?? 0) + 1);
  }
  for (const record of records) {
    assert.equal(perContest.get(record.contestId), record.parts.length);
    for (const part of record.parts) {
      const actual = provisionById(part.id, records)!;
      assert.deepEqual(actual, {
        id: part.id, contestId: record.contestId, kind: part.kind, label: part.label,
        what: part.what, citesUrl: record.sourceUrl, writtenAt: record.writtenAt,
      });
    }
  }
  assert.equal(perContest.get("ballot-az-pima:prop-141"), 1);
  assert.equal(perContest.get("ballot-az-pima:prop-423"), 2);
  assert.equal(perContest.get("ballot-az-pima:prop-425"), 2);
  assert.equal(perContest.get("ballot-az-pima:prop-428"), 3);
  assert.equal(perContest.get("ballot-az-pima:prop-429"), 2);
  for (const held of [143, 145, 212]) assert.equal(perContest.has(`ballot-az-pima:prop-${held}`), false);
});

test("Proposition 141 gains no oversight or clock claims from provision kinds", () => {
  const kinds = provisions.filter(
    (p) => p.contestId === "ballot-az-pima:prop-141",
  ).map((p) => p.kind);

  assert.deepEqual(
    kinds.slice().sort(),
    ["PROGRAM"],
    "Proposition 141's provision kinds changed",
  );
  for (const absent of ["OVERSIGHT", "SUNSET", "START"] as const) {
    assert.ok(
      !kinds.includes(absent),
      `Proposition 141 gained a ${absent} provision without a source-bound part`,
    );
  }

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
