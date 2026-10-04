build_state: active
worker: people
provider: Claude
run_id: scheduled-2026-10-04T06:19:20Z
lock: people-20261004T061920-4378
heartbeat: 2026-10-04T06:31:59Z
on_river: none
ready: CA-09 @ 5423383; CA-12 composer module @ cf622f303 (live behaviour needs the hook below)
checks: tsc --noEmit clean; eslint clean on new files; node tests source-kinds, ask-own-words, ask-stance-answerability, positions, officials-surface, position-source-isolation, candidate-corpus pass. Full selector not run.
working_on: CA-01 WIP @ bc44e741e (source edits done and pushed; NOT verified: tsc/eslint and the test updates in tests/non-routine-dispositions.test.ts and tests/ask-grounded-route.test.ts:942 were blocked by this session's auto-mode permission classifier). Moving to CA-06.
waiting_on: none
returned: none
needs_hook: app/api/ask/grounded/route.ts (ballot lane): before synthesis, near the money/sitting compositions (~:2683), call composeOwnWordsAnswer({subject, question, records: packRecords}) from lib/ask/own-words.ts; if it returns text, run validateAnswer on it as the other composed answers do and return it with its citedUrls, and skip the "have not verified a statement" gap (~:2584) when composed. synthesize.ts keeps refusing model paraphrase, so no change there.
needs_Sean: CA-01 removes the Open States/Plural retirement guards (firewall rules, mayReadRetiredPluralRoster branches). The session classifier denied the verification commands and test edits for it. Rulings §3 (Sean, Sep 30) approve this, but please confirm the session may proceed, or run the checks yourself.
seen_not_fixed: none
runs_and_working_minutes: 0 runs
