# Lane: measures (Measures, Scoreboard and queues)

**Starts in Claude** (suggested model Sonnet 5.5) as an hourly cloud task. Status file: `.factory/measures.md` on `stream/measures`. You also continue the `admin` lane when River hands it to you (common.md, "Paired continuation").

Read `briefs/common.md` first. Your work is every row in `briefs/ownership.csv` with `lane = measures` (46 rows). Each row's full reason and evidence are in the inventory. Take them in the order below.

**Area.** The State Run Checklist as data; what each place is owed and what we hold; coverage and tier measures; Scoreboard, research and vital-sign numbers; data-business numbers; reader demand turned into owed work; and the per-state and national queues.

**Also yours (not in the inventory):**
- **Per-state and national queues** (rulings §0 item 4; inventory group C). Why you: the queues are counted per place from the owed and held measures this lane already owns. Build the queue tables and one function other lanes call to add an item; admin wires the Admin buttons, auditors' line keeper and River's returns write through it.

**Shared files you own:** `lib/coverage/place-owed.ts`, `lib/civic-data/held-place-capture.ts`, and the queue tables and add-item function you build.

## 1. What stops free acquisition (rulings §2)

_None._

## 2. Groups

### Group C (15 rows)

Inventory: Admin gets a queue per state plus one for national and system work, read from the database. Decision cards read those queues. Then the tracker code and files are deleted together.

The queues must be live and read by Admin before the tracker files go.

| Paths | Action |
|---|---|
| `docs/tracker*` (9 files), `lib/tracker/*.mjs` (4), `scripts/tracker-core.mjs`, `lib/control-plane/decision-cards.ts` | Build the per-state and national queues in the database; point decision cards at them; then delete the tracker code and files together in that release. |

### Group N (1 row)

Inventory: Large, slow-changing reference files (the ZIP index, boundary files) move to wtp-assets and are read through the CDN. Facts (body descriptions, seat makeup, coverage tiers, Arizona text compiled into code) live in the database, where the factory checks and updates them, and are published per state to wtp-assets for readers. Readers never pull these from Neon.

| Path | Action |
|---|---|
| `data/derived/zip-coverage-tiers-runtime.json` | The site stamps every logged search and Ask row with this frozen August 21 tier. Only a code release changes it. Move into the database and update from live coverage. |

## 3. The rest

| Path | Action |
|---|---|
| `app/api/demand-signal/route.ts` | Each tap should also create or raise acquisition work for that body or candidate and show in the daily brief. |
| `lib/civic-data/held-place-families.ts` | Part of the hunt's "what we hold" read, but it only looks at the three hard-coded legislature states, the three-state money list, and a Morris County ballot branch for NJ. |
| `lib/control-plane/readiness/checklist-profile.json` | Delete the rows that restate rules the rulings removed, such as the requirement that keeps Open States ("retired intermediary") out of rosters (line 4090), and keep the rest as the scorecard. |
| `lib/control-plane/research-digest.ts` | Admin needs it, but its labels print ruling numbers and the text hard-codes "the $25 daily limit" instead of reading Sean's Admin setting. |
| `lib/control-plane/research-metrics.ts` | Admin and runner use it, but it still carries a retired pilot-ZIP input and pilot-surface band wording, plus ruling citations. |
| `lib/control-plane/research-progression.ts` | Feeds Admin, but its promoted and reader-visible counts are hard-wired to zero from the shadow approval window, so Admin never shows real facts reaching readers. |
| `lib/control-plane/vital-signs.ts` | The hourly scoreboard is approved; remove the "Sean, Oct 6" attribution from its header. |
| `lib/coverage/artifacts.ts` | Keep the state-name and FIPS lookup helpers; delete the scan of repo-held roster, ballot and geometry files, since place data belongs in the database. |
| `lib/coverage/public-kind-owed.ts` | Work-in-progress from today that nothing calls yet; connect it to the owed list or it is dead code. |
| `lib/coverage/zip-tier.ts` | Ask, reactions and logs stamp rows with it, but it reads a stale repo file. Store tiers in the database on a clock, or compute from place measures. |
| `lib/db/demand-signal.ts` | Clicks are only stored; by design nothing may read them, so they never create or raise acquisition work. Make clicks create work for that place and subject, on every card kind. |
| `lib/registry/coverage.ts` | Drop the frozen audit-notes dependency, rule citations, and the stale 'only federal roster' note. |
| `lib/signal/aggregate.ts` | Reaction tallies are the data-business architecture you asked to build now (capture and display). Keep it and wire it into Admin. |
| `scripts/stamp-coverage-tiers.mts` | Compute coverage from what is captured, stored in the database and refreshed on a clock; delete the "RULING 6" citation. Keep package.json "tiers:stamp". |
| `tests/coverage-tier.test.ts` | Drop ruling labels, source-text scans, and checks of the committed zip-coverage-tiers.json file. |
| `tests/place-statuses.test.ts` | Delete the hunt-activity test; lib/control-plane/admin-view/place-hunt-evidence.ts is reached only by tests. |
| `tests/research-metrics.test.ts` | Ordering and cost metrics stay; remove pilotZips inputs and assertions that the ordering reason cites RULING 229. |
| `tests/research-progression.test.ts` | Progression counts stay; rebuild the fixture without the SHADOW activation gate, which belongs to the approval chain being deleted. |
| `tests/search-log-exclusion.test.ts` | Checks real behavior that stays, but carries old ruling or owner-attribution labels; strip those labels and comments, keep the assertions. |

**Check and close (11 rows).** The inventory gives these only comment, citation or deleted-file reference fixes, which the cleanup release was doing. Confirm each is done on `river`; finish any leftover; then close the row: `lib/control-plane/data-business/buyer.ts`, `lib/control-plane/data-business/read.ts`, `lib/control-plane/data-business/recipes.ts`, `lib/control-plane/data-business/switches.ts`, `lib/control-plane/data-business/types.ts`, `lib/coverage/tier.ts`, `lib/db/transfer-by-caller.ts`, `lib/ops/vital-signs-hours.ts`, `tests/coverage.test.ts`, `tests/demand-signal.test.ts`, `tests/held-place-capture.test.ts`.

## Notes

- Admin measures and the checklist: rulings §0 and §3.
- `lib/registry/coverage.ts` is also touched by the people lane's group D work; coordinate the hook through River.
