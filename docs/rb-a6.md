# Owed list

A resident's missing information is counted for Admin and returned to hunters with every value already held. Each verified fact publishes independently.

## Contract

`lib/coverage/owed-table.ts` seeds kind/field rules from the place planner and hunt packet families, the registered geography kinds and the State Run Checklist. State additions join the baseline. Freshness reads `factClocks` on each invocation. Fact and blank fields extend the baseline, so changing a rule cannot discard a held value.

The existing `config.setSetting` action saves the table under `coverage.owedTable`. The existing SQL Admin repository writes its old and new values to `cp_admin_setting_history` atomically with the setting. Undo uses that saved old value. The separate owed overlay, its write actions and its controls are deleted. Production had zero additions, declines and overlay log rows; there are no edits to migrate. Checklist measurements keep their existing definitions.

`placeNeeds(repos, place, now?, query?)` in `lib/hunt/place-needs.ts` is the hunter entry point. `place` is a canonical place id, `{kind:"zip",code}`, `{kind:"zcta",code}` or `{kind:"point",point:[longitude,latitude]}`. ZIP, ZCTA and point calls consume RB-A2's selected memberships and include national facts. Explicit place links follow the selected boundary years; year-zero links retain their source's unknown year. The result has `missing`, `held`, counts and memberships. Held values include their source, checked date and freshness. An unknown place throws; it cannot look complete. A mapped county does not pull unrelated towns into a point's hunt.

The command center's Settings view edits this same table, shows the previous list and Undo, and reads the selected state's owed, held, missing, refresh-due and stuck counts. Every state and territory is selectable. The national SQL reproduction counts all states together without loading national records into a worker. One-state production reads measured 1.5–2.3 seconds; the full-country comparison is an offline verification operation.

## Verification

- `tests/owed-table.test.ts`: baseline and state-addition validation; the actual setting action and SQL history/undo; state counts against independent SQL; duplicates and state boundaries; RB-A2 ZIP memberships; changed settings and undo on the next controlled pass; and a fact publishing while other fields remain missing.
- `scripts/rb-a6-admin-check.mts`: Google Chrome edits a baseline row, adds a state item, and undoes each through the setting gateway backed by disposable Postgres. Four history rows retain the old values. The inspected editor screenshots are in `.scratch/rb-a6-admin-check/`.
- Connection 1: `scripts/rb-a6-place-replay.mts` sends the held registration and ZIP references through RB-A2’s actual builder and loader, then sends the selected ZIP to `placeNeeds`. Production entities, place links, facts, blanks and source URLs are read one state at a time into disposable Postgres. All held values match their production fact ids; held field totals equal direct SQL. ZIPs 85701, 94553, 80012, 32601, 30120, 60602, 03301, 07601, 77515 and 53703 cover ten states. A second map import and a controlled read twenty minutes later preserve the held and missing items. `docs/rb-a6/place-replay.json` records every result. The direct ten-county production reads are also in `production.json`.
- Connection 2: the production Admin configuration selects the rules used by the production fact/blank aggregate. All 57 state, territory and national owed/held/missing totals equal an independent SQL count inside a repeatable-read, read-only transaction. `docs/rb-a6/production.json` holds every state's counts and each county's source-backed held and missing examples. Reproduce with `scripts/rb-a6-verify.mts` and the two assigned read-only connection files.
- `docs/rb-a6/reader.json`: real Google Chrome page checks on meanwhileusa.com. Phoenix 85003 keeps November 3, 2026, voting dates and its election office. Philadelphia 19147 and Seattle 98101 keep their state election offices. Usable content in 1.0–1.6 seconds. TLS validation stayed enabled, using a certificate database mounted only inside the check's browser process; persistent trust was unchanged. The first assertion incorrectly expected the date on the heading's line; the page shows it on its own line, and the assertion now checks that visible date.
- A6 changes no reader page or event writer. Reader, reaction, Speak, Ask and demand identities are not renamed or deleted. The inherited RB-A1 identity checks cover the existing production event ids.

Production reads use only `readonly` on tiny-hill-13996172 / br-delicate-lab-ax02xuo5 and `wtp_cp_release_readonly` on withered-sunset-39821877 / br-tiny-frog-aeufpjeq. Production history remained at zero rows during these reads. Writes for edit/undo proofs occurred only in disposable local Postgres.

## Remaining work

Owned by RB-A6:

- Complete the full checks after River contains RB-A2. The current production build and 95 affected owed-list, map, retained-identity and runner cases pass. The ZIP-certainty, origin, meeting, style and test-runner checks also pass. The preceding combined branch passed 127 related cases, lint, TypeScript and the unused-code check. Full runs stopped for the edit-path replacement and later dependency changes are not passing full runs.
- Follow `stream/rb-a2` on each fetch. Current merged dependency: `208f03964` (includes RB-A1 READY `5bde46615`, RB-A2’s identity/source fixes, event-preservation evidence and next complete refresh). River has not recorded or contained RB-A2 yet.
- After River folds RB-A2, merge `origin/river`, rerun every check, and push `READY: RB-A6` with the production connections, every-state counts and next-pass evidence.
- Keep checking River's return and status until RB-A6 passes its live check. The first automatic production pass remains part of that live check.

The branch was cut from `origin/river` at `21ae9bcfb`. This is built work in progress, not READY, deployed or claimed live as new behavior.

Test-runner lesson: a restricted execution sandbox reported a test file without its individual test cases. The same checklist file reports all eight cases in a network-permitted run. The canonical affected run then reported all 127 cases and complete file timing summaries. Use the network-permitted execution context for the full suite and verify actual case summaries; do not accept a file-only report as the case result.

Fresh checkout setup: run the pinned `pnpm install --frozen-lockfile` before checks. Its postinstall creates ignored `data/derived/place-reference` files. Linking another checkout's dependencies omitted those files and caused the Box tests to fail with `ENOENT`; the same publication case passed in the isolated checkout after the normal install. The incomplete run is not a passing suite.

The sampled-geometry test uses an edge-only fixture context so published production Census relationships cannot replace the fixture when a database URL is present. Without that context, a whole-ZIP published House district made its deliberately unqualified fixture fail. All 26 cases pass with the assigned read-only production URL after isolating the intended inputs; reader behavior is unchanged.

The Chrome check uses `PUBLIC_SITE_ORIGIN`, as the repository origin sweep requires. The preliminary full suite also hit a native Node 24.19 / V8 WebAssembly code-allocation assertion in `meeting-facts.test.ts`; cgroup OOM counters stayed zero. The identical failure is documented in [nodejs/node#66366](https://github.com/nodejs/node/issues/66366): V8 can double-free a collected WebAssembly import wrapper. The canonical test process flags now use the upstream `--no-wasm-code-gc` workaround, retaining compiled Wasm code until the process exits. All 21 runner/reporter/meeting cases pass with the workaround. Assertions and file isolation are unchanged; the final combined full run must still complete.

The existing Admin stylesheet sweep caught a state-lookup callback shadowing the CSS module name. Renaming its local variable removes the ambiguity; all three readiness-copy/style cases pass.
