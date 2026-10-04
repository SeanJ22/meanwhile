build_state: active
worker: people
provider: Claude
run_id: scheduled-2026-10-04T07:20:54Z
lock: people-20261004T072054Z-783
heartbeat: 2026-10-04T07:28:01Z
on_river: none
ready: CA-09 @ 542338583; CA-12 composer module (live behaviour needs the hook below) @ ceb0b0c1e; CA-06 @ 4b5bbc1dc; CA-42 departed-seat module @ 108ec9fb7 (live behaviour needs the second hook); CA-03 @ 2bc65b669 (the roster publisher accepts and page-verifies ISO termStart/termEnd; a reader that emits them from a term column is not built, so no live roster fills them yet)
checks: at CA-06 ready: tsc --noEmit clean; eslint clean on touched CA-06 files; node tests held-directory (7), card-sources, coverage, panel-seats, who-governs pass. body-identity (6) and resolve-once (2) fail identically on the commit before CA-06 (seen_not_fixed). Full selector not run. CA-42 @ 108ec9fb7: tests/departed-vote-seat (2) pass, tsc clean, eslint clean on touched files (run with DATABASE_URL and WTP_ASSET_STORE unset). CA-03 @ 2bc65b669: roster-term-dates, delivery-experience-roster-provenance, reader-roster-term-note, card-sources, plan-repair (36 tests) pass via pnpm test with DATABASE_URL and WTP_ASSET_STORE unset; tsc clean; eslint no errors.
working_on: CA-13 next (nothing built yet).
waiting_on: none
returned: none
needs_hook: app/api/ask/grounded/route.ts (ballot lane): before synthesis, near the money/sitting compositions (~:2683), call composeOwnWordsAnswer({subject, question, records: packRecords}) from lib/ask/own-words.ts; if it returns text, run validateAnswer on it as the other composed answers do and return it with its citedUrls, and skip the "have not verified a statement" gap (~:2584) when composed. synthesize.ts keeps refusing model paraphrase, so no change there. | lib/ask/votes.ts (ballot lane), resolveVoteIdentity (~:359-363) and voteEvidenceReadsStateRollCalls (~:520): when options.officeholderId is a federal id and loadRoster() has no row, use departedFederalVoteSeat(officeholderId, personName) from lib/votes/departed-seat.ts instead of NO_ROSTER_ROW (and treat it as scope "us" for the state-roll-call read check). Departed state members already resolve from the snapshot. A departed member asked for by name only still has no name in the vote store; Ask reaches them by officeholder id.
needs_Sean: CA-01 removes the Open States/Plural retirement guards (firewall rules, mayReadRetiredPluralRoster branches). The session classifier denied the verification commands and test edits for it. Rulings §3 (Sean, Sep 30) approve this, but please confirm the session may proceed, or run the checks yourself.
seen_not_fixed: tests/body-identity.test.ts (6 DATA-3 cases) and tests/resolve-once.test.ts (2) fail on the seed commit too, before any of this lane's changes.
runs_and_working_minutes: 0 runs
