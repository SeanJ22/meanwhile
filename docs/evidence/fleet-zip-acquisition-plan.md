# ZIP acquisition assignment plan

This follows commit `58d5cdc7` and preserves its ZIP preparation files and
evidence unchanged. `lib/control-plane/zip-acquisition-plan.ts` adds the pure,
versioned `fleet/zip-acquisition-plan@1` planner. The new
[example](fleet-zip-acquisition-plan.example.json) maps the same four pilots and
inert candidate ZIP 85122 to existing registry-provider obligations and, where
held, actual historical occurrence/work/task identities. It performs no
registration, dispatch, network access or production resource reads.

## Actual result from committed inputs

| Measure | Result |
| --- | ---: |
| Shared ZIP preparation references examined | 125 |
| Candidacies assigned by exact canonical subject ID | 80 |
| Jurisdictions linked to meeting obligations only | 11 |
| Candidacies with no owed enrichment under existing provider rules | 11 |
| References missing a supported acquisition assignment | 23 |
| Ambiguous reference assignments | 0 |
| Unique existing provider obligation IDs referenced | 272 |
| Validated historical occurrence → WorkItem → RouteTask links | 17 |
| Broken historical links found among matched occurrences | 0 |
| ZIP tier/playbook gaps without a typed coverage-task assignment | 5 |

The 23 missing reference mappings are named individually in the example:
19 jurisdiction/geographic references and four source-corpus refresh references.
Some geographic divisions are statistical places; missing mappings do not prove
that another government or another acquisition task must exist there.

The five ZIP coverage gaps are separately reported, **not added to the 125
reference denominator**. Meeting or candidate enrichment acquisition is not a
typed assignment to territory resolution, body enumeration or every playbook
requirement. All five remain `MISSING_TYPED_COVERAGE_ASSIGNMENT`, with the
original tier-next-step text and named gaps preserved. No task ID is invented
to make that column look complete.

All four source-corpus references have named downstream enrichment reuse IDs.
Their source-refresh assignment remains missing: enriching a held candidate is
not reacquiring the authority's full filings. Reuse links are bounded to the
prepared candidacy references, while corpus provenance counts and the existing
authority population qualifications remain intact. All applicable held rows
being available never establishes the authority's complete universe.

## How the mapping is established

The unchanged `buildRegistry` runs the candidate-enrichment,
local-jurisdictions, meetings and campaign-finance providers against committed
inputs. They produce respectively 1,720, 1,177, 78 and 16 route units, with no
read failures. This is provider enumeration, not proof that any unit is currently
registered or running in production. The bounded plan references 272 of those
units and does not activate the others.

| Relationship | Existing authority used |
| --- | --- |
| Candidacy → acquisition portfolio | Exact `CandidateUniverse.candidacies.id` = `ProvidedObligation.subjectId`; record class must be `candidate-enrichment`. Every representation retains its existing provider-generated `FreshnessObligation.id`. |
| Jurisdiction → meeting portfolio | Explicit `ocdId` and `bodyId` fields from `readSnapshot()`, the same snapshot the meetings provider reads; exact body ID joins to its subject. |
| Source corpus → downstream reuse | Exact committed path at the start of `CanonicalCandidacy.provenance`, using its recorded separator, then the canonical candidate subject. This is a provenance edge, not a source-refresh assignment. |
| Obligation → historical task | Exact `FreshnessOccurrence.obligationId`, `workItemId` and `routeTaskId`; the corresponding WorkItem and RouteTask must exist and agree on subject, work ownership and route. |

The local-jurisdictions provider uses IDs such as
`az:county:county-of-pima`; ZIP overlap references use OCD divisions. The planner
does not invent a slug conversion or assume name resemblance proves identity.
Campaign-finance subject keys also describe different record universes. Their
provider reports remain visible, but unsupported joins are left unassigned.

For example, the actual provider ID
`freshness:meetings:ocd-division/country:us/state:az/county:pima#central-arizona-water-conservation-district`
links through committed occurrence history to WorkItem
`wi-aeb9d4bc9599629ae3dca7ae` and RouteTask
`rt-91db32a0d7ac7f53d932eec0`. That occurrence is historically closed; the plan
does not call it a live runnable task. IDs are read, never reconstructed.

## Contract and integration boundaries

`ZipAcquisitionPlanInput` accepts existing `PreparedZipQueues`, registry units
and reports, canonical candidate universes, meeting membership, and historical
`FreshnessOccurrence`, `WorkItem`, and `RouteTask` values. The example loader
selects each aggregate's highest **committed** revision from
`data/control-plane/freshness-shadow/aggregates`; it never opens a mutable
repository or consults live credentials. The fixed provider time is an explicit
reproducibility parameter, not the time these holdings were observed.

The output distinguishes direct assignment, meeting-only assignment, no owed
enrichment, missing assignment and ambiguity. Duplicate provider obligation IDs
or duplicate canonical candidacy identity fail the affected mapping closed;
independent valid mappings continue. Provider read failures remain reported,
never converted into an empty domain. Broken historical identity links are
named without exposing a plausible substitute task. Each unit retains its
executor class, opening kind, citation and existing route blocker; permission
uncertainty and missing adapters remain blockers.

`mode: PLAN_ONLY`, `activation: NOT_AUTHORIZED` and
`runtimeObservation: UNKNOWN` are invariant. The planner is executable local
code, not a scheduler or task ledger. Provider-defined IDs identify the intended
existing acquisition obligation; historical task links describe past occurrences
and are not dispatch instructions. Live registration, autonomous-plan availability,
current admission, lease, retry and permission checks require the existing
authorized runtime's fresh read before execution. PDC retains production
operations and its authority/proof contracts; Claude retains Admin UI. Neither
integration owner receives a new policy, ledger or freshness clock here.

## Verification

```text
node --test --experimental-strip-types --import ./scripts/register-test-loader.mjs tests/zip-acquisition-plan.test.ts
```

Four focused tests exercise the real producers into this consumer and reproduce
the actual example. They trap outbound fetch, prove input immutability, compare
named provider/route identities, preserve each representation, distinguish
source reuse from source-refresh assignment, expose duplicate identity and
provider-read failure, and reject a corrupted historical work/task join.

Remaining integration work is precisely the missing typed identity/coverage
assignments above, a fresh authorized runtime read of the matched obligations,
and source-universe/reader verification under existing policies. This evidence
does not prove new data acquired, a live fleet run, publication, current ZIP
completion or activation. No new retrieval rung was learned in this local
planning work.
