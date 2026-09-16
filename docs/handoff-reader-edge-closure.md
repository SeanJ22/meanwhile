# Handoff — reader edge-serving, and the post-cutover closure wall

Written 2026-09-15 for a session with **no prior context**. Read this top to bottom before touching the branch.

Branch: `claude/reader-loading-blanking-ballot-footer-b132d3`. Two commits sit on top of the A-G tip `513e4784`:

- **`092b8089`** — the edge-serving reader architecture (the change).
- **`f177470f`** — a `docs/state.md` ship-status note.

**Nothing is merged or deployed. It is not live.** The consumer site still runs the old (slow-cold-start) `main`.

---

## 1. What the edge-serving work does

`/api/meetings` used to read **seven** PDC data families from Postgres on every visit, so a cold first visit after inactivity paid the Neon compute wake — **2.5–7.5 s measured**. This work moves all seven onto a runner-published, versioned, immutable **edge-serving layer (Netlify Blobs + durable CDN)**, so the normal reader path never wakes the database.

- **Geographic meeting artifacts** — per-state immutable artifacts + a monotonic-CAS manifest (`lib/meetings/edge-artifacts.ts`, `edge-store.ts`, `edge-serving.ts`). Publish is atomic (manifest written last), idempotent, and last-valid-safe.
- **Four large "authority families"** — `registry-runtime`, `federal-directory`, `campaign-sites`, `state-legislators` — each a compressed immutable national artifact the manifest points at. The reader primes them **request-scoped** via a Node `AsyncLocalStorage` bundle (`lib/registry/runtime-edge.ts` → `enterReaderAuthorityEdge`), so the runner and workers keep the authoritative `refresh*FromPromoted` DB path unchanged.
- **Prepared-snapshot foundation** — the runner composes the meetings snapshot once at promote time into a durable serving row (`lib/meetings/prepared-snapshot.ts`, table `civic_data_reader_projections`, migration `0028_wise_ikaris`). The reader reads one row, falling back to the composing reader (which first-seeds under a test fixture) so a store with neither edge nor DB degrades gracefully rather than 503-ing.
- **Search-log write moved off the response path** to a fire-and-forget `POST /api/log` `sendBeacon` (`components/map/map-entry.tsx` → `lib/log/client.ts`). Per-state artifacts are cached in-process, sha-gated.
- **Admin observability** — `lib/meetings/edge-observability.ts` (version / freshness / lag / failures).

**Measured (local `next start`, local-file edge store, Neon SUSPENDED, fresh process):** cold first `/api/meetings` = **180 ms, HTTP 200, `getDb()` = 0**; warm 20–58 ms; distant ZIP 31 ms; newly-promoted appears without rebuild/reload; desktop + phone verified. The one unmeasured piece is the deployed same-region function→Blobs read latency (needs a deploy or Netlify creds to benchmark) — bounded same-region object-storage reads, not a DB cold-start.

**Tests:** full `pnpm test` = **6733 pass / 4 fail / 1 skip**. The 4 failures are the deferred ship-ceremony items (`generated-artifacts` RULING 92 + 102 digest regen; `reader-last-mile-census` + `reader-presentation-renewal` closure). `tsc` clean; production build clean. (An earlier full-suite run caught a real 503 regression in the prepared reader and 4 branch-coherence gaps — all fixed in `092b8089`; see `docs/state.md` for the detail.)

---

## 2. The closure wall (OWNER RULING DEFERRED — do not route around it)

A functional reader-path change invalidates the frozen reader closure receipt, so `tests/reader-last-mile-census.test.ts` + `reader-presentation-renewal` fail in `pnpm gates`, which blocks merge. The **presentation-renewal** admits only presentation-only drift, so it cannot cover functional changes like `app/api/meetings/route.ts`. The receipt must be **regenerated at this head** — and here is the wall:

- Regenerating the closure needs a **hash-bound execution-authority artifact** bound to the exact proved head.
- A **REHEARSAL** authority requires `importerCodeSha === exactHead` (`scripts/lib/reader-proof-head.mjs:695`).
- The importer is **`scripts/pdc-v2-trusted-lkg-import.mts`**, **added at `902f5c50`** and **deleted at `9b01f3e5`** ("PDC V2: retire cutover authority and bind approved production lineage" — the "child commit B" of `reader-proof-head.mjs:692`). **`9b01f3e5` is an ancestor of every current reader head.**
- Therefore the importer no longer exists to run at any head at/after `9b01f3e5`, so `importerCodeSha` can never equal such a head. **A fresh REHEARSAL closure is unsatisfiable by construction for any functional reader change made after the cutover.** (An old worktree at `1b8c63f7`, e.g. `C:\Users\seanj\dev\wtp-pdc-v2-cert-a-1b8c63f7`, still has the importer, but a receipt it produced binds *that* head, not this one. Running it for this head and relabeling would be fabrication — forbidden, RULING 273.)

**The designed successor is the PRODUCTION-lineage path** (what `9b01f3e5` bound):
- PRODUCTION authority requires `importerCodeSha !== exactHead` (`:692`) plus a terminally-green **authority-transfer lineage** proving distinct importer-commit-A / authority-commit-B (`:380`).
- It is validated against the **LIVE production database** via `pnpm reader:production-closure` (`--require-authority-phase PRODUCTION`, needs `WTP_PRODUCTION_DATABASE_URL_READONLY`).
- `pnpm gates` accepts either honest phase, so a PRODUCTION-phase closure satisfies CI — **but generating it touches live production and is an owner-run ceremony, not an offline command.**

**Two deferred owner rulings (do not decide or route around these):**
1. Whether/how the permanent architecture admits a functional reader-path change post-cutover, given only the production-lineage path remains.
2. Whether `main` may rest on a REHEARSAL closure between merge and the terminal PRODUCTION readback (moot here, since REHEARSAL is dead — PRODUCTION is the only path).

---

## 3. Exact remaining sequence to certify (once the owner rules)

Assuming the owner authorizes the PRODUCTION-lineage closure at this head, from a **clean checkout of this branch** (see §5 — move out of OneDrive first):

1. `pnpm install` (ensure `@netlify/blobs` present).
2. Remove the stale Lumen presentation-renewal and drop its arg from the census test — see `docs/state.md` and `docs/evidence/reader-last-mile-method.md`. (Only correct as part of the full regen, not alone.)
3. Regenerate the closure at this head using the **PRODUCTION** authority path: production build receipt (`scripts/reader-last-mile-build-receipt.mts`), portrait proof, `pnpm reader:suite` + component/route/portrait proofs (RULING 125 — LOCAL build, never production for the browser walk), then `scripts/reader-last-mile-finalize.mts` with `READER_EXECUTION_AUTHORITY_EVIDENCE` pointing at a PRODUCTION authority artifact generated against live production (read-only) + the A/B lineage. The method doc is `docs/evidence/reader-last-mile-method.md` (esp. lines 41, 44, 46).
4. `pnpm regen --run-pure` → `pnpm status:ledger` → `pnpm regen --write` (regenerates the ~59 generator digests that RULING 92/102 flag — read-model is imported by ~59 generators).
5. `pnpm gates` green (offline; accepts the PRODUCTION-phase closure).
6. `git push` → open PR → merge → Netlify auto-deploys `main`.
7. Post-deploy: `pnpm reader:production-closure` re-establishes PRODUCTION-phase; capture production before/after `/api/meetings` cold/warm timings for `docs/state.md`.
8. **Only after deploy does the speedup take effect**, and only once the standing runner both runs and is on a deployed SHA that includes the edge-publish code (see §4).

---

## 4. Netlify values (already placed) + the runner

For the deployed reader to serve from edge, the **standing runner** must publish the edge artifacts, which needs Netlify Blobs write credentials. These are **already set**:

- **`NETLIFY_SITE_ID`** and **`NETLIFY_BLOBS_TOKEN`** were appended to **`C:\Users\seanj\dev\we-the-people\.env.local`** — the runner's private `-EnvFile` (gitignored, outside OneDrive). They are **inert** until the runner runs a deployed SHA containing the edge-publish code (`scripts/routine-civic-data-reader-repair.mts` → `resolveReaderArtifactWriteStore()` reads those two vars). Not in any git-tracked or OneDrive/G-drive path.
- The reader (Netlify function) needs no explicit creds — Netlify injects the Blobs context at runtime.

**Runner is currently DOWN** (pre-existing, unrelated to this work): the "WeThePeople Pilot Runner" scheduled task's last result is `0x00000002` and no `pilot-runner` process is running, so the sole civic-data freshness clock (RULING 283) is not ticking. The task's action executable, `-File` launcher, working dir, and env file **all exist**, so `0x2` is the **exit code of the launched launcher** (`pilot-runtime-launch.ps1` returning 2), not a missing file. See §6 of `docs/state.md`/the session record for the diagnosis of the exit-2 cause. Fixing it is a separate deferred task.

---

## 5. Environment notes

- **This repo is in the OneDrive sync tree** (`C:\Users\seanj\OneDrive\Desktop\we-the-people`). Next session moves it out of OneDrive. **Never put secrets in this tree or any git-tracked/OneDrive/G-drive path.** The runner runs from `C:\Users\seanj\dev\wtp-production-runtime` and loads env from `C:\Users\seanj\dev\we-the-people\.env.local`.
- **Neon:** the isolated measurement branch `br-hidden-dew-axjkwi92` (endpoint `ep-quiet-resonance-axt7xlco`, project `tiny-hill-13996172`) is preserved (left suspended). The rehearsal clone the owner provisioned is `reader-last-mile-rehearsal-bf0bceeb` (`br-shy-bread-axre9f1e`).
- **Attribution:** commits end `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR descriptions end `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
