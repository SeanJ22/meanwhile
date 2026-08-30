/**
 * **THE STATUS LEDGER'S DATA — current-capability assertions mapped to the
 * checks that prove them.** (2026-08-30, the status-generation ruling: status
 * is GENERATED, never asserted.)
 *
 * Every capability the project currently asserts on a CURRENT-status surface
 * is a row here, and every row either names the gate, test or walk-check
 * identity that goes red when the claim stops being true, or it renders as
 * **UNPROVEN** with the check that needs to exist. The rendered document is
 * `docs/status-ledger.md`, written by `scripts/status-ledger.mts`
 * (`pnpm status:ledger`), which is registered in
 * `lib/ops/generated-register.ts` and freshness-checked by
 * `pnpm handoff --check`.
 *
 * ## Where these rows came from
 *
 * The hand-written current-status surfaces retired on 2026-08-30:
 * `docs/state.md` §2 ("What exists and works"), §3 ("What is stubbed or
 * mocked") and §7 ("Current state of the branch" — self-declared stale since
 * 2026-08-20), plus `README.md`'s capability prose. Their substantive claims
 * were converted to rows; their prose remains in git history and is not
 * duplicated here.
 *
 * ## The two proof classes, kept apart on purpose
 *
 * - `SESSION_MEASURED` — observed by the implementing session's own run.
 * - `INDEPENDENTLY_REPRODUCED` — reproduced by a canonical suite or audit
 *   execution separate from the implementation's one-off proving observation,
 *   against a committed integration head or later, via the normal reader or
 *   audit path — never a purpose-built fixture encoding the expected result.
 *
 * A reader-facing run additionally records its target:
 * `LOCAL_RENDER` (a local production build, RULING 125) or
 * `PRODUCTION_RENDER` (the deployed site).
 *
 * ## What a row may never do
 *
 * Soften UNPROVEN, invent a check-to-claim mapping, or restate a volatile
 * count as current. A row quotes RECORDED evidence with its own as-of date;
 * the current value of anything that moves lives in the file that moves.
 */

export interface StatusEntry {
  /** The assertion, plain language. */
  capability: string;
  /**
   * The named gate/test/check that fails when the claim stops being true.
   * `null` means UNPROVEN — no such check is NAMED, which is a fact about the
   * project's instrumentation, not about the capability.
   */
  provingCheck: string | null;
  /** Required when provingCheck is null: the check that needs to exist. */
  neededCheck?: string;
  proofClass?: "SESSION_MEASURED" | "INDEPENDENTLY_REPRODUCED";
  /** For reader-facing runs: what was rendered against. */
  target?: "LOCAL_RENDER" | "PRODUCTION_RENDER";
  /** What the evidence says, with its own as-of framing. */
  lastResult: string;
  /** Where the recorded result lives — committed evidence only. */
  evidence: string;
  /** Date of the recorded evidence. */
  asOf: string;
  /** Git SHA the evidence was taken at, when known. */
  sha?: string;
}

export const STATUS_ENTRIES: StatusEntry[] = [
  /* ------------------------------------------------ from docs/state.md §2 --- */
  {
    capability:
      "The entry screen answers at the four pilot zips: the map renders, who-governs is " +
      "grouped Local / State / Federal, and the meeting panel is wired to GET /api/meetings.",
    provingCheck:
      'pnpm walk:all — the `[0814c]` identities in docs/walk-checks.txt, including ' +
      '"the map answers with something about this place" at 03255, 07866, 85641 and 85701',
    proofClass: "SESSION_MEASURED",
    target: "LOCAL_RENDER",
    lastResult:
      "the 2026-08-30 standing walk of the integrated head, built locally (RULING 125): " +
      "390 checks ran, 14 declared COULD NOT RUN against a local target, 0 silent, " +
      "against a baseline of 379 identities",
    evidence:
      "docs/state.md, the 2026-08-30 session record (“The standing walk, and what it said”); " +
      "identity baseline docs/walk-checks.txt",
    asOf: "2026-08-30",
  },
  {
    capability:
      "The empty-state cascade (lib/meetings/query.ts) steps exact → widened → concluded " +
      "→ none, and the rung that produced the result is returned to the client as `tier` " +
      "and shown on screen.",
    provingCheck: "tests/cascade.test.ts and tests/concluded.test.ts, run by `pnpm test`",
    proofClass: "SESSION_MEASURED",
    lastResult: "suite green in the workstream run that generated this ledger",
    evidence: "tests/cascade.test.ts, tests/concluded.test.ts (committed checks; reproducible by `pnpm test`)",
    asOf: "2026-08-30",
  },
  {
    capability:
      "Local / State / National tier filtering is decided by OCD-ID segment depth against an " +
      "explicit table (lib/ocd/tiers.ts), never by string-matching a label, and an unknown " +
      "deepest segment returns null rather than inheriting its parent's tier.",
    provingCheck: "tests/tiers.test.ts, run by `pnpm test`",
    proofClass: "SESSION_MEASURED",
    lastResult: "suite green in the workstream run that generated this ledger",
    evidence: "tests/tiers.test.ts (committed check; reproducible by `pnpm test`)",
    asOf: "2026-08-30",
  },
  {
    capability:
      "Zip resolution (lib/geo/zcta.ts) distinguishes malformed / unknown / uncovered, and the " +
      "ZCTA centroid table is complete, so an unrecognized five-digit zip honestly reads as " +
      "unknown rather than not-held-yet.",
    provingCheck: "tests/zip-coverage.test.ts (resolveZip + the cascade over it), run by `pnpm test`",
    proofClass: "SESSION_MEASURED",
    lastResult:
      "suite green in the workstream run that generated this ledger; the table's row count and " +
      "`complete` flag live in lib/geo/zcta-centroids.json, not here",
    evidence: "tests/zip-coverage.test.ts; lib/geo/zcta-centroids.json (the committed table)",
    asOf: "2026-08-30",
  },
  {
    capability:
      "Local calendar date plus wall-clock time reassembles into a correct instant for an IANA " +
      "zone (lib/time/zoned.ts), including across DST boundaries.",
    provingCheck: "tests/zoned.test.ts, run by `pnpm test`",
    proofClass: "SESSION_MEASURED",
    lastResult: "suite green in the workstream run that generated this ledger",
    evidence: "tests/zoned.test.ts (committed check; reproducible by `pnpm test`)",
    asOf: "2026-08-30",
  },
  {
    capability:
      "A returning reader's zip is remembered (hooks/use-stored-zip.ts) and confirmed or " +
      "re-entered on return; the server renders a pending state so the entry notice never " +
      "flashes before the stored zip loads.",
    provingCheck: "tests/returning-reader.test.ts, run by `pnpm test`",
    proofClass: "SESSION_MEASURED",
    lastResult: "suite green in the workstream run that generated this ledger",
    evidence: "tests/returning-reader.test.ts (committed check; reproducible by `pnpm test`)",
    asOf: "2026-08-30",
  },
  {
    capability:
      "The division-and-body registry (lib/registry/) resolves a point to its divisions and the " +
      "bodies they imply, and only its generator may write it.",
    provingCheck:
      "tests/registry-oracle.test.ts (the four-zip hand-written oracle) and " +
      "tests/registry-ownership.test.ts, run by `pnpm test`",
    proofClass: "SESSION_MEASURED",
    lastResult:
      "suite green in the workstream run that generated this ledger. §2 stated " +
      "“940 divisions, 265 bodies” as of its writing; the current counts live in " +
      "lib/registry/registry.json and are deliberately not restated here",
    evidence: "tests/registry-oracle.test.ts, tests/registry-ownership.test.ts; lib/registry/registry.json",
    asOf: "2026-08-30",
  },
  {
    capability:
      "Six district overlay types draw from committed Census geometry — congressional " +
      "national, everything below Congress clipped to the three pilot counties — with " +
      "type-specific dash, weight and label zoom.",
    provingCheck:
      "tests/districts.test.ts (asserts the congressional feature count among others), run by `pnpm test`",
    proofClass: "SESSION_MEASURED",
    lastResult: "suite green in the workstream run that generated this ledger",
    evidence: "tests/districts.test.ts (committed check; reproducible by `pnpm test`)",
    asOf: "2026-08-30",
  },
  {
    capability:
      "A map click resolves the SET of districts containing the point: one hit selects, several " +
      "open the picker grouped by tier, zero is a no-op — the reader's own click chooses, " +
      "nothing is inferred from a zip centroid.",
    provingCheck: "tests/district-hits.test.ts, run by `pnpm test`",
    proofClass: "SESSION_MEASURED",
    lastResult: "suite green in the workstream run that generated this ledger",
    evidence: "tests/district-hits.test.ts (committed check; reproducible by `pnpm test`)",
    asOf: "2026-08-30",
  },
  {
    capability:
      "Meetings at one venue group into one pin (lib/meetings/venues.ts, coordinates rounded " +
      "to 4 dp), so a chamber hosting four sittings is not four stacked unclickable markers.",
    provingCheck: null,
    neededCheck:
      "a named unit test over lib/meetings/venues.ts grouping (no tests/venues.test.ts exists; " +
      "the retired §2 asserted this from code reading)",
    lastResult:
      "asserted by the retired docs/state.md §2 from code reading; no named check found " +
      "that fails when the grouping breaks",
    evidence: "docs/state.md §2 as it stood before retirement (git history)",
    asOf: "2026-08-30",
  },
  {
    capability:
      "scripts/shoot.mts captures the running app headlessly and prints what actually rendered, " +
      "so a screenshot cannot quietly be of an empty map.",
    provingCheck: null,
    neededCheck:
      "a check asserting the capture path fails loudly on an empty render (the walk consumes " +
      "shoot-style captures but nothing named guards the instrument's own honesty)",
    lastResult:
      "asserted by the retired docs/state.md §2 from the instrument's design; no named " +
      "check found",
    evidence: "docs/state.md §2 as it stood before retirement (git history); scripts/shoot.mts",
    asOf: "2026-08-30",
  },
  {
    capability:
      "app/api/meetings/route.ts validates latitude/longitude ranges, clamps radiusKm to the " +
      "widest ladder rung, and rejects unknown query params.",
    provingCheck: null,
    neededCheck:
      "a route-handler test over app/api/meetings/route.ts validation via the alias loader " +
      "(the handlers are testable directly; no test named for this route's validation was found)",
    lastResult:
      "asserted by the retired docs/state.md §2; the unknown-param rejection is recorded " +
      "operationally (a ?cb= probe is a 400) but no named suite check was found",
    evidence: "docs/state.md §2 as it stood before retirement (git history)",
    asOf: "2026-08-30",
  },

  /* ------------------------------------------------ from docs/state.md §3 --- */
  {
    capability:
      "Meeting data is served by the composite source; the mock adapter is no longer active and " +
      "remains only for fixture-driven tests, which pin WTP_MEETING_SOURCE=mock so the suite " +
      "never touches the network.",
    provingCheck: "tests/composite.test.ts, run by `pnpm test`",
    proofClass: "SESSION_MEASURED",
    lastResult:
      "suite green in the workstream run that generated this ledger; the mock-to-composite " +
      "cutover is dated 2026-08-13 in the retired §3.1",
    evidence: "tests/composite.test.ts; docs/state.md §3.1 as it stood before retirement (git history)",
    asOf: "2026-08-30",
  },
  {
    capability:
      "No fixture invents provenance: every mock meeting URL is null or on the (empty) declared " +
      "host allowlist, in the raw rows AND in normalize() output.",
    provingCheck: "tests/fixture-provenance.test.ts, run by `pnpm test`",
    proofClass: "SESSION_MEASURED",
    lastResult: "suite green in the workstream run that generated this ledger",
    evidence: "tests/fixture-provenance.test.ts (committed check; reproducible by `pnpm test`)",
    asOf: "2026-08-30",
  },
  {
    capability:
      "The production database schema is applied and current: the shipping invariant holds at " +
      "post-deploy, with every committed migration applied.",
    provingCheck:
      "the `db:gate` and `release:freeze` gates in scripts/gates.mjs, plus the post-deploy " +
      "integrity observer (post-deploy-integrity.yml → data/ops/production-integrity.json)",
    proofClass: "INDEPENDENTLY_REPRODUCED",
    lastResult:
      "HELD — “shipping invariant HOLDS at post-deploy: 23 of 23 committed " +
      "migration(s) applied, head 0022_adorable_hemingway”, observed " +
      "2026-08-30T18:12:52.621Z at the post-deploy moment; the CURRENT reading always " +
      "lives in data/ops/production-integrity.json",
    evidence: "data/ops/production-integrity.json (committed by the observer)",
    asOf: "2026-08-30",
    sha: "e19725573cf0d14c3ef2285225f594670eefc503",
  },
  {
    capability:
      "§3.4's claim that no officeholder data source exists is SUPERSEDED: the federal " +
      "directory and officeholder surfaces shipped later and are under test.",
    provingCheck:
      "tests/officeholders.test.ts and tests/officeholder-lookup.test.ts, run by `pnpm test`",
    proofClass: "SESSION_MEASURED",
    lastResult:
      "suite green in the workstream run that generated this ledger; §3.4 (“Not " +
      "built”) described the repo as of its writing and stopped being true later",
    evidence: "tests/officeholders.test.ts, tests/officeholder-lookup.test.ts",
    asOf: "2026-08-30",
  },

  /* ------------------------------------------------ from docs/state.md §7 --- */
  {
    capability:
      "The current-status surface is GENERATED: this ledger is regenerated by handoff and its " +
      "freshness is verified (without writing) by `pnpm handoff --check`.",
    provingCheck:
      "`pnpm status:ledger --check` (byte-compares docs/status-ledger.md against its generator), " +
      "wired into scripts/handoff.mjs on both the regeneration and --check paths",
    proofClass: "SESSION_MEASURED",
    lastResult:
      "§7 had self-declared stale since 2026-08-20 — a heading that says " +
      "“current” and is sessions behind is worse than no heading. Its body is " +
      "retired to this generated ledger as of 2026-08-30",
    evidence: "scripts/handoff.mjs (the status-generator block); docs/state.md §7 retirement note",
    asOf: "2026-08-30",
  },
  {
    capability:
      "The standing regression net exists and only grows: a committed identity baseline plus a " +
      "walk that reports passed / could-not-run / gone by set difference, run against a LOCAL " +
      "production build (RULING 125 hard-refuses non-local targets).",
    provingCheck:
      "pnpm walk:all + the committed identity baseline docs/walk-checks.txt (a lost identity " +
      "reports as GONE, never as a smaller total)",
    proofClass: "SESSION_MEASURED",
    target: "LOCAL_RENDER",
    lastResult:
      "baseline 379 identities in docs/walk-checks.txt; latest recorded run (2026-08-30, the " +
      "integrated head built locally): 390 checks ran, 14 declared COULD NOT RUN against a " +
      "local target, 0 silent",
    evidence:
      "docs/walk-checks.txt (committed baseline); docs/state.md, the 2026-08-30 session record " +
      "(“The standing walk, and what it said”)",
    asOf: "2026-08-30",
  },

  /* ------------------------------------------------------ from README.md --- */
  {
    capability:
      "/ballot answers at the four pilot zips: contests render, the office explainer is present, " +
      "and the moving-here link resolves.",
    provingCheck:
      "pnpm walk:all — the `[0817]` identities in docs/walk-checks.txt " +
      "(“/ballot answers at”, “/ballot renders contests at” each pilot zip)",
    proofClass: "SESSION_MEASURED",
    target: "LOCAL_RENDER",
    lastResult:
      "the 2026-08-30 standing walk of the integrated head, built locally: 390 checks ran, " +
      "14 declared COULD NOT RUN, 0 silent",
    evidence:
      "docs/walk-checks.txt; docs/state.md, the 2026-08-30 session record " +
      "(“The standing walk, and what it said”)",
    asOf: "2026-08-30",
  },
  {
    capability:
      "Federal campaign-finance data renders for federal offices — who paid for their " +
      "campaigns — from the OpenFEC snapshot.",
    provingCheck: "tests/funding.test.ts, run by `pnpm test`",
    proofClass: "SESSION_MEASURED",
    lastResult: "suite green in the workstream run that generated this ledger",
    evidence: "tests/funding.test.ts (committed check; reproducible by `pnpm test`)",
    asOf: "2026-08-30",
  },
  {
    capability:
      "The product never ranks candidates, never computes a match or fit score, and never tells " +
      "anyone how to vote.",
    provingCheck: "tests/neutrality-guards.test.ts, run by `pnpm test`",
    proofClass: "SESSION_MEASURED",
    lastResult: "suite green in the workstream run that generated this ledger",
    evidence: "tests/neutrality-guards.test.ts (committed check; reproducible by `pnpm test`)",
    asOf: "2026-08-30",
  },

  /* ------------------------------- the two production Ask proofs, required --- */
  {
    capability:
      "The production Ask surface answers “How did the Pima County Board of Supervisors " +
      "vote last time?” with GROUNDED_CLAUDE prose naming the August 25 sitting and its " +
      "items, subject resolved to the #governing body id, denominators stated " +
      "(285 held / 60 in pack).",
    provingCheck: null,
    neededCheck:
      "the reader-answerability suite (scaffolded in a parallel workstream of this session) " +
      "reproducing the probe against PRODUCTION_RENDER — the INDEPENDENTLY_REPRODUCED " +
      "upgrade for this row",
    proofClass: "SESSION_MEASURED",
    target: "PRODUCTION_RENDER",
    lastResult:
      "reader-verified on production with synthetic before/after probes: moved from " +
      "REJECTED_FELL_BACK to GROUNDED_CLAUDE prose naming the August 25 sitting and its items " +
      "(NH288). SESSION_MEASURED until a canonical suite run reproduces it on " +
      "PRODUCTION_RENDER",
    evidence:
      "docs/state.md, the 2026-08-30 session record (“NH288 — the roster held the " +
      "Board's name for seventeen days”, reader-verified paragraph)",
    asOf: "2026-08-30",
  },
  {
    capability:
      "Local campaign-finance records reach a reader's evidence pack on production: " +
      "lib/ask/local-finance.ts links BODY ← OFFICE ← COMMITTEE through the county " +
      "register's own officeName plus a hand-audited crosswalk — never a name match — " +
      "and served real Pima contribution rows (including the $297.86 contribution held in the " +
      "committed store), date-ordered, never amount-ranked, never totalled, with the " +
      "independent-expenditure gap named.",
    provingCheck: null,
    neededCheck:
      "the reader-answerability suite (scaffolded in a parallel workstream of this session) " +
      "reproducing the probe against PRODUCTION_RENDER — the INDEPENDENTLY_REPRODUCED " +
      "upgrade for this row",
    proofClass: "SESSION_MEASURED",
    target: "PRODUCTION_RENDER",
    lastResult:
      "the grounded route re-proved live on production the same day it shipped (Lane A: " +
      "anonymous by design, tenant GUID plus Origin header), serving rows from the Pima " +
      "EasyVote acquisition (900 contribution and 584 distribution rows held). " +
      "SESSION_MEASURED until a canonical suite run reproduces it on PRODUCTION_RENDER",
    evidence:
      "docs/state.md, the 2026-08-30 session record (“The first local campaign-finance " +
      "records to reach a reader's evidence pack”, PR #233); the $297.86 row is committed " +
      "in data/campaign-finance/az-pima-2026-transactions.json",
    asOf: "2026-08-30",
  },
];
