# Release 1 (dcddcf5) public live check: browser and HTTP, 2026-10-05 ~16:45–17:30Z

Checked by River's live-check helper. Production https://meanwhileusa.com; `/api/build` reports commit dcddcf57 (production context). I used Playwright with the agent-proxy CA pin and made public requests only. I did not sign in to Admin. The basemap reads "BASEMAP UNAVAILABLE" because this environment blocks api.maptiler.com; that is our environment, not a site fault.

Scope: the 85 release-1 step ids in integration.json (river_sha up to a88a0726), minus the 28 returned as Failed live and the 12 listed as Built, proving over time / data-checked in releases/1-live.md. The board counted 68 pending. My 85 also includes the PR-carried and RL steps.

ZIPs used: 98101 WA, 60614 IL, 30303 GA, 78701 TX, 04101 ME, 59601 MT, 37203 TN, 80202 CO, 85701 and 85641 AZ, 07866 NJ, 03255 NH, plus the lowest ZIPs of the published counties (03046, 07005, 85321) and 03301.

## Counts

| Category | Steps |
|---|---|
| Checked live | 7 |
| **Failed live** | **4**: FE-39, CA-30, CA-51, DB-55 |
| Built, proving over time | 15 |
| Screen not yet checked | 59 (Admin sign-in, runner-internal, or GitHub/CI) |

## Cross-cutting finding: readers are seeing a 6-day-old snapshot

Every ZIP shows "Checked 6 days ago". `/api/meetings` `snapshot.generatedAt` = 2026-09-29T05:38:58Z, and `/api/reader/manifest` retrievedAt = 2026-09-29T05:38:58Z. The manifest publishes only three counties (Pima, Merrimack, Morris). So no data from after the deploy can reach a reader page yet. Every data-side step below that waits on a new publication (CA-03, CA-06, CP-05, BX-10, DB-01, DB-12/15/17/18/50, etc.) can't be shown until the reader snapshot moves.

## First-load timing and mobile (main reader pages)

- Home `/` desktop: DOMContentLoaded 0.5–1.1 s (cold first run 1.9 s). After typing a ZIP and pressing Show meetings, the meeting count appears in 0.39–1.66 s across 12 ZIPs (slowest: 85701 at 1.66 s, which has 248 meetings).
- `/ballot?zip=` desktop load event: 1.0–3.7 s (85701 at 3.7 s is the slowest; 30303 at 2.9 s).
- iPhone 13 (390 px): map page (85701, 03255, 60614, 78701) and ballot page (85701, 07866, 98101) all have scrollWidth = clientWidth = 390, so there is no horizontal scroll. Screenshots m_85701_main.png, m_85701_gov.png and ballot_m_85701.png show a clean layout. Mobile ballot load is 1.0–2.8 s.
- No 4xx/5xx from any meanwhileusa.com request in any run.
- Coverage outside the pilots: every non-pilot ZIP (98101, 60614, 30303, 78701, 04101, 59601, 37203, 80202) shows 0 meetings, 2–5 bodies and 3–4 officials (federal only). This is the expected coverage state, not a release-1 step.

## Results

| Step | Classification | Evidence |
|---|---|---|
| FE-39 | **Failed live** | https://meanwhileusa.com/ welcome card still reads "OR START WITH ONE OF THESE: Tucson, AZ / Vail, AZ / Rockaway Twp., NJ / Newbury, NH". main `components/map/welcome-overlay.tsx:45-50` still has `QUICK_ZIPS`. PR #642 (merge 4ed0475) only dropped the disclaimer paragraph. |
| CA-30 | **Failed live** | Ask at 85701, "What does a NO vote on Proposition 425 mean?", got a model paraphrase with garbled figures ("stay at … $817 million instead of rising by $70 million (which would grow to about $610 million more…)"), not a quoted stored NO line. `/ballot?zip=85701` shows no "NO:" line on any of 15 measures. Every `noMeans` in data/ballot/measure-records-first-seed.json is null. |
| CA-51 | **Failed live** | 07866: Ask "Who is running for Morris County Board of County Commissioners?" says "The records do not contain information about who is running…" and gives current members. `/ballot?zip=07866` lists Tayfun Selen (R) and Christopher (Chris) Russo (D) for that race. The NH control passed: at 03255, Ask listed Ribas, Bilodeau and French, the same as the ballot page. |
| DB-55 | **Failed live** | No concluded meeting before 2026-07-07 in /api/meetings for 85701, 85641, 03255 or 07866. `/api/agenda?meetingId=legistar:pima:{1700,1750,1760,1770,1780,1790,1795,1800,1805,1810,1815,1818,1819}` all return `status: NOT_HELD`. Ask at 85701 about a June Pima BOS meeting: "We have not recorded a … meeting". The restore hasn't reached readers. |
| CA-13 | Checked live | Topic chips answered 200 on the first click: AZ (Alma Hernandez az-legislature:2312 water; Grijalva G000606 water and housing), NJ (Analilia Mejia M001246 water), NH (Goodlander G000604 water; Shaheen S001181 taxes), IL (Quigley Q000023 water), MT (Daines D000618 taxes). |
| CA-09 | Checked live | 85701, Adelita Grijalva card, Positions → "water": each quoted passage's row reads "official page · last checked August 20th, 2026". Only the official-page kind was seen. |
| CA-12 | Checked live | 85701 Ask "What has Adelita Grijalva said about water?" answered "Adelita Grijalva's own words, exactly as published. On August 20th, 2026, we read this on a page of theirs: '…Colorado River Water Cuts July 31, 2026 Read More Press Release Rep.'" with Records. Quality flag: the quoted "sentence" is a press-list headline fragment that includes nav text. |
| CA-44 | Checked live | Campaign money on Grijalva (AZ), Mejia (NJ), Goodlander and Shaheen (NH) shows amounts, contributors as filed and PAC categories, with no disclaimer lines. |
| CA-45 | Checked live | Same cards show dollars and filed categories plus the small-donor share (e.g. "$1,015,921.45 (55%) of individual money came from donors giving $200 or less"). No other percentage or interpretive sentence. |
| CA-24 | Checked live (render half) | `/ballot?zip=85701` shows 14 AZ propositions plus local Prop 425; `/ballot?zip=03255` shows NH Question 1 (CACR 13). The pages render. "A record added as data shows with no release" was not exercised. |
| FE-16 | Checked live | Ran lib/health/page-metrics.ts against live pages: ballot 85701 mobile had 1,493 issues, ballot 03255 desktop 1,143, home mobile 31. Each issue names its element (e.g. "← Back to the map" 113×17 px tap target). Small false positive: an sr-only "ZIP code" label is flagged as cut off. |
| FE-03 | Built, proving over time | Needs a fresh deploy. First reads today of the published-county lowest ZIPs 03046, 07005, 85321 (and 03301) were all `Netlify Durable; fwd=vary-miss`. The /api/meetings cache TTL is ~300 s, so a warm from the deploy 28 h ago can't be observed now. Recheck right after the next deploy. |
| CA-20 | Built, proving over time | Waits on an owner Send for a new state. Today IL-5 Quigley and MT Daines show `/api/funding` kind "none", while AZ, NJ and NH members show FEC totals. |
| CA-03 | Built, proving over time | `termStart` and `termEnd` exist on roster members, but all 250 members in 85701, 85641, 07866 and 03255 have null values. The snapshot predates the deploy. |
| CA-06 | Built, proving over time | Code path exists (`officeContact` → "Office address/phone" rows). No body in 5 ZIPs has `officeContact`. The Pima County card's 18 Sources have no office-contact entry, and Cook County shows nothing. |
| CP-05 | Built, proving over time | No `quote` field in any `/api/meetings` provenance or commentAccess row across 5 ZIPs. Not shown on any card. |
| BX-10 | Built, proving over time | 0 meetings carry `videoUrl` in 85701, 85641, 03255, 07866, 60614 (including Pima Legistar BOS). Snapshot is from 09-29. |
| BX-02 | Built, proving over time | Depends on hunter findings, and paid workers are held by SCOUT_COST_CEILING. No new member emails seen. |
| BX-08 | Built, proving over time | New-venue pins need a new publication. Snapshot is from 09-29. |
| DB-01 | Built, proving over time | Shown window holds: the earliest meeting on the map is 2026-07-07 (90 days back), the latest about 2026-12-30. Held-history Ask not provable: the snapshot predates the deploy. |
| DB-12 | Built, proving over time | Meetings still show (248 at 85701, 388 at 03255, 62 at 07866), but from the 09-29 snapshot, so this doesn't show adapters reading the registry. |
| DB-15 | Built, proving over time | "Who governs here?" and coverage notes render unchanged (85701: 8 bodies, 27 more tracked, 30 more owed). Same snapshot caveat. |
| DB-17 | Built, proving over time | No newly added adapter kind is visible yet. |
| DB-18 | Built, proving over time | Tucson clerksboards meetings show (e.g. clerksboards:61 2026-07-08 Historical Commission), but from the pre-deploy snapshot. |
| DB-50 | Built, proving over time | No engineer-built-kind doors are visible yet. |
| DP-15 | Built, proving over time | Needs an audit pull, then a new version. |
| SC-02 | Screen not yet checked | Admin checklist card: needs Admin sign-in. |
| SC-01, SC-03, SC-04, SC-05, SC-06, SC-07, SC-08, SC-09, SC-12, SC-20 | Screen not yet checked | Admin place/scorecard screens: need Admin sign-in. |
| SC-15, SC-18 | Screen not yet checked | Runner snapshot/rounds plus "Admin unchanged": need Admin sign-in (SQL recheck is River's). |
| BR-08, BR-21, BR-31 | Screen not yet checked | Admin mission, budget dial and Scoreboard: need Admin sign-in. |
| CH-01, CH-02, CH-03, CH-04, CH-05, CH-07, CH-08, CH-09, CH-10, CH-25, CH-26, CH-28, CH-29, CH-30 | Screen not yet checked | Admin Workers/Work/Money views: need Admin sign-in. CH-07 also needs a controlled test-site run. |
| DP-01, DP-02, DP-03, DP-04, DP-05, DP-06, DP-08, DP-21, DP-22 | Screen not yet checked | Admin views or live Scout briefs: need Admin sign-in. |
| DB-02, DB-07, DB-13, DB-14, DB-16, DB-21, DB-31, DB-56, DB-58 | Screen not yet checked | Admin door/registry views: need Admin sign-in. |
| DB-37, DB-38, DB-40, DB-41, DB-42, DB-43 | Screen not yet checked | Bank/playbook effects show only in Admin and live runner requests: need Admin sign-in. |
| CA-15 | Screen not yet checked | Admin sweep record: needs Admin sign-in. |
| RL-01, RL-03, RL-07 | Screen not yet checked | GitHub/CI facts, not public-site screens. River checks them from Actions. |
| RL-06 | Screen not yet checked | Behind WTP_ADAPTER_PUBLICATION (= pr). Also needs two unattended river merges. |

## Files

Screenshots and text dumps are in /tmp/claude-0/live/: d_*/m_* (map, desktop/mobile), c_* (body/official cards), chip_* (chips and money), ask_* (Ask answers), ballot_d_*/ballot_m_*, fe16_*.json, api_meet_*.json, manifest.json, ag_*.json.
