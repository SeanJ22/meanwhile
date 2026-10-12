# Stage 0 — current-system inventory and reconciliation

**Recorded 2026-08-28.** Written before any control-plane authority was
introduced, because the exit condition of Stage 0 is that no parallel control
plane gets built beside working machinery by accident.

This is an inventory, not an essay. Every row names a file. Every component
carries exactly one disposition:

| Disposition | Means |
| --- | --- |
| `REUSE_AS_AUTHORITY` | The control plane calls it. It stays the single source of truth for its question. |
| `HARDEN_IN_PLACE` | Correct where it is; needs a named strengthening. |
| `WRAP_BEHIND_INTERFACE` | Keep the implementation, hide it behind one seam so a second one cannot appear. |
| `MIGRATE` | Its job moves into the control plane, with a stated migration. |
| `GENERATED_VIEW` | Output of a generator. Never hand-edited, never an input. |
| `RETIRE` | Superseded. Kept for history, not for use. |
| `DO_NOT_DUPLICATE` | Sole writer of something. A second writer reopens a closed defect. |

---

## The one-paragraph answer

**This repository already implements most of the target architecture's
semantics, and almost none of its runtime.** The disposition vocabulary, the
permission/transport orthogonality, the completion-is-derived rule, the typed
method projection with required provenance, the atomic-disposition discipline,
the coverage-denominator discipline and the political-neutrality firewall are
all present, tested, and governed by numbered law. What does not exist is the
execution layer underneath them: there is no durable unit of route work that
outlives the worker walking it, no lease, no attempt record, no evidence vault,
no shared host budget, and no cost ledger. The control plane's job is to supply
that layer and to call the existing semantics unchanged — not to restate them.

---

## 1. Governance and law

| Component | Path | Disposition | Why |
| --- | --- | --- | --- |
| Canonical law store | `docs/governance/ledger.jsonl` (234 records) | `REUSE_AS_AUTHORITY` | The single canonical store; every view derives from it. |
| Schema / validator / claims | `lib/governance/{schema,validate,claims}.ts` | `REUSE_AS_AUTHORITY` | The only thing that can turn a governance contradiction red. |
| Ledger reader | `lib/governance/ledger.ts` (`LedgerIndex`, `loadIndex`) | `WRAP_BEHIND_INTERFACE` | Already the read API. The control plane calls it and never re-parses JSONL. |
| Compiler | `scripts/governance-compile.mts` | `DO_NOT_DUPLICATE` | Sole writer of every governance view. |
| Checker | `scripts/governance-check.mts` | `REUSE_AS_AUTHORITY` | Validity + byte-level staleness. A second checker is a second verdict. |
| Generated views | `docs/rulings.md`, `docs/governance/{index.json,current-decisions.md,history.md}`, `policies/*.md` | `GENERATED_VIEW` | Regenerated and byte-diffed by `governance:check`. |
| Legacy importers | `lib/governance/import.ts`, `constitution-import.ts` | `RETIRE` | One-time ingest, already performed. |

**Finding.** `governance:check` and `orchestration:check` are invoked by **no
workflow**. They reach CI only indirectly through `pnpm test`. That is not a
defect today, but a control plane that ran them itself would become a second
enforcement point with two possible verdicts. It must not.

---

## 2. Work state and orchestration

| Component | Path | Disposition | Why |
| --- | --- | --- | --- |
| Status/disposition vocabulary | `lib/workstate/types.ts` | `REUSE_AS_AUTHORITY` | **The single most important reuse in this document.** See below. |
| Session-stop classifier | `classifySessionStop` | `REUSE_AS_AUTHORITY` | The one place a session status is derived rather than claimed. |
| Orchestration verdict | `lib/workstate/orchestration.ts` (`classifyOrchestration`) | `REUSE_AS_AUTHORITY` | The only checkable definition of a proven dependency. |
| Close-out reconciliation | `lib/workstate/orchestration-closeout.ts` | `REUSE_AS_AUTHORITY` | Sole reconciler of declared plan vs observed refs. |
| Workstream model | `lib/workstate/workstream.ts` | `REUSE_AS_AUTHORITY` | Owns `Workstream`, accounting, completion. |
| Edge eligibility | `lib/workstate/eligibility.ts` | `HARDEN_IN_PLACE` | Regex heuristics with a version stamp; the stamp must be bumped on every edit. |
| Shared loader | `lib/workstate/load.ts` | `REUSE_AS_AUTHORITY` | Exists because two gates once grew duplicate loaders (RULING 103). |
| Frontier / candidates | `lib/workstate/{frontier,candidates}.ts` | `REUSE_AS_AUTHORITY` | Sole writers of persisted edges, candidates and the exact cursor. |
| Persisted state | `data/workstate/{nj,az,nh}.json`, `orchestration/*.json` | `REUSE_AS_AUTHORITY` | The canonical frontier and session plans. |
| Legacy descent store | `states/{nj,az,nh}/descent.json` | `RETIRE` | The count-only store the migration replaced; still on disk. |

### The disposition vocabulary is authority, and the design document's is not

The target architecture names five route dispositions: `YIELDED`, `ZERO`,
`FAILED`, `ROUTE_BLOCKED`, `NOT_APPLICABLE`. This repository already carries
**eleven**, argued into existence by RULING 184, and the eleven are strictly
better because three of them are open states wearing a finished face:

```
UNWALKED  DISCOVERED  IN_PROGRESS  INGESTED  POINTER_ONLY  WALKED_NO_YIELD
BLOCKED_CURRENTLY  REQUIRES_NEW_ADAPTER  RECORDS_REQUEST_PENDING
NOT_APPLICABLE  RECHECK_DUE

TERMINAL: INGESTED, WALKED_NO_YIELD, NOT_APPLICABLE — and only those three.
```

**Reconciliation:** the design document's five names are recorded as a *reading*
of the governed eleven, in `DESIGN_DOC_DISPOSITION_READING`
(`lib/control-plane/route-task.ts`), so that a later session cannot reconcile
the two by minting a second enum. `FAILED` deliberately has **no** single
mapping: a failure is either a transport fact (which belongs to the Attempt and
is not a disposition at all), a capability gap (`REQUIRES_NEW_ADAPTER`), or a
wall (`BLOCKED_CURRENTLY`). Collapsing all three into one word is how a wall
became an emptiness.

Likewise `PERMISSION_STATES` × `TRANSPORT_STATES` (RULING 182) are reused
wholesale. `recordPermissionRead` already **throws** if a verdict is supplied
with a non-`REACHABLE` transport.

### Named hazards found

- **`TERMINAL_DISPOSITIONS` is exported twice**, from `lib/workstate/types.ts`
  (`INGESTED, WALKED_NO_YIELD, NOT_APPLICABLE`) and from
  `orchestration-closeout.ts` (`READY_FOR_INTEGRATION, INTEGRATED, BLOCKED`).
  Same name, same directory, different meanings. `HARDEN_IN_PLACE`.
- **`serializationNotes`** appears in real orchestration plan JSON, is **not a
  field on `OrchestrationPlan`**, and is read by **zero code**. It is free prose
  that reads as governed evidence. `HARDEN_IN_PLACE`.
- **`scripts/workstream-close.mts` defaults `TODAY` to a hardcoded
  `"2026-08-26"`** unless `WTP_TODAY` is set. Every freshness, recheck and
  convergence verdict a close-out prints is computed against that date.
  `HARDEN_IN_PLACE`.

---

## 3. Method intelligence

| Component | Path | Disposition | Why |
| --- | --- | --- | --- |
| Route model + validator | `lib/method/knowledge.ts` | `REUSE_AS_AUTHORITY` | The canonical route type, with an explicit no-cap invariant. |
| Assertion classes + provenance | `lib/method/claims.ts` | `REUSE_AS_AUTHORITY` | Four classes, required provenance for C/D, retraction with mandatory `survives`. |
| Inheritance interface | `lib/method/projection.ts` (`projectMethodFor`) | `REUSE_AS_AUTHORITY` | R-0195 makes this the ONLY inheritance interface; a repo sweep enforces exclusivity. |
| Amendment path | `lib/method/amend.ts` | `REUSE_AS_AUTHORITY` | The only write path that validates before writing. |
| Candidate intake | `lib/method/learn-batch.ts` | `REUSE_AS_AUTHORITY` | Idempotent, additive-only. |
| Execution→route attribution | `lib/method/observe.ts` | `REUSE_AS_AUTHORITY` | Already solves attributing a walk to a canonical route id without synthesising one. |
| Store | `data/method/knowledge.json` — version **55**, **116 routes** | `REUSE_AS_AUTHORITY` | |
| Retired writers registry | `lib/method/retired-writers.ts` | `HARDEN_IN_PLACE` | Currently one constant; should be a lookup keyed by script path. |
| 14 × `scripts/learn-*.mts` | | `RETIRE` *as the intake mechanism* | One hand-written script per discovery event is what a candidate queue replaces. |
| `scripts/method-ingest.mts` | | `RETIRE` | One-time bootstrap that now refuses to run; only the destructive `--reset-to-manifest` path remains. |

### What already exists (and must not be rebuilt)

`lib/method` implements the *semantics* of MethodCandidate → validation →
MethodAssertion → inheritance **completely**. The four assertion classes
(`ROUTE_EXISTENCE`, `ROUTE_OUTCOME`, `COVERAGE_CLAIM`, `DERIVED_CONCLUSION`)
exist; C and D require artifact, route, disposition, jurisdictions, observed
date and a validation state, with **silence refused**; retraction requires
`survives`; and `staleDependents` flags any claim resting on a withdrawn id.

### What the control plane must ADD

1. **A durable candidate queue.** `LearnedRoute` is a *shape*, not a *record*: no
   id, no submitter, no timestamp, no lifecycle, and **no rejection record** — a
   refused candidate leaves no trace at all.
2. **Validation as a pre-admission gate.** `runLearnBatch` writes
   **unconditionally** and never calls `validateKnowledge`. Only `runClaimAmendment`
   refuses before writing, and only for amendments.
3. **A persisted `PriorConclusion` corpus.** `data/method/conclusions.json`
   **does not exist**, and all three workstate `convergence` fields are `null`.
   The reopening engine is fully implemented, fully tested, and has **zero
   production inputs** — `method:check` passes that clause vacuously.
4. **Write serialisation.** Six independent writers read-modify-write one JSON
   file with no lock and no version precondition.
5. **An Attempt reference on `ClaimProvenance`**, so provenance is
   machine-auditable rather than a URL string.
6. **Gate wiring.** `method:check` is in neither `pnpm gates` nor CI.
7. **Portability promotion as a job.** All 116 routes are still `UNKNOWN`
   portability despite 58 recorded outcomes, because `applyEarnedPortability` is
   only invoked ad hoc.

### Correction found while inventorying

`scripts/method-check.mts` and `lib/method/knowledge.ts` both say **"Thirteen
legacy sub-branches carry prose where the date belongs."** The committed store
holds **twelve**. The check prints the live number, so this is stale prose
rather than a green-while-wrong guard.

---

## 4. Acquisition

| Component | Path | Disposition | Why |
| --- | --- | --- | --- |
| Ingestion adapters (22 dirs) | `lib/sources/**` | `REUSE_AS_AUTHORITY` | The only code that touches a publisher's bytes; already row-accounted and rung-stamped. |
| Adapter `upsert()` | every adapter | `MIGRATE` | Every implementation returns `{inserted: 0}`. The persistence contract exists and is unimplemented. |
| The retrieval ladder | `lib/sources/http.ts` | `REUSE_AS_AUTHORITY` | One finalizer every rung passes through (A-003). |
| Rung 5 egress | `lib/hunt/egress.ts` | `WRAP_BEHIND_INTERFACE` | Returns a third-party *rendering*, not origin bytes — a vault must be able to refuse it for hash-bearing artifacts. |
| Rung 6 public-page capture | — | `MIGRATE` (build it) | Documented and used by hand; **no reusable helper exists**, which is why rung 5 keeps getting reached for. |
| Body identity | `lib/registry/registry.json`, `curated-bodies.ts` | `REUSE_AS_AUTHORITY` | R-0197: the registry is the authority; an adapter never mints one. |
| Tenant→body guard | `lib/ops/tenant-body-binding.ts` | `REUSE_AS_AUTHORITY` | |
| Source wiring | `lib/registry/source-wiring.ts` (76 rows) | `MIGRATE` | Its own header calls it the committed forerunner of a table; it cannot stay in code at 90,000 governments. |
| Private tenant tables | `data/states/az/meetings/legistar-venues.json`, `legistar-insite/insite-venues.json` | `WRAP_BEHIND_INTERFACE` | Two adapters keep tenant tables outside the meeting doors in the door registry. |
| Browser constructor | `scripts/browser.mts` | `REUSE_AS_AUTHORITY` | The only sanctioned browser; its bypass is test-refused. |
| Extraction toolkit | `lib/extract/**` | `REUSE_AS_AUTHORITY` | Its `CANNOT_RUN` ≠ `zeroRows` contract is exactly the discipline a vault needs. |
| Two colliding rung namespaces | `lib/sources/http.ts` (14-rung mechanics) vs `lib/registry/audit.ts` (`LadderRung`, 9 values) | `HARDEN_IN_PLACE` | Documented, not resolved. Only a typed `walledAtRung` stops it recurring. |

---

## 5. Evidence — the load-bearing gap

**There is no evidence vault. Acquired bytes are hashed, extracted, accounted,
attributed and rung-stamped — and then discarded.**

Every place publisher bytes currently land:

| Where | Raw bytes? | Committed? |
| --- | --- | --- |
| `tests/fixtures/` — 73 files | **Yes** — the only raw-byte corpus in git, sanitized of publisher credentials | Yes (`-text`) |
| `data/assets/` manifest + external store (1,065 rows, 135 MB) | **Yes**, but outside this repo | Manifest only |
| `data/hunt/**` HTML/XML/PDF | **Yes**, locally | **No** — gitignored |
| `.cache/tiger/`, `.hunt-tmp/`, `.scratch/` | **Yes**, locally | No |
| `data/meetings-snapshot.json` | No — normalized records + extracted text + `contentHash` | Yes |
| Postgres `agenda_documents` | No — hash and text only, no blob column | Schema only; **nothing writes to it** |

| Component | Disposition | Why |
| --- | --- | --- |
| `lib/ops/fixture-captures.ts` (`writeCapturedFixture`) | `REUSE_AS_AUTHORITY` | **Already the single acquisition boundary**, made structurally unbypassable by a guard test. This is the vault's seam. |
| `lib/ops/fixture-credentials.ts` | `REUSE_AS_AUTHORITY` + `HARDEN_IN_PLACE` | 11 anchored redaction classes with two-stage confirmation; the class list is self-declared a floor, and a vault widens exposure well beyond 73 files. |
| `lib/evidence/emit.ts` | `REUSE_AS_AUTHORITY` (semantics) / `MIGRATE` (storage) | The row grammar is right; a hardcoded JSONL path in `docs/` is not a vault. |
| `AgendaDocument` / `AgendaDocumentStore` | `REUSE_AS_AUTHORITY` | Already contentHash-keyed, append-only, revision-aware. It is the vault's record shape. |
| `data/assets/manifest.json` + `lib/ops/asset-remote.ts` | `REUSE_AS_AUTHORITY` | A working hash-verified content-addressed external store already exists; extend it rather than invent a second. |
| `tests/fixtures/**` | `DO_NOT_DUPLICATE` | Adopt them; do not re-capture beside them. |

**The #217 lesson, stated as architecture:** git fixtures are *sanitized parser
artifacts*, not the raw evidence vault. The restricted-raw / sanitized-derived
split the design document asks for is the generalisation of a boundary this repo
already built for 73 files.

---

## 6. Database, shipping and deploy

| Component | Path | Disposition | Why |
| --- | --- | --- | --- |
| Schema (13 tables) | `lib/db/schema.ts` | `REUSE_AS_AUTHORITY` | |
| Migrations 0000–0022 + journal | `lib/db/migrations/` | `REUSE_AS_AUTHORITY` | |
| Immutability guard | `lib/db/migration-immutability.ts` | `REUSE_AS_AUTHORITY` | R-0196. Runs before the credential is read, so a fork PR is still refused for a rewrite. |
| Schema shipping gate | `scripts/db-shipping-gate.mts` | `REUSE_AS_AUTHORITY` | Exit 0/1/2 where **2 is COULD NOT TELL and fails**. Phase-aware (expand before deploy, contract after). |
| Gate set | `scripts/gates.mjs` (now **9** entries) | `REUSE_AS_AUTHORITY` | The local stand-in for the required CI contexts, with a parity test. |
| Build check | `.github/workflows/build-check.yml` | `REUSE_AS_AUTHORITY` | The merge gate. Its `gates` job is the required context. |
| Deploy filter | `lib/ops/deploy-paths.ts` + `scripts/netlify-ignore.mjs` | `REUSE_AS_AUTHORITY` | The authority on "is this production-changing". Reused by the NH273 freeze. |
| Deploy verdict | `lib/ops/deploy-verdict.ts` | `REUSE_AS_AUTHORITY` | Pure; distinguishes a filter-cancel from a failure. |
| Production integrity + freeze | `lib/ops/production-integrity.ts` | *new this session* | NH273. See below. |

### Measured facts that constrain any new machinery

- **`gh api repos/:owner/:repo/deployments` returns `0`.** Netlify creates no
  GitHub Deployment for this repository, so **no `deployment_status` event has
  ever fired** and a workflow listening for one would never run.
- `tests/workflow-actions.test.ts` asserts **exactly 9 workflow files** and
  **exactly 20 Node-runtime action pins**.
- `tests/refresh-cadence.test.ts` asserts **exactly three** workflows may hold a
  cron, and one cron each.
- `tests/push-main.test.ts` asserts **exactly 8** `push-main.mjs` callers and
  that every job carries a `timeout-minutes` under 360.
- `tests/gate-parity.test.ts` requires every `run:` step in `build-check.yml` to
  be in `GATES` or in a named `NOT_A_GATE` list.
- `tests/migration-shipping-invariant.test.ts` holds the set of files permitted
  to query `drizzle.__drizzle_migrations` closed to **four**, and forbids any
  workflow from containing `db:apply`, `drizzle-kit migrate` or
  `apply-migrations`.
- Required checks on `main`: `build (default)`, `build (standalone)`,
  `gates (test · lint · tsc)`. Classic branch protection is **not** used; a
  repository ruleset carries the rules, with `DeployKey` actors exempt.
- **`WTP_PRODUCTION_DATABASE_URL_READONLY` is not a repository secret** (NH272),
  and neither is `NETLIFY_AUTH_TOKEN`.

**Consequence, and it decided the NH273 design:** the production-integrity
freeze went into the **existing `gates` job**, not a tenth workflow. A tenth
workflow would have broken two count assertions, created a second shipping
verdict, and — if triggered on `deployment_status` — would never have run at
all.

---

## 7. Product domains

| Component | Path | Disposition | Note |
| --- | --- | --- | --- |
| Pima union semantics | `lib/sources/legistar-insite/horizon.ts` | `REUSE_AS_AUTHORITY` | The MTG-13 correction. The union across materially distinct first-party routes is **14**; the intersection of the two wired routes is **0**. |
| MTG-13 acceptance | `tests/legistar-insite-union.test.ts` | `REUSE_AS_AUTHORITY` | Remains the acceptance authority. The control plane attaches in **shadow** and does not move it. |
| Meetings store | `data/meetings-snapshot.json` | `GENERATED_VIEW` | The serving path. The DB tables exist and nothing writes to them. |
| Identity completeness | `lib/ballot/contest-universe.ts` | `REUSE_AS_AUTHORITY` | BAL-27. Replaced a cardinality gate with identity reconciliation. |
| Ask evidence pack | `lib/ask/evidence.ts` | `REUSE_AS_AUTHORITY` | Every record carries its own provenance; gaps travel with the records and carry `whose: OURS \| THEIRS`. |
| Coverage tier ladder | `lib/coverage/tier.ts` | `REUSE_AS_AUTHORITY` | Stored and stamped, never inferred at read time. |
| FEC snapshot + reader | `data/fec/fec-2026.json`, `lib/funding/snapshot.ts` | `REUSE_AS_AUTHORITY` | No live call at request time; the key never reaches runtime. |
| Campaign-finance firewall | `tests/campaign-finance-firewall.test.ts` | `REUSE_AS_AUTHORITY` | RULING 126. **Binding constraint on the control plane** — see below. |
| AZ state/local money | — | **NOT PRESENT** | `data/states/az/funding/state-money-az-2026.json` does not exist. `seethemoney.az.gov` is an SPA shell; rung 6 recorded as NOT YET WALKED. |
| IndependentExpenditure model | — | **NOT PRESENT** | The phrase appears only in prose. |

### RULING 126 constrains the campaign-finance design

Campaign-finance data **renders for readers and never enters anything sold**.
Wall 1 enumerates every `pgTable` and fails on any table or column matching
money words. Therefore the control plane's campaign-finance domain is **types
plus committed-JSON semantics**, with **no Drizzle table and no migration**.

This is a genuine deviation from the target architecture, which places every
canonical entity in Postgres. It is resolved in favour of RULING 126, and the
reasoning is recorded in the technical design specification.

---

## 8. Duplicate-authority risks, named

| # | Risk | The wall that already exists |
| --- | --- | --- |
| A | **A second scheduler.** | Three workflows may hold a cron, asserted by name. An *external* scheduler would be invisible to every test, and `maxScheduledBuildsPerMonth() === 30` would silently stop being true. |
| B | **A second tracker.** | The repo already carries **four dead tracker writers** pointing at the frozen `docs/tracker.csv` — proof that a second surface here is not noticed, it is ignored. |
| C | **A second work graph.** | Three live claimants already (`data/workstate/*.json`, `orchestration/*.json`, and the retired-but-present `states/*/descent.json`). A graph built outside `owns`/`produces`/`consumes` cannot be proven by `classifyOrchestration`. |
| D | **A second shipping truth.** | The `gates` job is the merge verdict. Any control-plane "is it shippable" signal running a subset would be a second one. |
| E | **A second method registry.** | `tests/method-projection.test.ts` sweeps the repo and fails if anything outside five allow-listed files calls `applicableRoutesUnprojected`. |
| F | **A second law authority.** | `governance:check` regenerates all four views into a scratch tree and byte-diffs them. |

**How the control plane avoids each:** it introduces no cron (the freeze rides
the existing `gates` job); it creates no work-item store beside the tracker (the
Pima and campaign-finance obligations are *fixtures* and *shadow* attachments,
not a second tracker); it imports `Disposition` rather than declaring one; it
reads the method store only through `projectMethodFor`; and it adds no second
"shippable" verdict.

---

## Stage 0 exit condition

A new engineer can answer, from this document:

- **What is authoritative today** — §§1–7, one row per component.
- **What the control plane will own** — the execution layer: WorkItem,
  RouteTask, Attempt, ExecutionLease, RouteDisposition writing, capability
  grants, host/vendor budgets, cost, the evidence vault, and the campaign-finance
  domain.
- **What existing machinery survives** — every `REUSE_AS_AUTHORITY` row, which
  is most of them.
- **What migrates** — adapter `upsert()`, `source-wiring.ts`, `lib/evidence`
  storage, `data/hunt` untracked bytes, and the Postgres `agenda_documents`
  index.
- **What must never exist twice** — the six risks in §8, each with the wall that
  already guards it.
