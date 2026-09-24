# Reader proof image locations

Historical report bytes, exact-head claims and witness hashes remain unchanged.
`data/ops/evidence-locations.json` records each original image name, its serialized
relative alias, the permanent evidence destination and the original SHA-256.
The maintained witness reader and census image reader resolve these exact names
through `lib/holdings/evidence-location.ts`; they verify destination bytes and
reject an inconsistent surviving original. This is path resolution, not a proof
renewal, a new product asset store or permission to weaken a witness check.

The evidence home is `meanwhile-evidence` beside the main checkout, located from
Git's shared directory so a temporary worktree does not create a second store.
Internal proof images stay separate from `wtp-assets` product portraits. The
location manifest retains original run identity and filenames; image bytes and
the existing private recovery stay outside Git.

The local consolidation verified 725 images, including 79 runtime visual-case
images discovered in the existing proof chain. Seven affected historical
artifacts and their 35 recorded file-hash bindings remained unchanged:

- `reader-last-mile-render.json`
- `reader-last-mile-render-federal-money.json`
- `reader-last-mile-finance-witnesses.json`
- `reader-last-mile-final-closure-component-proof-composition.json`
- `reader-last-mile-surface-witnesses.json.gz`
- `reader-last-mile-surface-witnesses.json.pack.json`
- `reader-last-mile-final-pack.json`

All 687 referenced image paths found in those artifacts and the current render
reports resolved without rewriting the artifacts. The separate plain/gzip
historical versions remain distinct. No live proof generator, database query,
automatic-promotion acceptance test or product write was run for this migration.

Local readback: `node scripts/evidence-locations-check.mts <checkout>` verifies
every manifest name and its alias. It requires the machine's permanent evidence
home. CI uses disposable image fixtures, including missing originals, corrupted
copies, ambiguous names and traversal refusal; it does not pretend the private
machine evidence exists on a hosted worker.

The source worktrees remain protected until this resolver is merged and adopted
by **every retained maintained consumer**, including the older held main
checkout. Historical executable replay copies retain their restore mappings.
A merged code change alone does not release a still-used source directory.
The detailed private preservation and binding receipts are in
`D:\Meanwhile Recovery\2026-09-19\approved-local-cleanup\screenshot-consolidation`.

## Added later: the #387 full reproof

The PR #387 full reader reproof (proof head `48ade9df`, proof commit `597518a2`)
wrote 395 images in a temporary worktree. They were copied, not moved, to
`reader-last-mile/pr387-48ade9df-597518a2` and recorded the same way: original
absolute name, one main-checkout-relative alias, destination and SHA-256. The
manifest now holds 1,120 images. The seven proof-head artifacts that cite them
were not rewritten. Their 402 absolute references resolve directly. Their 172
witness references are run-relative (`screenshots/reader-last-mile/...`) and
resolve through the proof checkout the same reports name; all 143 recorded
hashes match. Four failure captures from an earlier attempt are preserved
unreferenced.

A run-relative name is never an alias. Older runs cite the same names with
different bytes, so an alias would hand a later reproof this run's images. A
recorded absolute name is different: a new proof run inside a checkout whose
images are recorded here is refused by the witness reader, because its changed
original no longer matches.
