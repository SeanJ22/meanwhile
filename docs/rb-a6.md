# Owed list

A resident's missing information is counted for Admin and returned to hunters with every value already held. Each verified fact publishes independently.

## Contract

`lib/coverage/owed-table.ts` seeds kind/field rules from the place planner and hunt packet families, the registered geography kinds and the State Run Checklist. State additions join the baseline. Freshness reads `factClocks` on each invocation. Fact and blank fields extend the baseline, so changing a rule cannot discard a held value.

The existing `config.setSetting` action saves the table under `coverage.owedTable`. The existing SQL Admin repository writes its old and new values to `cp_admin_setting_history` atomically with the setting. Undo uses that saved old value. The replaced owed-log view is deleted.

`placeNeeds(repos, place, now?, query?)` in `lib/hunt/place-needs.ts` is the hunter entry point. `place` is a canonical place id, `{kind:"zip",code}`, `{kind:"zcta",code}` or `{kind:"point",point:[longitude,latitude]}`. ZIP, ZCTA and point calls consume RB-A2's selected memberships. The result has `missing`, `held`, counts and memberships. Held values include their source, checked date and freshness. An unknown place throws; it cannot look complete. A mapped county does not pull unrelated towns into a point's hunt.

The command center's Settings view edits this same table, shows the previous list and Undo, and reads the selected state's owed, held, missing, refresh-due and stuck counts. Every state and territory is selectable. The national SQL reproduction counts all states together without loading national records into a worker. One-state production reads measured 1.5–2.3 seconds; the full-country comparison is an offline verification operation.

## Verification

- `tests/owed-table.test.ts`: baseline and state-addition validation; the actual setting action and SQL history/undo; state counts against independent SQL; duplicates and state boundaries; RB-A2 ZIP memberships; changed settings and undo on the next controlled pass; and a fact publishing while other fields remain missing.
- `scripts/rb-a6-admin-check.mts`: Google Chrome edits a baseline row, adds a state item, and undoes each through the setting gateway backed by disposable Postgres. Four history rows retain the old values. The inspected editor screenshots are in `.scratch/rb-a6-admin-check/`.
- Connection 1: production place entities and `entity_place` flow through the owed read to ten counties in AZ, CA, CO, FL, GA, IL, NH, NJ, TX and WI. Every returned held field matches a direct fact lookup. Each place is read again with a clock twenty minutes later; held values remain available.
- Connection 2: the production Admin configuration selects the rules used by the production fact/blank aggregate. All 57 state, territory and national owed/held/missing totals equal an independent SQL count inside a repeatable-read, read-only transaction. `docs/rb-a6/production.json` holds every state's counts and each county's source-backed held and missing examples. Reproduce with `scripts/rb-a6-verify.mts` and the two assigned read-only connection files.
- `docs/rb-a6/reader.json`: real Google Chrome page checks on meanwhileusa.com. Phoenix 85003 keeps November 3, 2026, voting dates and its election office. Philadelphia 19147 and Seattle 98101 keep their state election offices. Usable content in 1.0–1.6 seconds. TLS validation stayed enabled, using a certificate database mounted only inside the check's browser process; persistent trust was unchanged. The first assertion incorrectly expected the date on the heading's line; the page shows it on its own line, and the assertion now checks that visible date.
- A6 changes no reader page or event writer. Reader, reaction, Speak, Ask and demand identities are not renamed or deleted. The inherited RB-A1 identity checks cover the existing production event ids.

Production reads use only `readonly` on tiny-hill-13996172 / br-delicate-lab-ax02xuo5 and `wtp_cp_release_readonly` on withered-sunset-39821877 / br-tiny-frog-aeufpjeq. Production history remained at zero rows during these reads. Writes for edit/undo proofs occurred only in disposable local Postgres.

## Remaining work

Owned by RB-A6:

- Finish the shared-schema build and resolve combined-branch failures. Current full run: lint, unused-code and pinned-browser checks pass; TypeScript reports two nullable results in RB-A1's tests; suite and builds continue.
- Follow `stream/rb-a2` on each fetch. Current merged dependency: `a9295c221` (includes RB-A1). River has not recorded or contained RB-A2 yet.
- After River folds RB-A2, merge `origin/river`, rerun every check, and push `READY: RB-A6` with the production connections, every-state counts and next-pass evidence.
- Keep checking River's return and status until RB-A6 passes its live check. The first automatic production pass remains part of that live check.

The branch was cut from `origin/river` at `21ae9bcfb`. This is built work in progress, not READY, deployed or claimed live as new behavior.
