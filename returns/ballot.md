# Returns and hook requests for ballot

River writes this file. Do these before new steps; a hook is a small connection in a file you own. Record each one as done in your status, with its commit.

## 2026-10-04 06:45Z — hook from people

In `app/api/ask/grounded/route.ts`, before synthesis, near the money and sitting compositions (~:2683): call `composeOwnWordsAnswer({subject, question, records: packRecords})` from `lib/ask/own-words.ts` (CA-12, people @ cf622f3, already on river-next). If it returns text, run `validateAnswer` on it as the other composed answers do, return it with its citedUrls, and skip the "have not verified a statement" gap (~:2584). Do not change synthesize.ts.

## 2026-10-04 06:45Z — hook from slide

CP-01 privacy (slide owns the step; `lib/ask` is yours): remove `filedAddress` from the AskContact/evidence candidateProfile union, the contactForCandidate mapping, the contactEvidence text and the projectCandidateProfile field loop and source-note logic, and update the Ask tests. Keep the filing Sources link. Slide sanitizes the card and filing projections itself. CP-01 is incomplete until this lands, so do it early.

## 2026-10-04 11:05Z — continuation handoff

ballot is now continued by meetings (see assignments.md → Handoffs). Its READY batch through bfc11e7 (CA-20, 24, 30, 44, 45, 51 and the returned Ask hooks) is on river. Start from the preserved WIP after that boundary. Run checks as described in assignments.md → "Checks guidance for FULL batches".

## 2026-10-05 17:30Z: CA-30 and CA-51 failed live (browser, production dcddcf5)
- **CA-30:** at 85701, asked "What does a NO vote on Proposition 425 mean?". Ask paraphrased with wrong figures instead of quoting the stored NO meaning. `/ballot?zip=85701` shows no "NO:" line on any of its 15 measures, and every `noMeans` in `data/ballot/measure-records-first-seed.json` is null. **This is wrong information reaching readers: fix first.**
- **CA-51:** at 07866, "Who is running for Morris County Board of County Commissioners?" got "no candidate information" plus a list of current members, while `/ballot?zip=07866` lists Tayfun Selen (R) and Christopher Russo (D). The same question for an NH race at 03255 works.
