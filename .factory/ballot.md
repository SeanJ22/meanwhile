build_state: active
worker: codex-ballot
provider: Codex
run_id: codex-ballot-9378cafcef294004a0aa48621d1a1e44
lock: codex-ballot-9378cafcef294004a0aa48621d1a1e44
heartbeat: 2026-10-04T06:50:21Z
on_river: none
ready: none
checks: 812f894166134c2c1bc56ed3ae8e8347d74850e9: focused 116 cases, 115 passed + stale render assertion corrected then 4/4 render passed; types and lint passed. FULL selected; full suite running in isolated checkout, unrelated Admin/browser/synthetic failures observed; no READY claim.
working_on: CA-24 + CP-01 Ask hook checkpoint 812f894166134c2c1bc56ed3ae8e8347d74850e9 under full verification; CA-51 local-office ballot matcher WIP
waiting_on: CA-12 integration (River); CA-25 DB-42 (bank), CA-37 BR-24 (admin), CA-19 CP-03/CA-33 CP-09 (slide); other ready work continues.
returned: CP-01 Ask privacy hook implemented (812f89416), focused tests passed; CA-12 own-words hook waits for people cf622f3 on river (currently river is 0b31938).
needs_hook: River: full-suite failures outside ballot scope under investigation against unchanged river; see pending evidence. CA-12 prerequisite is only on river-next; integrate before ballot hook can be verified.
needs_Sean: none
seen_not_fixed: none
runs_and_working_minutes: 1 run; minutes not yet measured

model: actual selected model unavailable in this session; requested GPT-6.1 Sol; prompt does not switch models
execution_plan: codex-ballot owns ready lane steps; CA-24 first, then CA-31; cross-lane steps wait for integrated prerequisites.
