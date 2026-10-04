# Method data boundaries

`conclusions.json` is a versioned software/method input.

`candidates.json` is the immutable 2026-09-02 cutover seed evidence only. Its
Git blob is `5ca91ada3d17f18c64abe346a31351d1d37337b9`; it is not live state and no
runtime process may read or write it. The mutable candidate lifecycle lives at
`cp_method_candidates/live` in the standing control plane. No adoption receipt
is required: a research round that cannot read the store skips candidate
proposals and carries on.

## The live method store is the field manual

Learned routes and the method version live in the field manual
(`cp_field_manual/live`), read and written by every role through
`readFieldManual` / `writeFieldManual` in `lib/control-plane/field-manual.ts`.
`lib/method/manual-bridge.ts` turns it back into the method knowledge the route
floor and the proposal check read (`readMethodKnowledge`), and into the method
version (`readMethodVersion`: the version the old file ended at, 92, plus one for
every route an agent has learned since). Dispatch reads which routes are learned
from the manual (`methodMaturityFromManual`), so a route an agent writes as a
`ROUTE` entry graduates on the next dispatch with no human step.

`data/method/knowledge.json` is gone. Its last content is the test fixture
`tests/fixtures/method-knowledge.json`, which tests read for real route data and
no production code reads.
