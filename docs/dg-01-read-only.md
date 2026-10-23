# DG-01

Held meeting follow-ups now read registered sources instead of `ROUTINE_READ`, then queue one-subject native readers. Held subject source pages use the existing fact checker/publisher; each verified value publishes independently. Original source URL/hash/time and current Admin limits are preserved. No DG-owned provider uses `ROUTINE_READ`; HN-01 owns deleting the global placeholder.

HF-02 shipped in release66 and is merged from River; its child-authority fix is preserved. The approved `freshness-shadow.mts` patch puts current named places and subjects ahead of background work. Existing reader/UI/fact modules and the routine runner have no DG changes. New modules are DG-only. Raw measurements are retained outside Git.

## Measurements

The read-only cohorts covered 56 states/territories and 13 checklist families: 4,595 held baseline subjects, 104 meeting bodies (91 with source evidence), and 62 other held subjects. They found 2,688 supported values and 486 fact-store attachment candidates (430 meeting details, 56 office addresses). These are acquisition/verification results, **not 486 promised reader additions** after the scope backout; generic-adapter measurements used the then-present venue seam, and missing hooks below remain owed. No read-only run published facts.

Selected meeting checks made 590 source requests and 451 database requests; other subjects made 75 source requests. All meeting attempts, including failures/recovery, made 1,575 source requests and 526 database requests. Measured candidate throughput was 2,058/source-worker-hour for meetings and 1,144 for officials; it is not fleet throughput. Meeting-worker peak was 524,861,440 bytes selected, 601,968,640 across all attempts. Other-subject verification peaked at 327,114,752 bytes (318,857,216 final offline replay). The new parent-plus-native-child peak is unmeasured. The deployed host reported zero lease workers fit; RH-01 owns capacity.

Overdue sources, October 20 at 02:55→07:59 ET: **770/988 before →728/1,046 after**, including meetings 69/140→31/140. The portfolio changed; DG is not deployed, so this is not a DG recovery claim. Weekly delivery was 30/98 current meeting changes within 60 minutes and 33/98 within 90. Nine calendar sources lack sitting hotness. Every source is **not proven restored**.

Native Reader additions measured 73 fields (16.369/hour); a later fact-store snapshot measured 3 NJ meeting facts (0.375706/hour). These distinct windows are not additive. Per-state/family rows, requests, bytes, memory and rates remain in `/workspace/dg01-evidence/retained-dg-01-read-only.csv`; detailed clocks/ledgers are beside it.

All-attempt metered received payload: **1,665,049,375 bytes**, including **1,305,735,599 database bytes** and **412,096,607 identified reader bytes** (about **$0.04121** at $0.10/decimal GB). This includes copy validation: 254,697,374 reader bytes, 892,957,178 control-plane bytes, 125,919,851 GitHub bytes; both 358-byte build checks count once. HTTP bodies and PostgreSQL WebSocket payloads are counted without duplication; request/TLS bytes and compute charges are excluded. Paid source/model/search spend: $0. **Exact grand bytes are unknown** because early reads were unmetered. Automatic approval review rejected wider government selectors as exceeding named work; those facts remain unmeasured.

## Required owner changes

- **Reader meetings:** in `lib/facts/meeting-read.ts`, carry verified `minutes_url` facts into `Meeting.publishedLinks`. Native calendar/agenda/outcome readers continue working; standalone minutes links need this hook.
- **Reader people:** `lib/facts/roster-read.ts` and `lib/reader/state.ts` must project exact canonical/recorded-alias office addresses, portraits and bodyless contacts/terms; `lib/officials/lookup.ts` and `components/officials/contact-pills.tsx` must carry/display addresses. `app/api/directory/route.ts` needs exact-person committee joins; `lib/corpus/data-plane.ts` must expose attributed, dated statement facts to positions/Ask. Unsupported fields stay owed; native directory details and existing body-member contacts/terms remain unchanged.
- **Reader governments:** `lib/registry/server.ts` and `lib/reader/place.ts` need selected-government exact-ID/unique-alias fact overlays for verified contacts and `body:<id>` associations. No broad government scan is needed.
- **Source venues:** `lib/meetings/venue-cache.ts` needs a scoped, concurrency-safe venue override accepting verified-empty slices; generic adapters currently lack it. DG uses existing explicit Legistar/InSite venue arguments and leaves unsupported routes named/owed.
- **Source clocks:** `scripts/routine-civic-data-runner.mts` needs its `meeting-doors` prepass bridged to native verified observation time, plus reconciliation of missing door clocks. DG's own successful native workers record original verified times; they do not restamp clocks or repair other lanes.

## Verification

Scoped typecheck, lint, preflight and focused provider/standing/ingest/subject tests pass. Reader/Admin fixture databases use real committed migrations; PGlite omits only online-index `CONCURRENTLY`, retaining the actual schema/index definitions.

Production-copy comparison: five public API payloads match exactly; Ask differs only in timing fields. Meetings, officials, the 22-contest ballot and model-free Ask render the same information; voting returns 168 sites for ZIP 85701. Authenticated Admin Now retains all nine districts, 4/557 checklist items, orders, queue and scoreboard. Build-dependent update labels and copy-local shown-at writes differ. Root inspected the screenshots. Complete Admin readiness took 35 seconds, so §6's three-second standard is **not passed**.

The exact live-source normal production build fails Next's route-export check on `app/api/votes/route.ts` exporting `settleStateVoteMemberHolding`; its owner must move that helper out of the route's exports. Both runtimes use Next's supported compile-only production mode. Baseline `55ec164` and live `ed0ac299c` have identical Reader/Admin code; release66 adds only HF-02's background fork fix. Existing `/api/admin/v6/results` returns 503 on both. Admin Now reads about 200 MB from the copied control plane per full load; its query owner must narrow that overfetch. These files stay unchanged. Copies expire October 22; original production records, settings, pauses and clocks were unchanged. Raw comparison/byte evidence is in `/workspace/dg01-evidence/parity/`.
