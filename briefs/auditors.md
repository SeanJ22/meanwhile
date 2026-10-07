# Lane: auditors (Detectives, auditors and live checks)

**Starts in Claude** (suggested model Opus 5.5) as an hourly cloud task. Status file: `.factory/auditors.md` on `stream/auditors`. You also continue the `frontend` lane when River hands it to you (common.md, "Paired continuation").

Read `briefs/common.md` first. Your work is every row in `briefs/ownership.csv` with `lane = auditors` (30 rows). Each row's full reason and evidence are in the inventory. Take them in the order below.

**Area.** Detectives and dead ends; auditors and the live audit pass; the post-publish sampler (group K); live-site looks, speed visits, and resident and Admin task runs; safe browser capture.

**Also yours (not in the inventory):**
- **The line keeper** (rulings §2, "Nothing fails silently"). Why you: it judges whether the line from source to reader works and whether repairs held, which this lane already does for published facts. Its findings go into the measures lane's queues and the admin lane's daily brief through their functions.
- **Auditor flags with Sean's four choices** (rulings §2 step 6). Why you: flags come from your live audit pass. The flag card and its buttons go through the admin lane's gateway; a value Sean types publishes through the slide lane's publish path. Ask River for both hooks.

**Shared files you own:** `lib/control-plane/workers/detective.ts`.

## 1. What stops free acquisition (rulings §2)

_None._

## 2. Groups

### Group K (1 row)

Inventory: Its three tested helpers move into lib for the post-publish sampler. Then the script is deleted.

| Path | Action |
|---|---|
| `scripts/verify-extraction.mts` | Move its three tested helpers into lib for the post-publish sampler, then delete. Remove package.json "verify:extraction". |

## 3. The rest

| Path | Action |
|---|---|
| `app/api/warm/route.ts` | Swap them for the national money and ballot reads when lib drops the AZ-only readers. |
| `data/health/visual-checks.json` | Every check is pinned to pilot ZIP 85701 or 85641. Let the run pick random real places. |
| `lib/control-plane/scheduler/absence-hold.ts` | Matches the 5-day dead-end rule as an Admin setting; just remove the "(Sean, Oct 3)" attribution from the comment. |
| `lib/control-plane/scheduler/absence-reopen.ts` | This is the "route reopens when its unlock appears" rule; but it back-computes the record date from the old 30-day constant, which is wrong now holds are 5 days. |
| `lib/control-plane/scheduler/absence.ts` | Needed for dead ends, but it is written as ruling law and still sets a 30-day expiry; the Admin hold setting (max 5 days) should be the only clock. |
| `lib/health/admin-tasks.ts` | Supports the approved live look at Admin, but nothing runs it yet; add the runner hook its own commit says is pending. |
| `lib/health/speed-visits.ts` | Measures the three-second rule, but nothing registers it with the runner yet; add the pending hook. |
| `lib/ops/post-deploy-warm.ts` | Netlify's deploy-succeeded hook runs it. Its comments still say 'pilot ZIPs' but the code warms one ZIP per published county; fix the comments. |
| `scripts/live-audit-pass.mts` | Approved auditor, but pulling a wrong fact is off by default behind WTP_LIVE_AUDIT_PULLS (:18, :76). Rulings say wrong facts get pulled; delete the switch. |
| `scripts/loss-study-pass.mts` | Runs on the audit clock and does real work. Only change: delete the RULING 159 citation (:50). |
| `scripts/walk-all.mts` | Draw places from published data; stop writing data/health/walk-runs. Keep package.json "walk:all". |
| `tests/beacon-guard.test.ts` | Keeps reader data honest; remove the numbered-ruling comment. |
| `tests/chromium-pin.test.ts` | Real tooling check; remove the numbered-ruling comment. |
| `tests/health-admin-tasks.test.ts` | Approved Admin measure, but lib/health/admin-tasks.ts is used only by this test. Wire it into Admin. |
| `tests/jurisdiction-content.test.ts` | The leak check is right, but it runs only over four hard-coded pilot ZIPs. Run it over any ZIP from data. |
| `tests/look-pass.test.ts` | One case pins a fallback spending ceiling Sean never set; the Admin-dial and pause cases stay. |
| `tests/provider-access.test.ts` | Keeps test traffic off a paid key. Remove the RULING 101 citation. |
| `tests/route-floor-applicability.test.ts` | Checks real behavior that stays, but carries old ruling or owner-attribution labels; strip those labels and comments, keep the assertions. |
| `tests/speed-visits.test.ts` | Speed measuring serves the three-second rule; remove 'off unless switched on' so the lane simply runs. |

**Check and close (9 rows).** The inventory gives these only comment, citation or deleted-file reference fixes, which the cleanup release was doing. Confirm each is done on `river`; finish any leftover; then close the row: `lib/control-plane/workers/auditor.ts`, `lib/health/resident-tasks.ts`, `lib/ops/chromium-pin.ts`, `lib/ops/fixture-captures.ts`, `lib/ops/fixture-credentials.ts`, `lib/ops/origin-confinement.ts`, `scripts/ask-harness.mts`, `tests/fixture-credentials.test.ts`, `tests/origin-confinement.test.ts`.

## Notes

- Dead ends: rulings §2. Verification: rulings §3.
