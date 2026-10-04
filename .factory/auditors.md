build_state: active
worker: auditors
provider: Claude
run_id: session_01Qe7w1irSM1yf4rH8Y4sjSU
lock: none
heartbeat: 2026-10-04T10:58:02Z
on_river: DP-01 (ec1157a97); DP-02, DP-04, DP-06 (folded in 4b5102044)
ready: FE-16 (4d0d27d2e); DP-03 (4a20e1bf9); FE-17 (53cc708961d323539518e6148240311d005e640d, file only: FE-18 runs it); DP-15 (a2c209952dbdd2591f140f642decb9639f205699, reader contracts, partial: see seen_not_fixed). Earlier READY commits are in this one's history; fold a2c209952dbdd2591f140f642decb9639f205699 to take all.; FE-03 (59d31edb5). FE-03 gap: the AZ ballot and Pima finance entries in ASK_SOURCE_PRELOADS (app/api/warm/route.ts) are place-specific but are tied to the Ask route's own preload list (ballot lane); left as is.; DP-05 (1f9769067). DP-05 notes: stored plans carrying detective:[] still register (registerAutonomousPlan ignores the retired key); DetectiveResult and the DETECTIVE role stay as read-only types for stored records and the activity view; the activity closed-walk test and the coordinator identity-diagnosis test were deleted with the code that produced their fixtures.
checks: env -u DATABASE_URL -u WTP_ASSET_STORE via pnpm test: 22 civic-data test files, 181 pass at a2c209952dbdd2591f140f642decb9639f205699; tsc clean; eslint no new warnings (firewall.ts matchingCalls warning predates me). Not FULL: no selector/shared-hook change.; DP-05: 34 test files naming coordinator/detective/research-runtime/plan-repair/standing/runtime plus cost-section, 280 pass 0 fail, tsc clean at 1f9769067.
working_on: Next: DP-13 (live-audit job), FE-02. FE-01 harness edits still waiting on needs_Sean.
waiting_on: none
returned: none
needs_hook: admin: DETECTIVE_SHUT_THRESHOLD setting (BR-05) not yet on river; DP-02 code default 3 stays until it lands.
needs_Sean: FE-01: this run's permission classifier denied editing the four harnesses to remove their non-local refusals (flagged as weakening a safeguard), though the plan and rulings section 6 call for it. Allow it in this environment, or say to keep the refusals. The write guard is ready for them.
seen_not_fixed: CP-06 date-sanity code not on river yet; DP-03 covers date refusals through the worker-recovery rule and DATE_OUT_OF_WINDOW. 11 tests fail on base in this cloud env (earlier note).
runs_and_working_minutes: 2 runs, minutes unknown
DP-15 gaps: (1) a pull that empties the whole projection cannot publish, the validator refuses zero-record versions (ZERO_IS_NOT_ABSENCE), so the last record stays live until another record exists; needs a removal-only successor or a deliberate empty-version rule. (2) roster, ballot-contests and held-election publishers not changed. (3) the live check (pulled fact gone on the reader page) is River's after release.
