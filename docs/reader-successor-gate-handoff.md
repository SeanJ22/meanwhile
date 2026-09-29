# Reader successor-state gate, 2026-09-28

The historical V1 production authority is still admissible as evidence for its
original exact-head proof. It has only whole-set hashes, so it cannot identify
which canonical key changed after that proof. A V1 live mismatch remains a
terminal failure; it cannot be repaired by re-hashing or relabeling the old
artifact.

The V2 authority builder now commits each canonical key's exact pointer row,
current candidate row, and ordered candidate events. The independent closure
and proof-head validators require the complete ordered key set. The terminal
comparator admits unchanged pointers with only append-only candidate events;
it refuses a rewritten candidate or history, changed key population, changed
source identity, or changed controller/store identity. For a changed pointer,
the read-only historical check reconstructs the certified predecessor and
follows every atomic pointer move through a GOOD promotion proof. This proves
lineage, **not public delivery**. Changed pointers remain terminal failures.

`scripts/reader-last-mile-successor-readback.mts` defaults to a no-network,
no-provider planner. Its plan output records zero public and paid requests. It
compares every canonical census record and row before listing affected surfaces
and applicable rows, and exits nonzero for V1, unknown classes, changed
projection/eligibility, or a changed pointer awaiting actual public readback.
Its `NO_CHANGED_POINTER_READBACK_REQUIRED` result is advisory;
`pnpm reader:production-closure` remains the terminal gate.

An explicit `--execute` mode is a bounded, read-only hosted observation seam:
at most 256 named GET probes plus two `/api/build` reads, restricted to
representation, meetings, agenda, and current votes. The GET planner currently
accepts only a state-vote `member` query exactly equal to the changed canonical
pointer scope; wider meeting and jurisdiction scopes still lack a safe
candidate-to-route join and therefore fail closed. It uses the same route
handler locally against the read-only production handle, compares the complete
public JSON response, records exact native IDs/counts and payload hashes,
reconciles those with every affected census row, and brackets the work with
equal full production authority reads and an immutable GOOD-chain check.
It refuses incomplete rows and unknown routes. The mode has not been run
against production; no paid or hosted calls were made for this change. Its
readback result is still pending terminal admission wiring and cannot by
itself make `reader:production-closure` pass.
For the single registered Morris ballot filing key, the guarded ballot mode
also reuses the existing exhaustive NJ ZIP set-cover and actual public DOM
assertions. It requires the canonical public origin, the exact promoted filing
version in the local source selector, the deployed build before and after, and
separate write-once evidence/plan paths. It refuses more than 32 ZIP
navigations. Each public ballot page now exposes the version ID of the
promoted NJ filing it actually selected, and the observer requires exact
equality on every ZIP. This is source code only; it has not made a hosted
request. Other affected classes and surfaces still block terminal admission.

Outside ballot mode, the maximum hosted request count for one execution is
258 GETs, with zero model/provider requests and zero database writes. Ballot
mode adds up to 32 public navigations and two more `/api/build` reads. Two full read-only authority
reads, a fresh canonical census projection, and per-changed-key historical
candidate reads are additional database reads; their wall time and read count
must be measured on a real run rather than estimated as dollars.

One changed MEETING source/body partition can additionally use a guarded map
observer. The ordinary `/api/meetings` response now includes only the promoted
partition versions that contributed returned meeting IDs. The observer reads
that exact partition's current promoted version and at most 16 member IDs,
opens one named ZIP in the public map, requires the API's exact scope/version
and complete member ID set, and checks each actual meeting-list row. A cached
old version, an ambiguous source/body join, a partial radius result, or more
than one changed MEETING pointer fails closed. This does not prove agenda,
Ask, other meeting partitions, or unrelated map content. It has not been run
against the hosted site; the successor terminal gate remains red.

At the preserved live-drift diagnosis, 21 canonical pointers had advanced:
11 REGISTRATION, 4 MEETING, 2 MEETING_OUTCOME, and one each of BALLOT_FILING,
CENSUS_GEOGRAPHY, CURATED_READER_RECORD, and STATE_LEGISLATOR_VOTES. These
classes conservatively reach all 13 public Reader surfaces. The certified
census contains 352 applicable affected family/surface/state rows and 47,710
applicable record-surface pairs for that class set. These are an upper bound,
not a claim that 47,710 records changed or that 47,710 HTTP calls are needed.
The exact per-key route/identity join is not yet published.

The remaining hosted seam must cover changed keys beyond the single guarded
Morris ballot and one-partition map modes, plus voting sites, funding,
positions, civic routing, about-area, and other affected surfaces through
their actual public selectors, not through a proof-only endpoint. It also needs
a generated, exact-key route/identity plan so unchanged scopes can retain their
prior proof. A fresh current canonical census must keep the same held denominator and eligibility;
unknown or changed eligibility requires new full proof. Actual changed-scope
readbacks must run between two equal production authority reads, with the
certified predecessor and GOOD move chain still present. The current four-ZIP
production observer does not cover arbitrary changed keys. Grounded Ask may
call a paid model; under the no-paid-call instruction its affected cases need
a deterministic no-model path through the actual public answer route, or must
remain blocked. A proof-only endpoint that bypasses the public selector would
not establish delivery. No hosted successor readback or provider call has been
executed by this change.

One fresh exact-head full Reader proof and closure with V2 authority is required
before any per-key successor can inherit it. The current V1 proof remains
historical; its live drift is not certified by this branch. After V2 proof,
ordinary full gates and the post-deploy production closure still apply.
