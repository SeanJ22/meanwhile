# Lane: admin (Admin command center)

**Starts in Codex** (suggested model GPT Sol 6.1). Status file: `.factory/admin.md` on `stream/admin`. If the Codex run stops, the Claude `measures` worker (Sonnet 5.5) continues this lane on the same branch (common.md, "Paired continuation").

Read `briefs/common.md` first. Your work is every row in `briefs/ownership.csv` with `lane = admin` (78 rows). Each row's full reason and evidence are in the inventory. Take them in the order below.

**Area.** Admin screens and buttons; the action gateway; settings with log and undo; orders; the daily brief; evidence in Admin; run-now and rollback controls; and the "List on search engines" switch (group L).

**Also yours (not in the inventory):**
- **The "List on search engines" switch** (inventory group L, with the noindex lines in `netlify.toml`, `next.config.ts` and `middleware.ts`). Why you: it is an Admin setting, and you own settings and middleware.

**Shared files you own:** `lib/control-plane/gateway/registry.ts`, `lib/control-plane/settings.ts`, `lib/control-plane/fix-list.ts`.

## 1. What stops free acquisition (rulings §2)

_None._

## 2. Groups

### Group L (1 row)

Inventory: A robots route and middleware read the Admin "List on search engines" switch. Then the file is deleted.

`netlify.toml`, `next.config.ts` and `middleware.ts` (section 3) ship in the same release as this row.

| Path | Action |
|---|---|
| `public/robots.txt` | Replace with a robots route that reads an Admin switch, "List on search engines", off until Sean turns it on. Listing the site must never need a code change. Delete this file when that route ships. |

## 3. The rest

| Path | Action |
|---|---|
| `app/(admin)/_mw/admin-v6/actions.ts` | 19 of Sean's controls go nowhere, including Decide, contain, recheck, fix-first and resume publishing. Wire each to a real action so Sean's orders and decisions take effect at once. |
| `app/(admin)/_mw/admin-v6/bulk-hunts.tsx` | Works for any place, but the state picker starts on Arizona. Start it empty so no state is the default. |
| `app/(admin)/_mw/admin-v6/playbook-editor.tsx` | Built but never shown. The rules say playbooks are edited as data with a log and undo, so mount it on the Settings screen. |
| `app/(admin)/_mw/admin-v6/reference.ts` | It marks only the old "pilot" states as tracked, which hides every other state on the Now map by default. Drop the pilot flag; every state is equal. |
| `app/(admin)/_mw/admin-v6/release-rollback.tsx` | Mount it in Admin Settings, or delete it with its route if Sean does not want it. |
| `app/(admin)/_mw/admin-v6/screen-now.tsx` | By default the state map shows only "tracked" (old pilot) states and states with hunts. Show every state. |
| `app/(admin)/layout.tsx` | Keep the shell. Delete CSS for pages that no longer exist (pilot health cards, readiness cells, deploy preview, ledger grid); no live code uses those classes. |
| `app/api/admin/v6/playbooks/route.ts` | Keep, and mount the playbook editor that reads it; today nothing calls it. |
| `app/api/admin/v6/releases/rollback/route.ts` | Keep only if the rollback control is mounted in Admin; today nothing calls it. |
| `lib/control-plane/admin-google.ts` | Security code stays; remove the numbered-ruling citation in the header. |
| `lib/control-plane/admin-view/v6-national-read.ts` | Marks states 'tracked' from the hard-coded pilot flag, so AZ/NH/NJ look special. Drop the pilot flag; track any state with work or data. |
| `lib/control-plane/admin-view/v6-results-read.ts` | Country and state results read the five-stage shadow approval pipeline that is being deleted. Read real publish counts and live-page checks instead. |
| `lib/control-plane/admin-view/v6-trail-read.ts` | Passes the hard-coded pilot ZIP list into the assignment read. Remove it. |
| `lib/control-plane/assignment-read.ts` | Carries the hard-coded pilot ZIP list and the activation-gate reading through every read. Remove both; drop the '(Sean, 2026-09-24)' attribution. |
| `lib/control-plane/assignment-view.ts` | Ranks work against the pilot ZIP list and reports the promotion activation gate as a blocker. Remove pilotZips and the activation-gate reading. |
| `lib/control-plane/bulk-hunts/plan.ts` | Refuses any hunt budget over a $10,000 maximum written in code. Sean sets every spending limit; remove the code maximum. |
| `lib/control-plane/cost-panel.ts` | Remove the Agent Bridge subscription block (bridge is deleted), ruling citations, and the stale '$25' default-ceiling comment. |
| `lib/control-plane/deploy-preview.ts` | Prints a 'will not' list and says publishing is a separate governed step that is off. The rules ban such lists and publish automatically. Delete those lines. |
| `lib/control-plane/evidence/admin-bridge-runner.ts` | Runs only when an unapproved switch is on. Delete the switch so evidence reaches Admin with Sean's PC off. |
| `lib/control-plane/evidence/admin-copy-runner.ts` | Admin evidence download stays off unless a hidden server switch is set; Sean should simply be able to open saved pages in Admin. |
| `lib/control-plane/expansion/scope-divisions.ts` | Keep the state/national derivation; drop the call that splices the one-ZIP school data. |
| `lib/control-plane/fix-queue.ts` | A queued fix waits for a PC export and the ledger canonicalizer before becoming work, and it is a second queue beside the fix list. Write queued gaps straight into the fix list. |
| `lib/control-plane/gateway/admin-config.ts` | The row is right, but it admits that turning paid spending off does not stop the worker runtime, which has its own built-in limit. One Admin spend switch must cover all paid work. |
| `lib/control-plane/gateway/playbook-action.ts` | Built but never registered: the Admin editor sends "playbook.update" and the gateway refuses it as unknown. Add it to the action registry so playbooks are edited as data. |
| `lib/control-plane/gateway/registry.ts` | "Record your decision" and "Add to queue" only append to the old decision log and wait for a PC sync. Make them apply at once as data; register the playbook and rollback actions. |
| `lib/control-plane/gateway/release-rollback-action.ts` | Useful operator control, but never registered in the gateway, so the button would be refused. Register it in registry.ts and mount the rollback panel. |
| `lib/control-plane/operator-chat/read-models.ts` | Shows Sean what is running and where it is stuck. Delete the "RULING 103" citation. |
| `lib/control-plane/operator-chat/turn.ts` | Sean should give orders in plain words, but anything off a fixed phrase list gets "the console does not answer that". Let an AI turn unmatched orders into gateway actions, within Sean's budget. |
| `lib/control-plane/owner-surface.ts` | Make them apply at once as data; delete RULING cites and the retired fleetReceipts field. |
| `lib/control-plane/readiness/catalog.ts` | Marks Arizona, New Hampshire and New Jersey as "pilot", and Admin uses that flag to decide which states are tracked. Delete the pilot field so every state is tracked alike. |
| `lib/control-plane/workers/activity.ts` | Admin needs worker activity, but it reads the shadow approval-chain records, which are being deleted. |
| `lib/signal/intake-limits.ts` | Daily caps live in environment variables, and the 400-a-day reaction cap was sized for a pilot with a few hundred targets. Make these Admin settings Sean controls and size them for national coverage. |
| `netlify.toml` | Remove RULING citations. Remove the fixed noindex header; the header comes from the Admin "List on search engines" switch, off by default, so listing never needs a code change. |
| `next.config.ts` | Remove the RULING 26 comment and the Arizona fire-district file traced for Admin preview. Remove the fixed noindex header; middleware sets it from the Admin "List on search engines" switch. |
| `scripts/credential-ledger.mts` | Useful operator tool when keys change. Stop writing docs/credential-ledger.md into the repo; print the result or send it to Admin instead. |
| `scripts/demo-sweep.mts` | Write its deletion record to the database for Admin instead of a docs file in the repo. |
| `scripts/publish-owner-snapshot.mts` | Needed by Admin, but it feeds pilot ZIPs, the activation gate and Needs-Sean cards from the tracker CSV and ruling registry. Remove those; read the place list and work queue from data. |
| `tests/admin-action-gateway.test.ts` | Remove the numbered-ruling comment and the test pinning a $10,000 code maximum on Sean's spend dial. |
| `tests/admin-checklist-definitions.test.ts` | The checklist is Sean's approved capture scorecard and this is national, not per state. |
| `tests/admin-control-centre.test.ts` | Security behavior to keep; remove the numbered-ruling comment. |
| `tests/admin-feedback-9-4-pm.test.ts` | Keep time, name and cost checks; delete tests pinning decisions that wait on the tracker, the pilot ZIP list, and "Sean" attributions. |
| `tests/admin-feedback-9-4.test.ts` | Keep runner pause, dispatch and cost tests; delete the Needs-Sean tracker card tests and the tracker "#resolved" decision path. |
| `tests/admin-feedback-inbox.test.ts` | Privacy behavior to keep; remove the numbered-ruling text in an assertion message. |
| `tests/admin-first-open.test.ts` | Speed checks stay; remove the "(Sean," attribution and the pilotZips input once the pilot flag is deleted. |
| `tests/admin-google-signin.test.ts` | Security to keep; remove numbered-ruling comments and the assertion that log lines must contain "RULING 245" and "RULING 238". |
| `tests/admin-narrow-reads.test.ts` | Speed checks stay; remove the "(Sean, 2026-09-24" attribution in the header comment. |
| `tests/admin-promoted-slices.test.ts` | Checks stay; remove the "(Sean, 2026-09-24" attribution in the header comment. |
| `tests/admin-public-reader-observation.test.ts` | The look at the live page is an approved Admin measure; never holds back publishing. |
| `tests/admin-research.test.ts` | Keep security and spend checks; delete the tests requiring a committed runner relaunch proof file and the numbered-ruling labels. |
| `tests/admin-session.ts` | Used by many kept tests; remove the numbered-ruling label in its header. |
| `tests/admin-settings.test.ts` | Matches the rule that settings show before/after with undo and name only factory changes. |
| `tests/assignment-evidence-trail.test.ts` | Shows Sean what an assignment found and reused; drop the pilotZips input once Admin's pilot flag is deleted. |
| `tests/assignment-identity.test.ts` | Order tracking and cost checks stay; it loads the committed Arizona, New Hampshire and New Jersey jurisdiction files. Use fixtures. |
| `tests/assignment-view.test.ts` | Mostly live behavior; remove the parts built on the shadow approval pipeline and the "reviewed input" mode, both slated for deletion. |
| `tests/execution-accountability-fix-history.test.ts` | Fix list is approved. |
| `tests/feedback-store.test.ts` | Feedback store stays. Drop the carry-over test; that module is a one-time migration only tests reach. |

**Check and close (21 rows).** The inventory gives these only comment, citation or deleted-file reference fixes, which the cleanup release was doing. Confirm each is done on `river`; finish any leftover; then close the row: `lib/control-plane/admin-view/coverage.ts`, `lib/control-plane/admin-view/district-catalog.ts`, `lib/control-plane/admin-view/periods.ts`, `lib/control-plane/admin-view/promoted-slices.ts`, `lib/control-plane/admin-view/spend-period.ts`, `lib/control-plane/admin-view/topic-counts.ts`, `lib/control-plane/admin-view/v6-capture-health.ts`, `lib/control-plane/display-name.ts`, `middleware.ts`, `scripts/vault-restore.mts`, `tests/admin-body-standing.test.ts`, `tests/admin-c-plain-words.test.ts`, `tests/admin-feedback-9-6.test.ts`, `tests/admin-reader-intel.test.ts`, `tests/admin-redirect-origin.test.ts`, `tests/admin-runner-progress.test.ts`, `tests/admin-source-registry.test.ts`, `tests/control-plane-vault-restore.test.ts`, `tests/expansion-scopes.test.ts`, `tests/operator-chat.test.ts`, `tests/plain-work.test.ts`.

## Notes

- One command center: rulings §0 item 4. Plain English: rulings §10.
