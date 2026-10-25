# RB-A7 — Pages built when reader data changes

Status: built on `stream/rb-a7`. Two connected checks using real production data pass in a local database copy. This branch is not deployed. Nationwide page construction and ZIP content parity are still unverified, so this document does not declare READY or a live speed improvement.

The place query runs in `lib/reader/place-builder.ts`. The worker saves ready answers and their existing body, member, meeting and source identities in `place_page`, increments the version, then clears that place's `reader-place` cache tag. Writers queue affected places through the shared cache invalidation path. The ordinary ZIP request reads one composed ready page; other map and body selections combine saved pages through the common decoder. The previous per-visit query and reader-database `cp_work_items` read are removed. The command center reads rebuild movements from the existing state/hour counters.

Production connections used only `readonly` on reader project `tiny-hill-13996172`, branch `br-delicate-lab-ax02xuo5`, and `wtp_cp_release_readonly` on control-plane project `withered-sunset-39821877`, branch `br-tiny-frog-aeufpjeq`. Both checked roles allow SELECT and deny INSERT, UPDATE and DELETE. Every test mutation stayed in a local PGlite copy restored from real state-scoped production rows and promoted payloads. No production database row was changed.

## Two connected checks

The ordinary builder and reader preserve the full JSON response of the previous place query for copied ZIPs 85201 and 85701, after ignoring array order and properties JSON omits. Independently captured per-division rows also compose to those same complete place answers.

After the history-query optimization, fresh read-only repeatable-read snapshots independently compare the complete current and historical answers for both ZIPs. Mesa has six current partitions, seven history partitions and two archived records: 97 current meetings and 99 with history. Tucson has 34 current partitions, 38 history partitions and 23 archived records: 279 current meetings and 294 with history after normal merging. Both full current and history responses match the previous query. The optimized ZIP builder uses its history query plus the explicit current-answer comparison; ordinary division and body builders derive current from history.

1. Mesa's actual Legistar API returned BodyId 169, “Audit and Finance Committee.” A saved capture went through `publishBodyFacts` in `roster-facts.ts`. Its confirmed name acquired the fresh source date, queued its dependent pages and appeared in the ready answer in 13.9 seconds. ZIP 85201 retained all 36 body IDs, 97 held meeting IDs and its member and roster IDs.
2. The existing owner action removed real fact 1711505, Tucson Unified's board phone `(520) 225-6070`, in the copy. `resolveOwnerFlag` queued the affected pages. The next controlled one-minute scheduler tick rebuilt ZIP 85701; its ready answer reflected that removal in 14.9 seconds while retaining all 142 body IDs, 279 held meeting IDs and its member and roster IDs.

Each ready read executed exactly one `READY_PLACE_SQL` statement and took 16–46 ms locally. Both ZIP versions advanced from 1 to 2. The queue emptied; every worker purge contained one `reader-place` tag. The shared hourly counters recorded ten Arizona rebuilds and two national rebuilds, including the affected parent pages. These checks use controlled scheduling and local database timing; they do not establish deployed scheduling or live browser speed.

The member inventory counts fact-roster rows, while the roster inventory counts only `PlacePackage.registry.bodyRosters` members. The separate state endpoint supplies additional officials. These are preservation checks for the place package, not complete visible official totals. See [the connected results](measurements/rb-a7/connections.json).

## Every state

The read-only baseline holds 104,048 place identities and no ready pages. All 50 states, DC, five territories and the national bucket are listed in [the state counts](measurements/rb-a7/counts.md), including zero counts. Stored body/person/meeting identities are labeled separately from page-content counts.

State-scoped comparisons checked 93,571 held ZIP division identities, including fringe divisions, across 33,925 state/ZIP touches. Every selected identity exists in production. A cross-state ZIP is counted in every state it touches. This proves that the saved page keys are available; it does not prove content parity for every ZIP. See [the ZIP identity results](measurements/rb-a7/zip-identities.json).

All 60 stored reader-event references resolve: 56 reactions, three demand signals and one Ask reference, covering 36 distinct target IDs. Speak has no stored rows. This lane preserves their identities. The reader database's legacy `cp_work_items` table contains zero rows; the real control plane contains 182,431 work items and 364,544 Box findings. See [the production baseline](measurements/rb-a7/production-baseline.json).

## Work remaining before a live result

RB-A7 must finish nationwide page construction and compare every ZIP's bodies, members, meetings and officials against the current answer before the reader switches. The initial build must also retain changes published while that build is running. River owns integration with RB-A4 when it lands and the production release.

After deployment, the live checks remain: a change through every audited writer reaches the page within five minutes; 20 ZIPs in 20 states finish the first visit under three seconds and later visits under 300 ms; the command center shows rebuilds by state and hour; and reader-database reads in `database_transfer_daily` decrease. The saved transfer baseline is available for that comparison. No post-deploy result is claimed here.
