build_state: active
worker: people
provider: Claude
run_id: scheduled-2026-10-04T06:19:20Z
lock: people-20261004T061920-4378
heartbeat: 2026-10-04T06:23:53Z
on_river: none
ready: CA-09 @ 5423383; CA-12 composer module @ cf622f303 (live behaviour needs the hook below)
checks: tsc --noEmit clean; eslint clean on new files; node tests source-kinds, ask-own-words, ask-stance-answerability, positions, officials-surface, position-source-isolation, candidate-corpus pass. Full selector not run.
working_on: CA-01 next
waiting_on: none
returned: none
needs_hook: app/api/ask/grounded/route.ts (ballot lane): before synthesis, near the money/sitting compositions (~:2683), call composeOwnWordsAnswer({subject, question, records: packRecords}) from lib/ask/own-words.ts; if it returns text, run validateAnswer on it as the other composed answers do and return it with its citedUrls, and skip the "have not verified a statement" gap (~:2584) when composed. synthesize.ts keeps refusing model paraphrase, so no change there.
needs_Sean: none
seen_not_fixed: none
runs_and_working_minutes: 0 runs
