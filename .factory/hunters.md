build_state: waiting
worker: hunters
provider: Claude
run_id: session_018RBYe1K4Ya5TSyE7CzC2T6
lock: none
heartbeat: 2026-10-04T07:24:45Z
on_river: none
ready: CH-02 at 9ae2d28bd8aba50e493664def23666c25a1eef3e; CH-06 at 89c20a3a107df0573005bade4344c8fcee7a953b
checks: CH-06: tsc --noEmit clean; eslint 0 errors on workers/ and new test; tests/worker-fleet-*, cycle-lease-startup, dead-lease-sweep, new lease-runtime-once: 192/192 pass (run with DATABASE_URL and WTP_ASSET_STORE unset). Not run: full CI selector, live Admin tasks-per-hour check. CH-02 checks as before.
working_on: CH-10 (every funded Send gets the same rules) next
waiting_on: CH-01 live read (needs Admin/production access this sandbox lacks); CH-06 live proof (tasks per hour rising on the same host) needs deploy, River/Admin side. Old per-task runtime stays behind WTP_LEASE_RUNTIME_PER_TASK=1 in the runner env file until live check, then remove.
returned: none
needs_hook: none
needs_Sean: CH-01: someone with Admin access must read the Workers view heartbeat commit (need 022a183c or later). This cloud sandbox cannot reach production or the live site.
seen_not_fixed: CH-02 worst-case count: rolling24Hours.worstCaseCharges in fleet-safety snapshot; Admin display is BR-21. CH-06: the per-task guards read a per-process current-task value, so CH-28 (many hunters per process) must pass guards per task instead. CH-06 does not change the hunter count, so no memory-margin report is owed. Hooks BR-08 (freshness-shadow place order reads "state" scope), DB-09 (add "doors" to AGGREGATES in pilot-runtime-publish.mts), BR-05 (re-read AdminConfig each pass, DETECTIVE_SHUT_THRESHOLD default 3) are still to do, queued after CH-10.
runs_and_working_minutes: 2 runs
