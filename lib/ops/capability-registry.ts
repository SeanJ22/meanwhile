/**
 * **THE CAPABILITY REGISTRY — what we claim, and what would prove it.**
 * (A.1 WI6, 2026-08-30.)
 *
 * ## The split, and why the old single file could not work
 *
 * `lib/ops/status-ledger.ts` held both halves of a status surface in one
 * hand-typed array. A row carried the capability AND the result:
 *
 * ```
 *   lastResult: "suite green in the workstream run that generated this ledger"
 *   proofClass: "SESSION_MEASURED"
 *   asOf:       "2026-08-30"
 *   sha:        "—"
 * ```
 *
 * Those are not results. They are sentences a person typed, and
 * `pnpm status:ledger --check` verified that the rendered Markdown matched the
 * array — which proves the document equals its own source and says NOTHING
 * about whether any named check currently passes. The committed ledger said
 * HEAD `e62c420` while the release was `096e0469`, and every gate was green.
 *
 * So the two halves separate, and the separation IS the repair:
 *
 * ```
 *   THIS FILE               curated, static, hand-written, reviewed
 *                           "capability X is proven by check Y"
 *
 *   lib/ops/status-result.ts   derived, never typed
 *                           "check Y last ran on SHA S at T, result R"
 * ```
 *
 * **No string in this file can produce a GREEN.** There is deliberately
 * nowhere here to write one: a row names a check and stops. Whether that check
 * passed is answered by reading a run record, and a capability whose check has
 * no run record renders UNPROVEN — a fact about our instrumentation, never
 * about the capability.
 *
 * ## Why `provenBy` is typed rather than prose
 *
 * The old `provingCheck` was a sentence: *"tests/cascade.test.ts and
 * tests/concluded.test.ts, run by `pnpm test`"*. A resolver would have to
 * parse English to find what to look up, and a resolver that parses English
 * fails open. The proof source is now a discriminated union naming the
 * instrument and the identity, so resolution is a lookup and an unresolvable
 * row is visibly unresolvable.
 */

// TYPE-ONLY: the render-target vocabulary is declared once, in
// `lib/health/reader-question.ts`, and this file consumes it rather than
// keeping a second copy. Erased at compile time, so nothing about the health
// module is pulled into the status surface at runtime.
import type { EvaluationTarget } from "../health/reader-question.ts";

/** Where the evidence for a capability comes from, and what identity to find. */
export type ProofSource =
  /**
   * Test files, proven by the `test` gate. The files are named so a reader can
   * open them; the VERDICT comes from the gate run record, because `pnpm test`
   * runs the whole suite and a per-file result does not exist to read.
   */
  | { readonly kind: "SUITE"; readonly testFiles: readonly string[] }
  /** A named gate in `scripts/gates.mjs` — lint, tsc, build, governance:check. */
  | { readonly kind: "GATE"; readonly gateId: string }
  /** Named check identities in the standing walk (`docs/walk-checks.txt`). */
  | { readonly kind: "WALK"; readonly checkIdentities: readonly string[] }
  /** Named reader-question instances, proven by a canonical reader-suite run. */
  | { readonly kind: "READER_SUITE"; readonly instanceIds: readonly string[] };

export interface CapabilityEntry {
  /** Stable id, so a row survives rewording and the ledger stays diffable. */
  readonly id: string;
  /** The assertion, plain language. */
  readonly capability: string;
  /**
   * What proves it. `null` means UNPROVEN — no such check is NAMED, which is a
   * fact about the project's instrumentation, not about the capability.
   */
  readonly provenBy: ProofSource | null;
  /** Required when `provenBy` is null: the check that needs to exist. */
  readonly neededCheck?: string;
  /** Where a reader goes to read the claim's own basis. Never a result. */
  readonly evidence: string;
  /**
   * For reader-facing claims: what a proving run must render against.
   *
   * IMPORTED, NOT RESTATED (RULING 103). This was an inline union spelling out
   * the same two members `EVALUATION_TARGETS` declares, and a second copy of a
   * vocabulary is a drift waiting to happen: the day a third target was added
   * to the real list — `STAGING_RENDER`, 2026-09-01 — this copy would have gone
   * on typing rows against a two-member universe, and a row naming the new
   * target would have failed to compile for a reason that says nothing about
   * what is wrong.
   */
  readonly target?: EvaluationTarget;
}

/**
 * Every capability the project currently asserts on a CURRENT-status surface.
 *
 * A row may never soften UNPROVEN, invent a check-to-claim mapping, or restate
 * a volatile count as current. The current value of anything that moves lives
 * in the file that moves.
 */
export const CAPABILITY_REGISTRY: readonly CapabilityEntry[] = [
  {
    id: "entry-screen-answers",
    capability:
      "The entry screen answers at the four pilot zips: the map renders, who-governs is grouped Local / State / Federal, and the meeting panel is wired to GET /api/meetings.",
    provenBy: {"kind":"WALK","checkIdentities":["[0814c] 03255: the map answers with something about this place","[0814c] 07866: the map answers with something about this place","[0814c] 85641: the map answers with something about this place","[0814c] 85701: the map answers with something about this place"]},
    evidence:
      "docs/state.md, the 2026-08-30 session record (“The standing walk, and what it said”); identity baseline docs/walk-checks.txt",
    target: "LOCAL_RENDER",
  },
  {
    id: "empty-state-cascade",
    capability:
      "The empty-state cascade (lib/meetings/query.ts) steps exact → widened → concluded → none, and the rung that produced the result is returned to the client as `tier` and shown on screen.",
    provenBy: {"kind":"SUITE","testFiles":["tests/cascade.test.ts","tests/concluded.test.ts"]},
    evidence:
      "tests/cascade.test.ts, tests/concluded.test.ts (committed checks; reproducible by `pnpm test`)",
  },
  {
    id: "tier-filtering",
    capability:
      "Local / State / National tier filtering is decided by OCD-ID segment depth against an explicit table (lib/ocd/tiers.ts), never by string-matching a label, and an unknown deepest segment returns null rather than inheriting its parent's tier.",
    provenBy: {"kind":"SUITE","testFiles":["tests/tiers.test.ts"]},
    evidence:
      "tests/tiers.test.ts (committed check; reproducible by `pnpm test`)",
  },
  {
    id: "zip-resolution",
    capability:
      "Zip resolution (lib/geo/zcta.ts) distinguishes malformed / unknown / uncovered, and the ZCTA centroid table is complete, so an unrecognized five-digit zip honestly reads as unknown rather than not-held-yet.",
    provenBy: {"kind":"SUITE","testFiles":["tests/zip-coverage.test.ts"]},
    evidence:
      "tests/zip-coverage.test.ts; lib/geo/zcta-centroids.json (the committed table)",
  },
  {
    id: "zoned-time",
    capability:
      "Local calendar date plus wall-clock time reassembles into a correct instant for an IANA zone (lib/time/zoned.ts), including across DST boundaries.",
    provenBy: {"kind":"SUITE","testFiles":["tests/zoned.test.ts"]},
    evidence:
      "tests/zoned.test.ts (committed check; reproducible by `pnpm test`)",
  },
  {
    id: "returning-reader",
    capability:
      "A returning reader's zip is remembered (hooks/use-stored-zip.ts) and confirmed or re-entered on return; the server renders a pending state so the entry notice never flashes before the stored zip loads.",
    provenBy: {"kind":"SUITE","testFiles":["tests/returning-reader.test.ts"]},
    evidence:
      "tests/returning-reader.test.ts (committed check; reproducible by `pnpm test`)",
  },
  {
    id: "registry-resolves",
    capability:
      "The division-and-body registry (lib/registry/) resolves a point to its divisions and the bodies they imply, and only its generator may write it.",
    provenBy: {"kind":"SUITE","testFiles":["tests/registry-oracle.test.ts","tests/registry-ownership.test.ts"]},
    evidence:
      "tests/registry-oracle.test.ts, tests/registry-ownership.test.ts; lib/registry/registry.json",
  },
  {
    id: "district-overlays",
    capability:
      "Six district overlay types draw from committed Census geometry — congressional national, everything below Congress clipped to the three pilot counties — with type-specific dash, weight and label zoom.",
    provenBy: {"kind":"SUITE","testFiles":["tests/districts.test.ts"]},
    evidence:
      "tests/districts.test.ts (committed check; reproducible by `pnpm test`)",
  },
  {
    id: "district-hit-set",
    capability:
      "A map click resolves the SET of districts containing the point: one hit selects, several open the picker grouped by tier, zero is a no-op — the reader's own click chooses, nothing is inferred from a zip centroid.",
    provenBy: {"kind":"SUITE","testFiles":["tests/district-hits.test.ts"]},
    evidence:
      "tests/district-hits.test.ts (committed check; reproducible by `pnpm test`)",
  },
  {
    id: "venue-grouping",
    capability:
      "Meetings at one venue group into one pin (lib/meetings/venues.ts, coordinates rounded to 4 dp), so a chamber hosting four sittings is not four stacked unclickable markers.",
    provenBy: null,
    neededCheck:
      "a named unit test over lib/meetings/venues.ts grouping (no tests/venues.test.ts exists; the retired §2 asserted this from code reading)",
    evidence:
      "docs/state.md §2 as it stood before retirement (git history)",
  },
  {
    id: "shoot-captures",
    capability:
      "scripts/shoot.mts captures the running app headlessly and prints what actually rendered, so a screenshot cannot quietly be of an empty map.",
    provenBy: null,
    neededCheck:
      "a check asserting the capture path fails loudly on an empty render (the walk consumes shoot-style captures but nothing named guards the instrument's own honesty)",
    evidence:
      "docs/state.md §2 as it stood before retirement (git history); scripts/shoot.mts",
  },
  {
    id: "meetings-api-validation",
    capability:
      "app/api/meetings/route.ts validates latitude/longitude ranges, clamps radiusKm to the widest ladder rung, and rejects unknown query params.",
    provenBy: null,
    neededCheck:
      "a route-handler test over app/api/meetings/route.ts validation via the alias loader (the handlers are testable directly; no test named for this route's validation was found)",
    evidence:
      "docs/state.md §2 as it stood before retirement (git history)",
  },
  {
    id: "composite-source",
    capability:
      "Meeting data is served by the composite source; the mock adapter is no longer active and remains only for fixture-driven tests, which pin WTP_MEETING_SOURCE=mock so the suite never touches the network.",
    provenBy: {"kind":"SUITE","testFiles":["tests/composite.test.ts"]},
    evidence:
      "tests/composite.test.ts; docs/state.md §3.1 as it stood before retirement (git history)",
  },
  {
    id: "fixture-provenance",
    capability:
      "No fixture invents provenance: every mock meeting URL is null or on the (empty) declared host allowlist, in the raw rows AND in normalize() output.",
    provenBy: {"kind":"SUITE","testFiles":["tests/fixture-provenance.test.ts"]},
    evidence:
      "tests/fixture-provenance.test.ts (committed check; reproducible by `pnpm test`)",
  },
  {
    id: "officeholder-surfaces",
    capability:
      "§3.4's claim that no officeholder data source exists is SUPERSEDED: the federal directory and officeholder surfaces shipped later and are under test.",
    provenBy: {"kind":"SUITE","testFiles":["tests/officeholders.test.ts","tests/officeholder-lookup.test.ts"]},
    evidence:
      "tests/officeholders.test.ts, tests/officeholder-lookup.test.ts",
  },
  {
    id: "status-is-generated",
    capability:
      "The current-status surface is GENERATED: this ledger is regenerated by handoff and its freshness is verified (without writing) by `pnpm handoff --check`.",
    provenBy: {"kind":"GATE","gateId":"status:ledger"},
    evidence:
      "scripts/handoff.mjs (the status-generator block); docs/state.md §7 retirement note",
  },
  {
    id: "standing-net-only-grows",
    capability:
      "The standing regression net exists and only grows: a committed identity baseline plus a walk that reports passed / could-not-run / gone by set difference, run against a local production build by default, or the live site with every write route aborted in the browser (FE-01).",
    provenBy: {"kind":"WALK","checkIdentities":["[0814c] 85701: the map answers with something about this place"]},
    evidence:
      "docs/walk-checks.txt (committed baseline); docs/state.md, the 2026-08-30 session record (“The standing walk, and what it said”)",
    target: "LOCAL_RENDER",
  },
  {
    id: "ballot-answers",
    capability:
      "/ballot answers at the four pilot zips: contests render, the office explainer is present, and the moving-here link resolves.",
    provenBy: {"kind":"WALK","checkIdentities":["[0817] /ballot answers at 03255","[0817] /ballot answers at 07866","[0817] /ballot answers at 85641","[0817] /ballot answers at 85701","[0817] /ballot renders contests at 03255","[0817] /ballot renders contests at 07866","[0817] /ballot renders contests at 85641","[0817] /ballot renders contests at 85701"]},
    evidence:
      "docs/walk-checks.txt; docs/state.md, the 2026-08-30 session record (“The standing walk, and what it said”)",
    target: "LOCAL_RENDER",
  },
  {
    id: "federal-finance",
    capability:
      "Federal campaign-finance data renders for federal offices — who paid for their campaigns — from the OpenFEC snapshot.",
    provenBy: {"kind":"SUITE","testFiles":["tests/funding.test.ts"]},
    evidence:
      "tests/funding.test.ts (committed check; reproducible by `pnpm test`)",
  },
  {
    id: "neutrality",
    capability:
      "The product never ranks candidates, never computes a match or fit score, and never tells anyone how to vote.",
    provenBy: {"kind":"SUITE","testFiles":["tests/neutrality-guards.test.ts"]},
    evidence:
      "tests/neutrality-guards.test.ts (committed check; reproducible by `pnpm test`)",
  },
  {
    id: "ask-pima-vote-prose",
    capability:
      "The production Ask surface answers “How did the Pima County Board of Supervisors vote last time?” with GROUNDED_CLAUDE prose naming the August 25 sitting and its items, subject resolved to the #governing body id, denominators stated (285 held / 60 in pack).",
    provenBy: null,
    neededCheck:
      "a canonical `pnpm reader:suite` run on PRODUCTION_RENDER carrying a reader-question instance for this claim. The evaluator and the run record now exist (A.1 WI1); PRODUCTION_RENDER is now reachable with writes aborted in the browser (FE-01); what does not exist is a production run of it and an owner-stated typed expectation for the question.",
    evidence:
      "docs/state.md, the 2026-08-30 session record (“NH288 — the roster held the Board's name for seventeen days”, reader-verified paragraph)",
    target: "PRODUCTION_RENDER",
  },
  {
    id: "ask-local-finance",
    capability:
      "Local campaign-finance records reach a reader's evidence pack on production: lib/ask/local-finance.ts links BODY ← OFFICE ← COMMITTEE through the county register's own officeName plus a hand-audited crosswalk — never a name match — and served real Pima contribution rows (including the $297.86 contribution held in the committed store), date-ordered, never amount-ranked, never totalled, with the independent-expenditure gap named.",
    provenBy: null,
    neededCheck:
      "a canonical `pnpm reader:suite` run on PRODUCTION_RENDER carrying a reader-question instance whose expectation is the $297.86 contribution as a typed VALUE proposition. The evaluator supports exactly that shape (A.1 WI1); the PRODUCTION_RENDER target and the owner-stated expectation are what is missing.",
    evidence:
      "docs/state.md, the 2026-08-30 session record (“The first local campaign-finance records to reach a reader's evidence pack”, PR #233); the $297.86 row is committed in data/states/az/campaign-finance/az-pima-2026-transactions.json",
    target: "PRODUCTION_RENDER",
  },
];
