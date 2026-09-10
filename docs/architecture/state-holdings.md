# State holdings architecture

Canonical state-scoped civic data belongs in `data/states/<st>/<domain>/`.
National and genuinely multi-state corpora stay in their domain folders. Source
code, tests and their fixtures, documentation, screenshots, and operational run
records are consumers or evidence and retain their own locations. Source-backed
data embedded in a code module is still a holding: single-state records are
extracted into canonical state JSON, while generic functions/types remain in a
distinct consumer module. The old holding path disappears. Genuinely multi-state
canonical modules have explicit exemptions and typed, offline manifest adapters.
Raw acquired
bytes that are unsuitable for Git remain in the vault or content-addressed asset
store. Ignored `public/states/<st>/{geo,streets}/` files are serving projections:
`pnpm state-holdings:project` derives them from canonical holdings during build
and development startup.

## Frozen migration denominator and permanent guard

`data/state-holdings/move-plan.json` classifies the exact candidate universe at
its recorded base SHA. Its source Git blobs, content digests, per-file reasons,
reference counts, exclusions, and exemptions make the identity checkable:
classified holdings = moved holdings + explicitly exempted holdings.
`move-report.json` records the atomic move and literal-reference sweep by file.
`manifest-inputs.json` freezes the discovered-state universe and exact input
hashes used at bootstrap, including the two external observations. These are
historical baselines, never a fixed list that limits future acquisitions.
Its append-only `authorityCutovers` classifications preserve an original
file/hash row while recording that the tracked file is no longer a current
holding after an exact transfer to a named production data-plane contract.
Generation accepts such a transfer only when the frozen hash and move-plan row
match, the old path is absent, and the promotion-only writer and Reader export
exist and agree with the permanent contract. A cutover therefore cannot hide a
missing file without proving its replacement.
The recorded A1 correction adds the canonical records originally embedded in
TypeScript at the same base SHA. It preserves the original snapshot hash and
records the added input denominator; no later acquisition enlarges this session.

`pnpm state-holdings:check` rejects old state layouts, missing moved holdings,
and stale path references, including composed path literals. The only old path
strings retained outside the move plan are individually hash-bound historical
fields in the frozen baseline, adopted governance ledger, and its adoption source.
Ledger wording is
immutable; its generated reader views resolve paths through the move plan.
Fixtures are independently rooted under `tests/fixtures/`.

## Generated state answers

`docs/states/<st>.md` is the canonical generated answer surface for what the
project holds for a state. Authoritative stores remain the registries,
acquisitions, snapshots, control plane, and databases. A manifest is a view,
never an independent authority. Its state set is discovered from holdings and
observations, including territories; a newly represented state requires its
manifest without a manually maintained state list.

The generator includes identity and corpus citations, held acquisitions,
normalized snapshots, domain/status obligations, source-universe versus
pilot-derived coverage labels, enumerated/adapted/discovery-owed jurisdictions,
open routes with due dates, and the reader surfaces that consume each dataset.
Counts state their denominators, and rendered tables carry their row counts.
The typed contract in `lib/holdings/datasets.ts` declares dataset families,
reader surfaces and consumers; existence tests reject broken references.
Any path named by a permanent production contract as `bootstrapFixturePaths`
is rendered in a separate immutable first-seed/test-evidence table, never as a
current repository authority. Production delivery requires the canonical
promotion pointer; tracked seed bytes may enter it only through the explicit
trusted first-seed adoption path and cannot update themselves.

## External observations and freshness

`data/state-holdings/control-plane-readback.json` comes from the existing
read-only Lane C verification instrument. Its holdings mode uses a single
SELECT; it does not bootstrap or mutate the production schema. The vault
readback verifies stored objects and asset-index bytes and persists metadata in
`data/state-holdings/vault-readback.json`. Both name their store, instrument,
schema/version and `observed_at`. The vault also records its bounded inventory
observation interval; acquisitions after enumeration belong to the next reading.

`pnpm state-manifest` and mutating `pnpm handoff` regenerate solely from committed
inputs. `pnpm state-manifest --check`, `pnpm handoff --check`, and CI compare
expected bytes and state membership without writing files or contacting a live
control-plane database or vault. Byte-current means current against those
observations; the displayed timestamps determine how old the observations are.
Refreshing observations is a separate explicit read-only acquisition step.

Future acquisitions automatically create manifest obligations. A discovery
after this session's frozen denominator is a next obligation unless it disproves
the architecture's acceptance criteria or exposes a regression from this move.
