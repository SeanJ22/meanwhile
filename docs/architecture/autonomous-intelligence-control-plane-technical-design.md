# Autonomous Intelligence & Engineering Control Plane — technical design specification

**Recorded 2026-08-28.** Derived from the hardened game plan
(*Meanwhile Autonomous Intelligence Architecture Game Plan — revised, campaign
finance, vault hardened*) and **reconciled against this repository** as
inventoried in
[`control-plane-current-system-inventory.md`](./control-plane-current-system-inventory.md).

This is not a restatement of the game plan. Where the plan and the repository
differ, the difference is named and resolved here, with the reasoning, so that a
later session does not silently re-decide it.

**Authority.** The game plan is target architecture and owner intent. The
repository and its numbered law are implementation truth. Under RULING 185 an
explicit author directive outranks both; where one was given (NH273's no-rollback
decision) it is implemented as given.

---

## 0. The reconciliation, in one table

| The plan says | This repo says | Resolution |
| --- | --- | --- |
| Five route dispositions: `YIELDED / ZERO / FAILED / ROUTE_BLOCKED / NOT_APPLICABLE` | Eleven, governed by RULING 184, three of which are open states wearing a finished face | **Repo wins.** The five are recorded as a *reading* of the eleven in `DESIGN_DOC_DISPOSITION_READING`. `FAILED` gets no mapping — it is three different facts. |
| Postgres is the canonical store for every entity | RULING 126 forbids campaign-finance data in Postgres **at all**, enforced by a test that enumerates every `pgTable` | **Repo wins.** Campaign finance is types + committed JSON. §A2.4. |
| Method registry to be built | `lib/method` already implements candidate → validation → assertion → inheritance, with a repo sweep enforcing one interface | **Repo wins.** The control plane adds the *runtime*, not the semantics. §A2.3. |
| Temporal-class durable workflow engine | No workflow engine; three workflows may hold a cron, asserted by name; an external scheduler would be invisible to every guard | **Deferred behind an interface.** §A7. Provider choice is owner-gated. |
| S3-compatible evidence vault | No vault. A hash-verified content-addressed external asset store already exists | **Plan wins, seam is the repo's.** The vault interface is S3-shaped; `writeCapturedFixture` is the acquisition boundary it generalises. §A2.5. |
| Post-deploy verification via `deployment_status` | `gh api .../deployments` returns **0** — the event has never fired here | **Neither.** Explicit trigger + freeze in the existing `gates` job. §A3.6. |
| "Build the full aircraft, turn switches on progressively" | — | Adopted unchanged. Everything below is Level 0 (shadow) by default. |

---

## A1. Service and module boundaries

One module tree, `lib/control-plane/`, deliberately inside this repository
rather than beside it — a separate service would be the second shipping truth
§8 of the inventory warns about.

```
lib/control-plane/
  ids.ts            derived identity + idempotency fingerprints
  work-item.ts      the durable obligation, dependencies, escalations
  route-task.ts     one route × one obligation, atomic disposition
  attempt.ts        bounded execution, leases, outcomes, cost
  completion.ts     THE evaluator — one deterministic answer
  preflight.ts      the inherited route floor, computed
  capability.ts     the policy engine
  budget.ts         shared host / vendor / credential budgets
  cost.ts           the cost ledger
  audit.ts          validation, contradiction, adversarial audit
  evidence/         artifact tiers, vault interface, parser boundary
  campaign-finance/ the domain package
  fixtures/         real proving obligations (Pima, campaign finance)
```

**Boundaries that are load-bearing rather than tidy:**

- **The control plane never owns civic truth.** It owns *whether an obligation
  may end*. Reader truth stays with the existing adapters, snapshot and registry.
- **The Work Graph is not a second tracker.** `docs/tracker-*.csv` remains the
  author-facing store with `scripts/tracker.mjs` its sole writer. Control-plane
  obligations are execution state; a Needs Sean row is still a tracker row.
- **The method registry is not re-implemented.** `preflight.ts` calls
  `projectMethodFor` and nothing else.
- **The evidence vault is not a second asset store.** It extends the
  content-addressed store `lib/ops/asset-remote.ts` already operates.
- **The workflow engine is an adapter, not a dependency.** Nothing in the
  domain layer imports it. §A7.

---

## A2. Core schema

### A2.1 Execution — implemented

```
WorkItem ──< RouteTask ──< Attempt ──> ExecutionLease
                 │             └──> Artifact*
                 └──> RouteDisposition (atomic, one, terminal-or-open)
```

| Entity | Key invariants |
| --- | --- |
| `WorkItem` | Durable. 14 states, 8 terminal, **every terminal state an affirmative finding** — there is no `NOT_FOUND`, no `EXHAUSTED`, no `GAVE_UP`, because those describe a session and a session may not describe a government. |
| `WorkDependency` | `kind ∈ {PRODUCES_CONSUMES, OWNED_DOMAIN_OVERLAP, DEFINES_SCOPE}` + `evidence[]`. Mirrors `classifyOrchestration`: an edge backed by prose alone is unproven. |
| `CompletionContract` | `inheritedRouteFloor[]`, `requiresValidation`, `requiresAudit`, `requiresCompleteDenominator`. Defaults are the SAFE reading. |
| `RouteTask` | `PENDING → CLAIMED → (DISPOSED \| RECLAIMABLE)`. Carries `inherited: boolean` — an inherited route with no disposition is the single most important refusal in the system. |
| `Attempt` | Outcome ∈ `COMPLETED, ABORTED, TIMED_OUT, LEASE_EXPIRED, CRASHED, DENIED_BY_POLICY`. Pins `methodVersion` and `policyVersion` for replay. A non-`COMPLETED` outcome **must** name an `abortReason`. |
| `ExecutionLease` | Time-bounded, heartbeat-renewed, expiry evaluated against a caller-supplied `now`. An expired lease cannot be renewed — only re-claimed. |
| `RouteDisposition` | Written **only** by a `COMPLETED` Attempt. `INGESTED` with no artifact is refused. `WALKED_NO_YIELD` with a non-`REACHABLE` transport is refused. |

**Identity is derived, never assigned.** `workItemId`, `routeTaskId` and
`leaseId` are pure functions of their inputs, so two workers that independently
decide the same route must be walked collide instead of duplicating a side
effect. `attemptId` folds in the claim moment, because two attempts on one
RouteTask must remain distinguishable.

### A2.2 Verification — implemented

`ValidationRecord`, `Contradiction`, `AuditFinding`.

`AuditFinding.startedFrom` is the independence mechanism: an audit whose
evidence base is only `OUR_SUMMARY` **cannot discharge** a `requiresAudit`
contract. Independence requires `PUBLISHER_SOURCE_UNIVERSE`, `EVIDENCE_VAULT`,
or `INDEPENDENT_FIRST_PARTY_ACQUISITION`. The 13 permanent attack modes include
`POLITICAL_NEUTRALITY`, `REPRODUCIBILITY` and `CAMPAIGN_FINANCE_COVERAGE`.

### A2.3 Method — reused, with a named runtime gap

The control plane **adds no assertion model**. It consumes
`projectMethodFor(knowledge, jurisdiction)` and adds:

| Gap | Design |
| --- | --- |
| No durable candidate | `MethodCandidate` record: stable id, submitting Attempt ref, `submittedAt`, lifecycle `PROPOSED → VALIDATED → ADMITTED \| REJECTED`, **and a retained rejection record** — today a refused candidate leaves no trace. |
| Validation is post-hoc | `validateCandidate(candidate, store)` as a **pre-admission gate** reusing the exact rule functions. `runLearnBatch` currently writes unconditionally. |
| No conclusion corpus | Persist `PriorConclusion` at the moment an absence/blocked/dark/converged disposition is written, stamped `earnedAtVersion = store.version`. **`data/method/conclusions.json` does not exist today**, so the reopening engine has zero production inputs. |
| No write serialisation | An `expectedVersion` precondition on the store write. Six writers currently race one JSON file. |
| Provenance names a route, not an Attempt | Additive `attemptId` on `ClaimProvenance`. |

### A2.4 Campaign finance — types, not tables

**RULING 126 is binding and the deviation from the plan is deliberate.**

```
FilingAuthority / FilingRegime   ← the discovery question
PoliticalCommittee
CampaignFinanceFiling            ← versioned, amendment lineage
  ├─ Contribution                (INTO a committee)
  ├─ Expenditure                 (BY a committee)
  └─ IndependentExpenditure      (BY an outside entity)
       └─ SupportOpposeRelation  SUPPORTS | OPPOSES → candidate or measure
CampaignFinanceCoverage          ← the per-contest obligation
```

Four invariants, each a seeded test:

1. **The filing authority's level need not match the office's level.** Arizona
   routes by A.R.S. § 16-928: Secretary of State for statewide and legislative;
   **the county officer in charge of elections** for county, school-district,
   community-college and special-district; the **city or town clerk** for city
   and town.
2. **FEC absence never closes a local race.** An empty federal record yields an
   OPEN coverage state naming the state/local routes still owed.
3. **An independent expenditure is never money received.** `IndependentExpenditure`
   and `Contribution` are structurally distinct, and the "total received"
   function cannot reach the former.
4. **Coverage fails closed.** Complete for 3 of 4 candidates means **no**
   candidate-level finance feature renders for that contest.

### A2.5 Evidence — three artifact tiers

```
RAW               ordinary immutable acquired bytes
RESTRICTED_RAW    exact bytes of credential-bearing material; encrypted,
                  access-controlled, excluded from git, logs and prompts
SANITIZED_DERIVED the worker- and parser-facing artifact
```

`ArtifactDerivation` carries `rawHash`, `derivedHash`, `sanitizerVersion`,
`redactionsByClass`, `distinctValuesRedacted`, `substringsReplaced` and
credential **fingerprints** — never values. This generalises the boundary PR
#217 already built for 73 fixtures: `lib/ops/fixture-credentials.ts` supplies
the classifier and sanitizer unchanged, and `writeCapturedFixture` is the
acquisition seam.

`EvidenceSpan` (page / row / field / offset) links a claim to the exact
supporting bytes, so *"where did this come from"* is a deterministic lookup
rather than a generated answer.

### A2.6 Operations

`HostBudget`, `VendorBudget`, `CredentialBudget`, `CostLedger`,
`CapabilityGrant`, `Escalation`, and the NH273 `IntegrityRecord`.

---

## A3. State machines

### A3.1 WorkItem

```
OPEN ──> BLOCKED ──> OPEN
  ├──> AWAITING_VALIDATION ──> AWAITING_AUDIT ──> VERIFIED_COMPLETE
  ├──> AWAITING_OWNER ──> (AUTHOR_DECISION_REQUIRED | OPEN)
  └──> REOPENED ──> OPEN            (auditor or new method)
Terminal, each requiring affirmative evidence:
  VERIFIED_COMPLETE · HUMAN_INTERACTION_REQUIRED · OFFLINE_PUBLIC_ACCESS
  RECORDS_REQUEST_REQUIRED · NOT_YET_PUBLISHED · RECORD_NOT_YET_CREATED
  LEGALLY_WITHHELD · AUTHOR_DECISION_REQUIRED
```

### A3.2 RouteTask and Attempt

```
RouteTask:  PENDING ──claim──> CLAIMED ──COMPLETED Attempt──> DISPOSED
                                   └──dead Attempt──> RECLAIMABLE ──> CLAIMED

Attempt:    (open) ──> COMPLETED         → may write a disposition
                  ──> ABORTED | TIMED_OUT | LEASE_EXPIRED | CRASHED
                                          → artifacts kept, NO disposition,
                                            RouteTask reclaimable
                  ──> DENIED_BY_POLICY    → same, plus a policy finding
```

**`ATTEMPT_ABORTED` is execution state and is never a `RouteDisposition`.** The
judgement is made from *outside* the worker: a worker that dies cannot report
that it died, so the only honest reading is a lease that stopped being renewed.

### A3.3 MethodCandidate → MethodAssertion

```
PROPOSED ──validate──> VALIDATED ──> ADMITTED ──> inherited by projectMethodFor
    └──> REJECTED (record retained, with the reason)
ADMITTED ──upstream retracted──> FLAGGED_FOR_REVALIDATION
```

A withdrawn assertion is withheld from the projection under a named
`WITHHOLDING_REASON` and its text moves to `statementNotCurrent`, so a consumer
collecting `.statement` cannot pick it up by shape. **Route existence survives a
withdrawn conclusion.**

### A3.4 AuditFinding / Escalation

```
AuditFinding:  OPEN ──> (SURVIVED | BROKE ──> WorkItem REOPENED) ──> RESOLVED
Escalation:    OPEN ──> SNOOZED ──> OPEN ──> RESOLVED
               (never silently aged: age, response target and blocked-descendant
                count are all visible)
```

### A3.5 CampaignFinanceCoverage

```
UNSTARTED ──> AUTHORITY_UNRESOLVED ──> AUTHORITY_RESOLVED
          ──> ACQUIRING ──> PARTIAL(named per-candidate gaps) ──> COMPLETE_THROUGH(date)
Any state ──amended filing──> SUPERSEDED_CLAIM (history preserved)
```

### A3.6 Production integrity and the release freeze — implemented (NH273)

```
CURRENT · STALE_HEALTHY · DEGRADED · UNKNOWN · CREDENTIAL_MISSING

DEGRADED           → freeze every production-changing release
CREDENTIAL_MISSING → freeze production-changing releases that move the schema
UNKNOWN            → same
STALE_HEALTHY      → no freeze, but may never be reported as CURRENT
docs-only change   → never a production release; cannot thaw a freeze
```

**No automatic rollback exists, by owner decision.** The database may already
have advanced; rolling code back underneath an advanced schema manufactures a
second incompatibility. A test greps all three source files for rollback shapes,
with a positive control proving the detector fires.

---

## A4. Completion semantics

One pure, total, default-refusing evaluator: `evaluateCompletion(snapshot,
proposedState) → CompletionVerdict`. Thirteen named refusal codes. An input the
evaluator was not given is a reason to refuse, never to proceed.

| The plan's rule | The mechanism |
| --- | --- |
| One failed route ≠ one failed fact | `OPEN_DISPOSITIONS` keep the RouteTask outstanding; the item cannot reach a terminal state. |
| Remaining lawful routes keep the frontier open | `INHERITED_ROUTE_WITHOUT_DISPOSITION`, naming the exact route. |
| A worker may finish an Attempt; only the control plane completes a WorkItem | `endAttempt` is the worker's ceiling; `evaluateCompletion` is the only path to terminal. |
| A known inherited route omitted ⇒ completion refused | The floor is **computed** at preflight from `projectMethodFor` ∪ the adapter's declared routes, and materialised as one RouteTask each — so an omission is a missing row, not an unmentioned one. |
| An unproven method conclusion cannot become inherited authority | `projectMethodFor` withholds it; the control plane never reads raw prose. |
| A new method reopens older conclusions | `findReopenings` + the persisted `PriorConclusion` corpus (§A2.3). |
| The adversarial auditor can reopen settled work | `AUDIT_BROKE_THE_CLAIM` → `REOPENED`. |
| Coverage denominators | `requiresCompleteDenominator`; `denominatorComplete: null` means *never established* and refuses. |

---

## A5. Permissions — least privilege by role

| Role | Has | Must never have |
| --- | --- | --- |
| Scout | public network read, vault write, candidate propose | canonical promotion |
| Acquirer | public network read, vault write, browser | canonical promotion |
| **Parser** | **sanitized vault read only** | **any network capability; restricted-raw read** |
| Detective | public network read, sanitized + restricted vault read, candidate propose | canonical promotion |
| Engineering | branch write | merge to main; production write |
| Validator | vault read, canonical promote (gated) | assertion promotion by fiat |
| Adversarial Auditor | public network read (independence requires it), vault read | promotion of anything |
| Release Orchestrator | merge to main, production DB read | production DB write |

Granted to **no** role by default: `PRODUCTION_DB_WRITE`,
`EXTERNAL_COMMUNICATION`, `RECORDS_REQUEST_SEND`. Those are owner-gated.

`authorize()` refuses by default: an unknown capability, or a role with no
grant, is refused rather than allowed.

**Source text is untrusted data.** An acquired page never becomes an
instruction. Political neutrality / coverage symmetry is an `ALWAYS_ON` policy
that has no disable path — attempting to turn it off throws.

---

## A6. Concurrency and cost

- **Leases** — claim / heartbeat / expire / reclaim, all against a supplied
  `now`. A live lease held by another worker refuses the second claim; "I am
  sure the other worker is dead" is exactly the belief that produces two
  concurrent writes.
- **Idempotency** — derived ids (§A2.1) plus content hashes collapse duplicate
  acquisition.
- **Budgets are SHARED, and that is the whole point.** Twelve workers touching
  one publisher contend on **one** `HostBudget`. A `VendorBudget` constrains the
  sum across a vendor's hosts; a `CredentialBudget` an API key's quota. Per-worker
  politeness cannot multiply into abusive traffic.
- **Retry/backoff ownership** — the workflow engine owns runtime retry and
  heartbeat; the domain layer owns durable truth. **No competing scheduler in
  Postgres.**
- **Cost** — per Attempt: tokens, dollars, duration, bytes, requests. An
  unmeasurable field is `null`, never 0, and rollups report `measured` beside
  `unmeasured` rather than averaging a gap away.
- **COST INFORMS SCHEDULING, NEVER TRUTH.** There is no function anywhere that
  takes a cost and returns anything about whether a fact is true or worth
  correcting. A source sweep asserts it.

---

## A7. Provider interfaces

Provider-neutral capability interfaces; concrete providers are owner decisions
and **none was made while the author slept**.

| Capability | Interface | Default recommendation | Status |
| --- | --- | --- | --- |
| Durable workflow | `WorkflowEngine` adapter | Temporal Cloud + TS SDK | **Owner-gated** (billing). Domain layer has no dependency on it. |
| Evidence vault | `EvidenceStore` (S3 semantics) | S3-compatible (R2 or equivalent) | **Owner-gated** (account). A deterministic in-memory adapter exists for tests **and is explicitly not production durability**. |
| Canonical operational store | Neon / Postgres | Already in use | Present — except campaign finance, per RULING 126. |
| Analytics | Parquet + DuckDB | As recommended | Not yet needed; no measured requirement. |
| Worker runtime | OCI containers on managed autoscaling compute | As recommended | Owner-gated. |
| Model routing | provider-neutral `WorkerAdapter` | per task/quality/cost | Interface only. |

**No Kafka, Kubernetes, Redis or vector database.** None has a measured
requirement, and the plan says so explicitly.

**The scheduler constraint is real and binds any engine choice:** three
workflows may hold a cron, asserted by name; an *external* scheduler would be
invisible to every guard in this repository and would silently falsify
`maxScheduledBuildsPerMonth()`. Adopting a durable engine therefore requires a
dated ruling, not just an account.

---

## A8. Threat model

| Threat | Protection | Where |
| --- | --- | --- |
| Prompt injection in pages/PDFs | Source text is data. Workers receive artifacts, never instructions. Parsers have no network and no ability to act on content. | §A5, evidence parser boundary |
| Malicious files / parser exploits | Sandboxed parsing with size, decompression, CPU, memory and timeout limits; parser has no outbound network. | `assertNoNetwork` |
| Source poisoning / official-looking sites | Publisher identity validated before promotion; body identity comes from the registry (R-0197), never from an adapter. | `tenant-body-binding.ts` |
| **Publisher-emitted credentials** | Detected at acquisition; exact bytes quarantined as `RESTRICTED_RAW`; ordinary workers get the sanitized derivative; logs carry fingerprints and never values. | §A2.5 — the #217 class |
| Credential leakage (ours) | Scoped grants; no secret in prompts, git or artifacts; the sweep in `lib/ops/secret-redaction.ts` scans by value. | §A5 |
| Runaway crawling | Central per-host concurrency, crawl delay, quotas, backoff. | §A6 |
| Cross-worker rate amplification | One shared `HostBudget` across all workers. | §A6 |
| Duplicate effects | Derived ids + content hashes + leases. | §A2.1 |
| Stale model/provider | Every Attempt records provider, model and version. | `WorkerRef` |
| **Partial-disposition poisoning** | Only a `COMPLETED` Attempt may dispose of a route. | `mayWriteDisposition` |
| **Bad method compounding** | Evidence required before inheritance; dependents flagged on upstream retraction. | `lib/method/claims.ts` |
| **Political asymmetry** | Always-on neutrality; matched-candidate symmetry check; features fail closed on partial coverage. | §A2.4 |
| Semantic non-reproducibility | Time is always a parameter; ids are derived; the same immutable inputs must produce the same canonical identities. | §A2.1 |
| **Schema/deploy split brain** | The NH273 freeze. GitHub green is not production truth. | §A3.6 |
| Audit anchoring | An audit rooted only in `OUR_SUMMARY` cannot discharge an audit requirement. | §A2.2 |
| Cost runaway | Per-project caps with hard refusal; unmeasured is never counted as zero. | §A6 |

---

## Owner decisions isolated behind interfaces

Each is a node in the graph, not a stop. Everything downstream that does not
depend on the decision is built.

| Decision | Recommended default | Blocked by it |
| --- | --- | --- |
| `WTP_PRODUCTION_DATABASE_URL_READONLY` as a repository secret (**NH272**) | Add it; the value already exists and is proven read-only | Live CI proof of the schema gate; automatic clearing of a `CREDENTIAL_MISSING` integrity state |
| Durable workflow provider + billing | Temporal Cloud | Runtime retry/heartbeat. Domain state is unaffected. |
| Object-storage provider + billing | S3-compatible (R2) | Production vault durability. Interfaces, contracts and tests are complete. |
| Raw-evidence retention policy | Long-lived for governed public evidence; explicit exceptions for sensitive content | Vault lifecycle rules |
| Model/compute budgets and hard-cap behaviour | Per-project daily and monthly caps, fail safe | Cost enforcement thresholds |
| Escalation response clocks | Severity-based, visible blocked-descendant counts, explicit snooze | Needs You policy |
| D23 — 52 U.S.C. § 30111(a)(4) commercial-use question | Counsel closes it, nobody else | FEC contributor display beyond the existing ripcord |

---

## What is deliberately NOT designed here

- **A Control Center UI.** The plan puts it at Stage H, and the plan is right:
  polishing a dashboard before canonical state exists produces numbers with no
  denominators.
- **A second scheduler.** See §A7.
- **Autonomous canonical promotion.** Everything attaches in SHADOW. Reader
  truth stays with the existing adapters until promotion contracts exist and
  have passed.
