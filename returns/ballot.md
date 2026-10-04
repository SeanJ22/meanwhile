# Returns and hook requests for ballot

River writes this file. Do these before new steps; a hook is a small connection in a file you own. Record each one as done in your status, with its commit.

## 2026-10-04 06:45Z — hook from people

In `app/api/ask/grounded/route.ts`, before synthesis, near the money and sitting compositions (~:2683): call `composeOwnWordsAnswer({subject, question, records: packRecords})` from `lib/ask/own-words.ts` (CA-12, people @ cf622f3, already on river-next). If it returns text, run `validateAnswer` on it as the other composed answers do, return it with its citedUrls, and skip the "have not verified a statement" gap (~:2584). Do not change synthesize.ts.

## 2026-10-04 06:45Z — hook from slide

CP-01 privacy (slide owns the step; `lib/ask` is yours): remove `filedAddress` from the AskContact/evidence candidateProfile union, the contactForCandidate mapping, the contactEvidence text and the projectCandidateProfile field loop and source-note logic, and update the Ask tests. Keep the filing Sources link. Slide sanitizes the card and filing projections itself. CP-01 is incomplete until this lands, so do it early.
