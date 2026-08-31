/**
 * SHARED CONTROL-PLANE TEST FIXTURES — one builder per shape, not four.
 *
 * ## Why this file exists
 *
 * `pnpm dupes` caught two byte-identical pairs the moment the 2026-08-29 session
 * integrated: `snapshot()` in both `control-plane-contract.test.ts` and
 * `control-plane-execution.test.ts`, and `fixtureCoverage()` in both
 * `control-plane-campaign-finance.test.ts` and `filing-regime-registry.test.ts`.
 * Two workstreams, working in parallel on disjoint files, each needed the same
 * builder and each wrote it.
 *
 * RULING 103 offers two remedies: fix at the shared code path, or record the
 * group with a reason it must stay separate. This is the first, and it is the
 * right one here — these are not two things that happen to look alike, they are
 * one thing written twice.
 *
 * ## The duplication was not cosmetic, and that is the argument for the module
 *
 * `completionSnapshot()` supplies the DEFAULTS a `CompletionSnapshot` takes when
 * a test does not care: no route tasks, no validations, no audits, no
 * contradictions, no upstreams, and — the load-bearing one —
 * `denominatorComplete: null`. That null is a governed default: `null` means "not
 * established", and only an affirmative `true` satisfies the coverage clause. A
 * second copy of these defaults is a second place that value can be softened to
 * `true` by a session that finds a test inconvenient, and the softening would be
 * invisible in the file where the assertion lives.
 *
 * The same is true of `coverageFixture()`. `filingRegimeState` is REQUIRED on
 * `CampaignFinanceCoverage` rather than defaulted, precisely so a caller who does
 * not know which authority governs a contest cannot silently look like one who
 * does. The fixture states `RESOLVED` explicitly. One copy of that decision is
 * auditable; two are a place for them to drift apart.
 *
 * ## Not a `.test.ts` file, on purpose
 *
 * `package.json`'s test script globs `tests/**\/*.test.ts`, so this module is
 * imported and never executed as a suite — the same arrangement
 * `tests/method-fixtures.ts` already uses.
 */

import type { CompletionSnapshot } from "../lib/control-plane/completion.ts";
import type { CampaignFinanceCoverage } from "../lib/control-plane/campaign-finance/model.ts";

/**
 * The fixed instants the control-plane suites share.
 *
 * Named rather than inlined because every module in `lib/control-plane` takes
 * time as a PARAMETER and reads no clock; a test that wrote `new Date()` would
 * be testing something the library cannot do. T0 opens, T1 is five minutes in
 * (an attempt's span), T2 is thirty minutes in (after a lease would have
 * expired).
 */
export const T0 = "2026-08-28T00:00:00.000Z";
export const T1 = "2026-08-28T00:05:00.000Z";
export const T2 = "2026-08-28T00:30:00.000Z";

/**
 * A `CompletionSnapshot` with every clause at its SAFE default.
 *
 * The caller supplies the `item` and overrides only what the test is about.
 * Everything else is the reading that REFUSES: an empty audit list does not
 * discharge an audit requirement, an absent upstream is UNRESOLVED rather than
 * satisfied, and `denominatorComplete: null` is "not established" rather than
 * complete. A fixture whose defaults were permissive would let a test pass for
 * reasons the test never stated.
 */
export function completionSnapshot(
  over: Partial<CompletionSnapshot> & Pick<CompletionSnapshot, "item">,
): CompletionSnapshot {
  return {
    routeTasks: [],
    validations: [],
    audits: [],
    contradictions: [],
    upstreamStates: new Map(),
    denominatorComplete: null,
    /* No instrument-evidence contract in this fixture; the empty set is the
       refusing default, stated rather than omitted. */
    instrumentGreens: new Set<string>(),
    now: T2,
    ...over,
  };
}

/**
 * A `CampaignFinanceCoverage` record with empty universes and an OPEN status.
 *
 * `filingRegimeState: "RESOLVED"` is STATED here rather than defaulted in the
 * model. The model requires the field so that an unresolved filing authority
 * cannot be mistaken for a resolved one; a fixture that omitted it would be
 * asking the type system for the very default the model refuses to provide.
 */
export function coverageFixture(
  over: Partial<CampaignFinanceCoverage> & { contestId: string },
): CampaignFinanceCoverage {
  return {
    contestTitle: "fixture contest",
    electionId: "fixture:election",
    electionDate: "2026-11-03",
    jurisdictionOcdId: "ocd-division/country:us/state:az",
    officeLevel: "COUNTY",
    filingRegimeState: "RESOLVED",
    filingRegimeId: "fixture:regime",
    candidateUniverse: [],
    candidateUniverseSource: "fixture",
    committeeUniverse: [],
    expectedFilingAuthorityIds: [],
    expectedFilingPeriods: [],
    filingsAcquired: [],
    filingsMissing: [],
    latestThroughDate: null,
    perCandidate: [],
    routes: [],
    identityGaps: [],
    amendmentGaps: [],
    status: "OPEN",
    completeAsOf: null,
    ...over,
  };
}
