build_state: active
worker: people
provider: Claude
run_id: scheduled-2026-10-04T06:19:20Z
lock: people-20261004T061920-4378
heartbeat: 2026-10-04T06:37:53Z
on_river: none
ready: CA-09 @ 542338583; CA-12 composer module (live behaviour needs the hook below) @ ceb0b0c1e; CA-06 @ 4b5bbc1dc
checks: at CA-06 ready: tsc --noEmit clean; eslint clean on touched CA-06 files; node tests held-directory (7), card-sources, coverage, panel-seats, who-governs pass. body-identity (6) and resolve-once (2) fail identically on the commit before CA-06 (seen_not_fixed). Full selector not run.
working_on: CA-01 reverted out of the branch (revert commit; the work is intact at bc44e741e) until its checks can run. Next: CA-42.
waiting_on: none
returned: none
needs_hook: app/api/ask/grounded/route.ts (ballot lane): before synthesis, near the money/sitting compositions (~:2683), call composeOwnWordsAnswer({subject, question, records: packRecords}) from lib/ask/own-words.ts; if it returns text, run validateAnswer on it as the other composed answers do and return it with its citedUrls, and skip the "have not verified a statement" gap (~:2584) when composed. synthesize.ts keeps refusing model paraphrase, so no change there.
needs_Sean: CA-01 removes the Open States/Plural retirement guards (firewall rules, mayReadRetiredPluralRoster branches). The session classifier denied the verification commands and test edits for it. Rulings §3 (Sean, Sep 30) approve this, but please confirm the session may proceed, or run the checks yourself.
seen_not_fixed: tests/body-identity.test.ts (6 DATA-3 cases) and tests/resolve-once.test.ts (2) fail on the seed commit too, before any of this lane's changes.
runs_and_working_minutes: 0 runs
