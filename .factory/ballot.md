build_state: active
worker: codex-ballot
provider: Codex
run_id: codex-ballot-9378cafcef294004a0aa48621d1a1e44
lock: codex-ballot-9378cafcef294004a0aa48621d1a1e44
heartbeat: 2026-10-04T07:19:55Z
on_river: none
ready: none
checks: d058c58b9: 52/52 scoped ballot/Ask/worker regression cases pass. CA-20 dirty diagnostics: 73/73 funding/FEC cases pass, types and lint pass; exact post-commit rerun pending. Earlier invalid-environment FULL remains incomplete; final CI-equivalent FULL required, pinned browser absent and download blocked. No READY.
working_on: CA-20 collector target universe checkpoint; CA-44/45 next. CA-31 d058c58b9 builds generic complete-contest projection, awaits slide capture-format hook.
waiting_on: CA-12 integration (River); CA-25 DB-42 (bank), CA-37 BR-24 (admin), CA-19 CP-03/CA-33 CP-09 (slide); other ready work continues.
returned: CP-01 Ask privacy hook implemented (812f89416), focused tests passed; CA-12 own-words hook waits for people cf622f3 on river (currently river is 0b31938).
needs_hook: slide via River: CA-31 adds ballot-contests worker reader door and complete-contest generic BALLOT_CANDIDACY publisher. In worker-publication-evidence.ts heldPageCopies/capturesForPublication, admit saved PDF text and CSV/text captures with their raw-document hash; current HTML-only discovery skips these. Existing registered task factory recognizes new door automatically; standing runtime must keep/attach its ballot-contests publication on BALLOT_CONTEST jobs. Also CA-12 cf622f3 still only on river-next; integrate. Verification blocker: missing Chromium; cdn.playwright.dev download returns 403 Domain forbidden, baseline 11 browser failures.
needs_Sean: none
seen_not_fixed: Full 812f894 suite also reports geography/synthetic/extractor failures; final CI-equivalent batch and baseline comparison pending before attributing cause.
runs_and_working_minutes: 1 run; minutes not yet measured

model: actual selected model unavailable in this session; requested GPT-6.1 Sol; prompt does not switch models
execution_plan: codex-ballot owns ready lane steps; CA-24 first, then CA-31; cross-lane steps wait for integrated prerequisites.
