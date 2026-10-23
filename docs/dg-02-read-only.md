# DG-02: meeting outcomes reach the reader

A resident can open a meeting with posted minutes and read its recorded actions and named votes. DG-02 reconciles DG-01 READY `286a2d7915` with River `78f82a232`, preserving CAL-01's state calendar programs. It moves §0's source-to-reader delivery and continuing coverage tests.

## Connected steps

**Input: DG-01's held-source acquisitions and CAL-01's scheduled calendar reads.** Registered body doors identify the publisher, body and jurisdiction. Ask gaps use an actual HTTP address, and the held worker binds the saved acquisition to that body's native reader.

**Output: RS-02's selected meeting reader, then the meeting card.** The native reader verifies and publishes `MEETING_OUTCOME` candidates. `lib/outcomes/store.ts#readSelectedMeetingOutcomes` selects the exact sitting; `/api/agenda` passes `meetingReaderRecords` to `components/map/popup/meeting-records.tsx`. River owns folding DG-02, shipping it, and checking the two meetings below on the live page.

## Repair

- `HELD_EVENT_URL_PREFIXES` comes from registered body contracts, updates when the doors are installed, and preserves CAL-01's state/job/URL narrowing. An address map avoids rebuilding the entire registry for each artifact. A missing legacy capture no longer suppresses DG-01's pending native workers.
- CAL-01's `readStateCalendars` retains its one-state dependency load, per-board isolation, upstream pacing, deadline deferrals and individual receipts. Each board uses DG's own agenda store, retained response, measurement, promotion store and scoped input. The grouped CLI remains accepted.
- The coordinator test supplies the new held-digger priority readers to its isolated source harness; its real dependency reads and queue-order assertions remain. The deployment trace expectation follows River's existing state-geometry edge manifest instead of requiring excluded state geometry inside functions.
- The newer schema-2 standing tests replace the Avondale harness. CAL-01's legacy activity, page refresh and calendar tests remain.
- Supported registered calendars automatically gain their existing native outcome reader. Routed door IDs survive contract creation, held-input validation, worker door lookup and the cold reader's SQL selection. Existing Pima/Mesa contracts remain the sole publishers for their own representations.
- InSite minutes have their own registered document authority/parser, so scheduled admission and typed reader verification accept the actual PDF normalizer. Fresh captured calendar bytes use the injected observation clock; retained acquisitions keep their original capture time.
- Registered `government:US-XX` bodies keep their state in gap creation, worker admission, exact-body input loading and the reader. When a held directory projection has not caught up, a verified registered calendar can supply its own named body; invalid, ambiguous and foreign directory rows still refuse.
- Array-index selectors in the in-memory repository now match Postgres selectors, so the exact-body door lookup works in replay as it does in production.

`lib/control-plane/workers/worker-slots.ts` is unchanged from River; RN-02 retains ownership. No source pause, spending setting, production fact, pointer or clock was changed.

## Read-only production replay

Production access used scoped `SELECT`s and public HTTP `GET`s. The shell's development database was excluded. Actual production door records and saved official HTTP responses fed the real registered native ingest. Its actual GOOD candidates, receipts and append-only events were copied into local PGlite using the committed migrations and production payload codec. The cold reader executed its real SQL, then the actual `MeetingRecords` component rendered the selected output. Pinned Chromium inspected both rendered cards. No synthetic civic facts or substituted query results supplied this proof.

| State and meeting | Posted minutes | Reader result |
| --- | --- | --- |
| Arizona, Pima County, October 13, `legistar:pima:1829` | [Clerk's meeting summary](https://legistar.granicus.com/pima/meetings/2026/10/1829_M_Board_of_Supervisors_26-10-13_Meeting_Summary.pdf) | 7 actions; one cold SQL statement; browser displays the recorded actions. |
| California, Contra Costa County, October 6, `legistar:contra-costa:3441` | [Posted minutes](https://contra-costa.legistar1.com/contra-costa/meetings/2026/10/3441_M_BOARD_OF_SUPERVISORS_26-10-06_Meeting_Minutes.pdf) | 157 actions, 157 roll calls and 785 named votes; one cold SQL statement; browser displays approved items, including the storm-preparedness presentation. |

California's production directory projection contains no Contra Costa body, and the live ZIP meeting API currently returns no meetings. The replay used that actual empty production body slice and the actual verified routed calendar door. The native calendar ingested eight real meetings, published their source facts into local Postgres, and passed its actual GOOD calendar candidate to the cold county reader. The county reader discovered `legistar:contra-costa:3441`; the real `/api/agenda` handler returned HTTP 200 with all 157 actions. The supporting result is explicitly `PARTIAL` because the isolated replay has not installed the registry publication used for listing identity; that unavailable authority does not suppress independently verified actions. This exercises the missing-directory fallback and calendar-to-reader connection, beyond rendering outcome records alone. The local database uses the committed reader migrations and control-plane declarations; source publications and fact writes remain isolated.

These samples use the government's structured action/vote records linked to its posted minutes. The PDF-only minutes reader is separately exercised by the Mesa routine tests. One California and two other Pima sitting items assert a roll call whose response has no rows; those vote gaps remain open, alongside the independently verified records. These counts do not claim complete coverage of either state.

The source manifest holds 251 distinct HTTP responses, 5,804,386 response-body bytes, with URLs, actual capture times and SHA-256 hashes. It excludes discovery GETs, production SQL transfer and protocol overhead; it is not an all-attempt cost ledger. No paid search or model calls were made.

## Tomorrow's scheduled run

The same registered tasks were tested against `routineTaskDue` and `routineTaskDeadlineMs`: due before their first publication, not due after success, due at their next deadline, and due tomorrow. A controlled clock advanced to October 24 at 09:27:46 UTC for Pima and 09:29:17 UTC for Contra Costa (5:27 and 5:29 AM Eastern). The actual native ingest replayed the unchanged saved source bytes against its previous output:

- Pima skipped both already-read sittings; Contra Costa skipped its already-read sitting.
- Each used one events request and returned a GOOD routine receipt.
- Each retained the same published version and every selected action, with one copy per sitting.
- The actual reader SQL still returned the same actions afterward. The real California agenda API also returned HTTP 200 and the same 157 actions at the controlled tomorrow clock; each successful task was no longer due at that time.

The ordinary next due times in this replay were October 23 at 21:27:45 UTC and 21:28:50 UTC (5:27 and 5:28 PM Eastern), because these samples are outside the seven-day window and use the existing twelve-hour clock. Tomorrow is an additional controlled scheduling replay, not a claim to have observed a future live run. The standing runner's task list already incorporates `OUTCOME_PARTITION_CONTRACTS`; no manual invocation or per-place code registration is needed after installation.

## Nationwide read-only replay

The production inventory query selected every nonsuspended `legistar` or `legistar-insite` door with one body, a nonderived meeting definition, and a `meetings` or `outcomes` hold. It found **3,200 rows in 33 states**, with no unknown state. Each row was replayed individually through installed door wiring, exact partition identity, scoped-input validation, native outcome contract creation and the real task constructor. **3,170** constructed their calendar/outcome tasks and passed the never-read task's tomorrow admission check. The three Pima/Mesa representations reuse their existing two place contracts.

Independently, the SQL generated by the actual `readStateMeetingOutcomes([state], [])` reader ran against production for **all 56 states and territories**, one state at a time. Returned rows then passed that reader's normal proof/shape validation, `meetingReaderRecords` and actual `MeetingRecords` rendering. Production held two outcome pointers, both in Arizona: **59 sittings, 827 actions and 2,463 named votes**. All 827 actions rendered, with zero reader/renderer failures. The California 157-action acquisition above is an additional local replay of real official bytes; it is not counted as already published production coverage.

| State | Eligible doors replayed | Tasks constructed / tomorrow admitted | Production held sittings / rendered actions |
| --- | ---: | ---: | ---: |
| AK | 41 | 41 | 0 / 0 |
| AL | 46 | 46 | 0 / 0 |
| AR | 0 | 0 | 0 / 0 |
| AS | 0 | 0 | 0 / 0 |
| AZ | 42 | 42 | 59 / 827 |
| CA | 1039 | 1009 | 0 / 0 |
| CO | 85 | 85 | 0 / 0 |
| CT | 0 | 0 | 0 / 0 |
| DC | 0 | 0 | 0 / 0 |
| DE | 0 | 0 | 0 / 0 |
| FL | 318 | 318 | 0 / 0 |
| GA | 20 | 20 | 0 / 0 |
| GU | 0 | 0 | 0 / 0 |
| HI | 8 | 8 | 0 / 0 |
| IA | 0 | 0 | 0 / 0 |
| ID | 2 | 2 | 0 / 0 |
| IL | 162 | 162 | 0 / 0 |
| IN | 0 | 0 | 0 / 0 |
| KS | 0 | 0 | 0 / 0 |
| KY | 1 | 1 | 0 / 0 |
| LA | 0 | 0 | 0 / 0 |
| MA | 18 | 18 | 0 / 0 |
| MD | 1 | 1 | 0 / 0 |
| ME | 10 | 10 | 0 / 0 |
| MI | 66 | 66 | 0 / 0 |
| MN | 6 | 6 | 0 / 0 |
| MO | 212 | 212 | 0 / 0 |
| MP | 0 | 0 | 0 / 0 |
| MS | 2 | 2 | 0 / 0 |
| MT | 0 | 0 | 0 / 0 |
| NC | 41 | 41 | 0 / 0 |
| ND | 0 | 0 | 0 / 0 |
| NE | 0 | 0 | 0 / 0 |
| NH | 0 | 0 | 0 / 0 |
| NJ | 2 | 2 | 0 / 0 |
| NM | 37 | 37 | 0 / 0 |
| NV | 43 | 43 | 0 / 0 |
| NY | 104 | 104 | 0 / 0 |
| OH | 30 | 30 | 0 / 0 |
| OK | 40 | 40 | 0 / 0 |
| OR | 14 | 14 | 0 / 0 |
| PA | 26 | 26 | 0 / 0 |
| PR | 0 | 0 | 0 / 0 |
| RI | 0 | 0 | 0 / 0 |
| SC | 0 | 0 | 0 / 0 |
| SD | 0 | 0 | 0 / 0 |
| TN | 0 | 0 | 0 / 0 |
| TX | 360 | 360 | 0 / 0 |
| UT | 7 | 7 | 0 / 0 |
| VA | 2 | 2 | 0 / 0 |
| VI | 0 | 0 | 0 / 0 |
| VT | 0 | 0 | 0 / 0 |
| WA | 84 | 84 | 0 / 0 |
| WI | 329 | 329 | 0 / 0 |
| WV | 0 | 0 | 0 / 0 |
| WY | 2 | 2 | 0 / 0 |

The zeroes are named coverage gaps, never evidence that governments held no meetings or made no decisions:

- **CA identity failure: 30 of 1,039 doors.** Their stored IDs still encode `government:US-OR:cog:155003`, while their corrected `bodyIds` name `government:US-CA:cog:142274` (Los Angeles Metro). The generated exact-body partition ID therefore differs from the stored key, and the ordinary exact-partition child cannot find it. PB-03's corrected publisher/body metadata is retained; its door-key/reference migration remains owed to the door owner/River. DG-02 makes no production edits. Each affected body and route is listed below.
- **AK, AL, CA, CO, FL, GA, HI, ID, IL, KY, MA, MD, ME, MI, MN, MO, MS, NC, NJ, NM, NV, NY, OH, OK, OR, PA, TX, UT, VA, WA, WI, WY:** production has **zero `MEETING_OUTCOME` promotions** for the state. Consequently a production source-to-page outcome proof cannot succeed there yet. DG-02 registers their supported native work; River must ship and let standing acquisition publish it, then verify source availability and outputs. Only California's selected real-source replay has independently demonstrated new output here.
- **AZ:** the available publications and all their held rows pass; this does not claim that every one of Arizona's 42 registered doors already has outcomes.
- **AR, AS, CT, DC, DE, GU, IA, IN, KS, LA, MP, MT, ND, NE, NH, PR, RI, SC, SD, TN, VI, VT, WV:** no eligible door of the two supported families exists in this production inventory. The reader query ran and returned no outcome publication; other platform families and missing-door discovery remain standing work.

The country replay proves every current row's registration result and every held native outcome's reader delivery. It does not claim a successful live HTTP acquisition from all 3,200 government doors or complete nationwide meeting coverage. Tomorrow's two actual native passes prove retained output after their scheduled clock advances; the country-wide admission check establishes construction/admission only, and is labeled accordingly.

### California mismatched door keys

Every stored key below has the Oregon prefix above; the canonical key built from its actual body has the California prefix. The route suffix identifies the exact stored row.

| Registered body name | Route suffix |
| --- | --- |
| Ad Hoc Board Composition Committee (SAP) | `027ea8d8a066fa58` |
| Ad Hoc Board Composition Committee | `c4a838f14042d5a3` |
| Board of Directors - Regular Board Meeting (SAP) | `f7ae8c27ccf59c8e` |
| Board of Directors - Regular Board Meeting | `d0d180bb07d754ce` |
| Board of Directors - Special Board Meeting (SAP) | `6955cf0146c0a987` |
| Board of Directors - Special Board Meeting | `5701c5786ef8dbd1` |
| Construction Committee (SAP) | `64d1836160bda0a4` |
| Construction Committee | `049472d5b555c69a` |
| Executive Management Committee (SAP) | `a55930e0c0e171a2` |
| Executive Management Committee | `84d100f3d5c0ab44` |
| Finance, Budget and Audit Committee (SAP) | `bae16c169c0ffdae` |
| Finance, Budget and Audit Committee | `c0579647000b0738` |
| Gateway Cities Service Council | `4b3a7859a492ac2e` |
| Measure M Independent Taxpayer Oversight Committee (SAP) | `3fe9e649a6fc89a1` |
| Measure M Independent Taxpayer Oversight Committee | `2c2b27a96adbe7f8` |
| Measure R Independent Taxpayer Oversight Committee - Public Hearing (SAP) | `38364283ddfb21bb` |
| Measure R Independent Taxpayer Oversight Committee - Public Hearing | `b5d25d504bb0bfb7` |
| Operations, Safety, and Customer Experience Committee (SAP) | `b0bc0ae13d8fdc04` |
| Operations, Safety, and Customer Experience Committee | `588e5ee31e1e0a0e` |
| Planning and Programming Committee (SAP) | `476ec1f5aeb84018` |
| Planning and Programming Committee | `19cfeafe45fe7225` |
| San Fernando Valley Service Council | `f22ab0e676bba3ae` |
| San Gabriel Valley Service Council | `95d2671d5d09ce9c` |
| Service Councils - Meet and Confer | `63f91e6bd3283578` |
| South Bay Service Council | `3d122e0586e0edd9` |
| Test - Live Committee Meeting Test (SAP) | `e74c475e396c1818` |
| Test - Live Committee Meeting Test | `399ae06fe9b4deec` |
| Test - Live Regular Meeting Test (SAP) | `cb56a3074b7109ee` |
| Test - Live Regular Meeting Test | `cb9aa4bfc3111d03` |
| Westside/Central Service Council | `3b1e873b7e3f7766` |

## Evidence and shipping status

Raw evidence stays outside Git under `.scratch/dg-02/evidence/`: `proof.json`, `responses.json`, source byte files, `browser.json`, both card HTML files and screenshots. The replay and browser scripts are in `.scratch/dg-02/`. Browser evidence checks the actual card component's content with a simplified containing page; it does not claim that DG-02 is deployed.

Pre-shipping live GETs showed Pima's seven actions already held and Contra Costa's outcomes still `NOT_HELD`. The first live agenda reads took 3.012 seconds and 0.620 seconds respectively; the Pima read exceeds the three-second target, so this is not a live speed pass. River must check the real pages after shipping, including the source links, plain action text, named votes, first-use timing and subsequent automatic refresh. Live browser navigation through the environment proxy refused its certificate even after installing the current proxy CA in the browser trust database; public API GETs worked. Live deployment and future source availability remain unverified here.

Focused standing, calendar, legacy activity, page refresh, ingest, native outcome, worker and selected-reader checks passed. Full gates are running. The initial gate attempts found stale `.next` generated types referring to deleted routes; those generated artifacts were removed, and the clean run passed lint, types and pinned-browser availability before beginning the full suite. No failed or interrupted attempt is counted as passing.
