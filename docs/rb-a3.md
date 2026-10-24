# Front door

Owner: RB-A3. Branch: `stream/rb-a3`, cut from River `21ae9bcfb`.

Residents keep the live fact table and its existing reader paths. A changed fact enters that table immediately, queues its served places, and adds one hourly count for each served state. An exact repeat changes neither the fact nor its publication counts or queues.

`lib/core/door.ts` owns publication, source precedence and governing-board creation. `facts/publish.ts` keeps the old blank-returning call; `facts/decide.ts` and the governing-board export in `facts/entities.ts` forward to the shared implementation. `section3.ts` and `validate.ts` remain with their existing families.

New callers pass a `subjectId` (or the old `entity`), the saved copy and one field/value. An official loader can pass `sourceField: { record, key }` so the door takes the publisher's field itself. A government-named board can be supplied as `board: { governmentId, name }`. Hunter and walker findings set `acquisition` accordingly and are checked against their saved copy. Existing Box findings are recognized as hunters. Campaign and advocacy claims carry the site's `sourceSubjectId`.

The new result is `{ decision, factId }` or `{ refused }`. A new work-list caller passes `refusal: async (_query, _claim, reason) => { await list.refuse(leasedRow, reason); }` and does not record that refusal again. The compatibility caller records only its existing blank. No work list or whole-record check sits in front of official source fields.

The reader-side `RB-A3_expand` migration restores `rebuild_queue` and adds `count_hour(state, hour, step, n)` for transactional fact counts. Steps are `door_official` and `door_checked`. Admin's existing Scoreboard reads those counts by state and hour. These are fact counts in the reader database; RB-A5's control-plane work counts measure separate work transitions.

Remaining work, in dependency order:

- RB-A3: replace the current canonical-subject call with RB-A1's `resolveId` after its interface is pushed; build against each newest RB-A1 tip. READY requires the RB-A1 integration entry and ancestry on River.
- RB-A3: replace the current subject/place-link filing with RB-A4's service-map implementation once it lands.
- RB-A3: finish the full check set on the combined code, including source families, Admin and the build. Focused door, Box, fact-store and cache checks are running as the implementation changes.
- RB-A3: replay production facts on a local production copy and prove source-to-door-to-current-place-page connections, then the next scheduled run. Automated approval review rejected the requested raw-row snapshot export on sensitivity and authorization grounds. No snapshot was exported and production remains read-only.
- RB-A3: inspect meanwhileusa.com and Admin in Chrome. No Browser `js`, Chrome-control or CUA tool is exposed in this session, so the live reader proof has not been made.
- RB-A3: merge River after its RB-A1 fold, rerun every check, push READY and continue checking River returns until the lane passes its live check.

`docs/measurements/rb-a3/production-counts.json` records the read-only aggregate baseline for all 50 states, DC and five US territories. Thirty-one have fewer than 1,000 live facts. Nine have none: AS, GU, LA, MP, MT, ND, NE, PR and VT. These shortfalls must not be presented as 1,000 replayed facts.

No READY has been declared. No production database writes, release or changes to `meanwhile-signal` have been made.
