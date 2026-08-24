/**
 * The `wikipedia-citation-follow` route — guarding the discipline, not the yield.
 *
 * RULING 87 says an encyclopedia NAMES a person and the citation PROVES them.
 * This route is the confirming step; the guards here are about the ways it
 * could quietly stop being one.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Row {
  entity: string;
  name: string;
  officeTitle: string;
  citationUrls: string[];
  confirmedBy: string | null;
  confirmedByHost: string | null;
  hostBasis: string;
  branch: string;
  verdict: string;
  officeNamed: boolean;
  formsSearched: { form: string; kind: string; matched: boolean }[];
  detail: string;
  attemptedAt: string;
  walkedAtRung: number;
}

const walk = JSON.parse(
  readFileSync(join(process.cwd(), "data/hunt/wiki-citation-follow.json"), "utf8"),
) as { walkedAt: string; tally: Record<string, number>; rows: Row[] };

describe("the wikipedia-citation-follow route", () => {
  it("walked every parked lead and produced a row for each", () => {
    // RULING 100: a partial that reconciles is still a wrong answer.
    const total = Object.values(walk.tally).reduce((a, b) => a + b, 0);
    assert.equal(total, walk.rows.length);
    assert.ok(walk.rows.length >= 9, `expected the 9 parked leads, got ${walk.rows.length}`);
  });

  it("never confirms from the encyclopedia itself", () => {
    // The whole point of the route. A citation resolving back to Wikipedia
    // would be the article proving itself.
    for (const r of walk.rows) {
      if (!r.confirmedByHost) continue;
      assert.ok(
        !/wikipedia\.org$|wikimedia\.org$|wikidata\.org$/.test(r.confirmedByHost),
        `${r.name} was "confirmed" by ${r.confirmedByHost} — an encyclopedia cannot prove itself`,
      );
    }
  });

  it("requires the person AND the office together before confirming", () => {
    // A page naming only the person confirms nothing about the seat, and a
    // page naming only the office confirms nothing about the person.
    for (const r of walk.rows) {
      if (r.verdict !== "CONFIRMED_OFFICIAL" && r.verdict !== "PRESS_CONFIRMED") continue;
      assert.ok(r.officeNamed, `${r.name}: confirmed without the office being named`);
      assert.ok(
        r.formsSearched.some((f) => f.matched && f.kind !== "surname"),
        `${r.name}: confirmed on a surname alone, which any relative would also match`,
      );
    }
  });

  it("keeps a government source and a press source apart", () => {
    // Collapsing the two would let a decade-old election-night article ship as
    // a current roster.
    for (const r of walk.rows) {
      if (r.verdict === "CONFIRMED_OFFICIAL") {
        assert.notEqual(
          r.hostBasis,
          "not named as official by any authority outside us",
          `${r.name}: CONFIRMED_OFFICIAL on a host no authority names as official`,
        );
      }
      if (r.verdict === "PRESS_CONFIRMED") {
        assert.equal(r.hostBasis, "not named as official by any authority outside us");
      }
    }
  });

  it("records WHY a host counted as official, on every row", () => {
    // A verdict whose basis is not written down cannot be audited, and this
    // one turns on an authority outside us rather than on a TLD.
    for (const r of walk.rows) assert.ok(r.hostBasis.length > 0, `${r.name}: no hostBasis`);
  });

  it("names which branch answered, so two are visibly independent", () => {
    // RULING 52: independence is counted over distinct dependencies. A row that
    // could not say which branch reached it could not support that claim.
    for (const r of walk.rows) {
      assert.ok(
        ["wikipedia-footnote", "state-directory", "none"].includes(r.branch),
        `${r.name}: branch "${r.branch}" is not one of the named branches`,
      );
    }
  });

  it("states a date and a rung on every row, confirmed or not", () => {
    // RULING 52 and RULING 53: an absence names its branches and its date.
    for (const r of walk.rows) {
      assert.match(r.attemptedAt, /^\d{4}-\d{2}-\d{2}$/, r.name);
      assert.ok(r.walkedAtRung > 0, `${r.name}: no rung recorded`);
      assert.ok(r.detail.length > 20, `${r.name}: no detail recorded`);
    }
  });

  it("asserts no absence — an unconfirmed lead stays a lead", () => {
    // The vocabulary is the guard. None of these verdicts may be a claim that
    // the person does not hold the office.
    const allowed = new Set([
      "CONFIRMED_OFFICIAL",
      "PRESS_CONFIRMED",
      "CITATION_SILENT",
      "CITATION_UNREACHABLE",
      "NO_CITATION",
    ]);
    for (const r of walk.rows) {
      assert.ok(allowed.has(r.verdict), `${r.name}: unknown verdict ${r.verdict}`);
      assert.ok(
        !/VERIFIED_ABSENT|DOES NOT HOLD|NOT THE MAYOR/i.test(r.detail),
        `${r.name}: the detail asserts an absence`,
      );
    }
  });
});
