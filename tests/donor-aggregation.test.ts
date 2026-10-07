/**
 * Donor rendering is aggregate only: no individual donor name or address renders anywhere.
 *
 *  1. The aggregator is correct: the parts equal the whole.
 *  2. The render sites do not name an individual. Asserted over the component source, by shape, because the defect
 *     is a JSX expression that puts `contributorName` on screen and no runtime assertion over grouped data can see
 *     one. It is checked on the outer "Individual donors" column and independently on the second-hop panel.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { aggregateIndividuals, mayRenderFiledLocation, mayRenderFiledName } from "../lib/funding/donor-privacy.ts";
import type { ContributorGroup } from "../lib/funding/grouping.ts";
import { groupContributions } from "../lib/funding/grouping.ts";
import type { ContributionRow } from "../lib/funding/types.ts";

const ROOT = join(import.meta.dirname, "..");

function row(over: Partial<ContributionRow>): ContributionRow {
  return {
    dataClass: "FEC_CONTRIBUTOR",
    kind: "INDIVIDUAL",
    contributorName: "DOE, JANE",
    amount: 100,
    receiptDate: "2026-01-05",
    city: "Concord",
    state: "NH",
    entityType: "IND",
    lineNumber: "11AI",
    committeeType: null,
    organizationType: null,
    designation: null,
    contributorCommitteeId: null,
    ...over,
  } as ContributionRow;
}

test("the aggregate's parts equal its whole", () => {
  const groups = groupContributions([
    row({ contributorName: "DOE, JANE", amount: 250, state: "NH" }),
    row({ contributorName: "DOE, JANE", amount: 250, state: "NH" }),
    row({ contributorName: "ROE, RICHARD", amount: 500, state: "MA" }),
    row({ contributorName: "NOSTATE, PAT", amount: 40, state: null, city: null }),
    row({
      kind: "COMMITTEE_OR_ORGANIZATION",
      contributorName: "SOME PAC",
      amount: 9_000,
      entityType: "PAC",
    }),
  ]);

  const agg = aggregateIndividuals(groups.individuals);

  assert.equal(agg.donors, 3, "three distinct individual filers");
  assert.equal(agg.filings, 4, "four filings, two of them folded into one donor");
  assert.equal(agg.amount, 1_040, "the committee's 9,000 is not individual money");
  assert.equal(
    agg.byState.reduce((s, x) => s + x.amount, 0),
    agg.amount,
    "the state rollup sums to the total — a reader shown two figures that do not " +
      "reconcile has been given a third, invented one",
  );
  assert.equal(
    agg.byState.reduce((s, x) => s + x.donors, 0),
    agg.donors,
    "and so does the donor count",
  );
  assert.equal(agg.byState.at(-1)?.state, null, "the unstated bucket sorts last however large");
});

test("the candidate's own money is a SUBSET of the total, not a sibling of it", () => {
  const groups = groupContributions([
    row({ contributorName: "CANDIDATE, A", amount: 5_000, entityType: "CAN" }),
    row({ contributorName: "DOE, JANE", amount: 1_000 }),
  ]);
  const agg = aggregateIndividuals(groups.individuals);
  assert.equal(agg.amount, 6_000);
  assert.equal(agg.candidateOwnMoney, 5_000);
  assert.ok(agg.candidateOwnMoney < agg.amount, "a subset, so the panel can say what came from other people");
});

test("an individual may never render a filed name or a filed place; an organization may", () => {
  assert.equal(mayRenderFiledName({ kind: "INDIVIDUAL" } as ContributorGroup), false);
  assert.equal(mayRenderFiledLocation({ kind: "INDIVIDUAL" } as ContributorGroup), false);
  assert.equal(mayRenderFiledName({ kind: "COMMITTEE_OR_ORGANIZATION" } as ContributorGroup), true);
  assert.equal(
    mayRenderFiledLocation({ kind: "COMMITTEE_OR_ORGANIZATION" } as ContributorGroup),
    true,
    "the organizations-render-as-filed rule is untouched by RULING 167",
  );
});

const FUNDING_SECTION = join(ROOT, "components/funding/funding-section.tsx");

/**
 * The shapes a reader-facing individual-donor row takes: a JSX expression rendering a contributor's filed name into a
 * list that includes individuals, never one particular spelling.
 */
const NAMES_A_CONTRIBUTOR = [
  /\{\s*group\.contributorName\s*\}/,
  /\{\s*row\.contributorName\s*\}/,
  /\{\s*[A-Za-z]+\.contributorName\s*\}/,
];

test("the funding section renders no contributor name that could be an individual", () => {
  const src = readFileSync(FUNDING_SECTION, "utf8");

  // The list handed to ContributorRow must be organizations only: the outer "Individual donors" column.
  assert.ok(
    src.includes("aggregateIndividuals(data.contributorGroups.individuals)"),
    "the outer individual column renders an aggregate, not rows",
  );
  assert.ok(
    !/groups=\{data\.contributorGroups\.individuals\}/.test(src),
    "no ContributorColumn is handed the individual groups",
  );

  // The independent case: the second-hop panel, which folds a joint fundraiser's own book.
  assert.ok(
    !/\[\s*\.\.\.folded\.organizations\s*,\s*\.\.\.folded\.individuals\s*\]/.test(src),
    "the second-hop panel no longer concatenates individuals into its rendered rows — " +
      "this is the case the fix was not derived from, and the one a fix aimed at the " +
      "outer column would have left standing",
  );
  assert.ok(
    src.includes("aggregateIndividuals(folded.individuals)"),
    "the second-hop panel aggregates its individuals instead",
  );

  // Every surviving `contributorName` render must sit inside a code path that cannot receive an individual.
  const renders = NAMES_A_CONTRIBUTOR.flatMap((shape) => [...src.matchAll(new RegExp(shape, "g"))]);
  assert.ok(
    renders.length > 0,
    "the sweep matched no contributor-name render at all — that is a broken sweep, " +
      "not a clean surface, because the organizations column legitimately renders one",
  );
  for (const m of renders) {
    const before = src.slice(0, m.index ?? 0);
    const fn = before.lastIndexOf("function ");
    const fnName = /function\s+([A-Za-z0-9_]+)/.exec(src.slice(fn, fn + 80))?.[1] ?? "?";
    assert.ok(
      fnName === "ContributorRow" || fnName === "SecondHopPanel",
      `a contributor name renders inside ${fnName}, which this guard does not know to be ` +
        "organizations-only. Either it is a new individual-donor surface, or the guard is stale.",
    );
  }
});

/** Positive control: a planted source string in the shape the defect took must be flagged. */
test("the shape sweep catches a planted individual-donor row", () => {
  const planted = `
    function IndividualDonors({ groups }: { groups: ContributorGroup[] }) {
      return groups.map((group) => (
        <li key={group.key}>
          {group.contributorName}
          <span> · {group.city}, {group.state}</span>
        </li>
      ));
    }
  `;
  const hits = NAMES_A_CONTRIBUTOR.flatMap((shape) => [...planted.matchAll(new RegExp(shape, "g"))]);
  assert.ok(hits.length > 0, "the sweep must flag a contributor name rendered from a group");
  const fnName: string | undefined = /function\s+([A-Za-z0-9_]+)/.exec(planted)?.[1];
  assert.equal(fnName, "IndividualDonors");
  assert.ok(
    !["ContributorRow", "SecondHopPanel"].includes(fnName ?? ""),
    "and it must NOT be one of the two functions the real guard allows",
  );
});
