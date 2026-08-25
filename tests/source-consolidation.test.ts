import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { sourceCreditFor } from "../lib/meetings/list-attribution.ts";
import type { Meeting } from "../lib/sources/types.ts";

const ROOT = process.cwd();

/**
 * **ITEM 3 (2026-08-24) — THE CONSTITUTIONAL GUARD ON A DISPLAY CHANGE.**
 *
 * SRC-1 through SRC-4 consolidate every inline asterisk and per-item source
 * annotation into one line at the bottom of each card. The brief states the
 * limit of that in as many words, and it is the whole reason this file exists:
 *
 *   > this is a display consolidation. Every fact keeps its provenance in the
 *   > data — footnotes, source URLs, fetch dates are never deleted. The change
 *   > is what renders, not what is held.
 *
 * Those two are one careless edit apart. A session told to "remove the source
 * annotations" can satisfy every visual check by deleting the fields, and
 * nothing else in this repo would go red — the cards would look exactly as
 * the author asked, and the product would have quietly stopped being able to
 * say where anything came from.
 *
 * So this asserts the pair directly: the populated provenance of a meeting set
 * is IDENTICAL before and after the consolidation runs over it. Not "the
 * function does not mutate" as a claim about its style — the actual field
 * values, compared.
 */

/** A meeting carrying a full provenance record, as the snapshot ships them. */
function row(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: "m1",
    title: "Governing Board Agenda Special Meeting",
    bodyName: "Governing Board Agenda Special Meeting",
    jurisdiction: "Tucson Unified School District, AZ",
    startsAt: "2026-08-25T23:30:00.000Z",
    timeZone: "America/Phoenix",
    status: "SCHEDULED",
    ocdId: "ocd-division/country:us/state:az/school_district:tucson_unified_district",
    agendaUrl: "https://example.gov/agenda/1",
    location: null,
    provenance: {
      sourceOrg: "TUSD Governing Board",
      sourceUrl: "https://example.gov/meetings",
      collectedAt: "2026-08-24T05:00:00.000Z",
    },
    ...overrides,
  } as Meeting;
}

/** Every provenance field that is actually populated, per row, in order. */
function provenanceOf(meetings: readonly Meeting[]) {
  return meetings.map((m) => {
    const p = m.provenance as unknown as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(p).filter(([, v]) => v !== undefined && v !== null),
    );
  });
}

test("SRC: consolidating the DISPLAY leaves every provenance field exactly as it was", () => {
  const meetings = [
    row(),
    row({
      id: "m2",
      bodyName: "Audit Committee",
      provenance: {
        sourceOrg: "TUSD Audit Committee",
        sourceUrl: "https://example.gov/audit",
        collectedAt: "2026-08-24T05:00:00.000Z",
        secondHand: true,
      },
    } as Partial<Meeting>),
  ];

  const before = JSON.parse(JSON.stringify(provenanceOf(meetings)));
  const credit = sourceCreditFor(meetings);
  const after = provenanceOf(meetings);

  assert.deepEqual(
    after,
    before,
    "the source consolidation changed the provenance held on the meetings",
  );

  // And it is genuinely doing the display job, so this is not a test that
  // passes because nothing happened.
  assert.equal(credit.kind, "multi");
  assert.equal(credit.sources.length, 2);

  // Every source org that was in the data is still nameable from the credit.
  const credited = new Set(credit.sources.map((s) => s.sourceOrg));
  for (const m of meetings) {
    assert.ok(
      credited.has(m.provenance.sourceOrg),
      `${m.provenance.sourceOrg} was dropped from the credit`,
    );
  }
});

test("SRC: the single-source form still names its source in full, verbatim", () => {
  // A consolidation that shortened, abbreviated or re-derived the publisher's
  // name would be characterising it — which the organizations-render-as-filed
  // rule forbids just as firmly as dropping it would be.
  const org = "Rockaway Township Board of Adjustment";
  const credit = sourceCreditFor([
    { jurisdiction: "Rockaway Township, NJ", provenance: { sourceOrg: org } },
  ]);
  assert.ok(
    credit.lead.includes(org),
    `the credit line does not name the publisher verbatim: ${credit.lead}`,
  );
});

test("SRC: no source-carrying field was deleted from the meeting type", () => {
  // The cheapest way to make the cards look right is to stop carrying the
  // data. This reads the type itself so that edit cannot pass quietly.
  const types = readFileSync(join(ROOT, "lib", "sources", "types.ts"), "utf8");
  for (const field of ["sourceUrl", "sourceOrg", "collectedAt"]) {
    assert.match(
      types,
      new RegExp(`\\b${field}\\b`),
      `Meeting provenance no longer carries ${field} — the display consolidation deleted the record`,
    );
  }
});
