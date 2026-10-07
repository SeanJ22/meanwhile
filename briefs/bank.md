# Lane: bank (Knowledge bank and state profiles)

**Starts in Codex** (suggested model GPT Sol 6.1). Status file: `.factory/bank.md` on `stream/bank`. If the Codex run stops, the Claude `registry` worker (Sonnet 5.5) continues this lane on the same branch (common.md, "Paired continuation").

Read `briefs/common.md` first. Your work is every row in `briefs/ownership.csv` with `lane = bank` (69 rows). Each row's full reason and evidence are in the inventory. Take them in the order below.

**Area.** The field manual and method store, and spreading a working method to same-kind doors; playbooks; loss-study follow-up; the dead-link sweep; and state profiles.

**Also yours (not in the inventory):**
- **State profiles** (rulings §2 step 7; inventory groups A and B). Why you: a state profile is that state's wins, losses and methods, kept in the same store as the field manual you own.

**Shared files you own:** `lib/control-plane/field-manual.ts`.

## 1. What stops free acquisition (rulings §2)

| Path | Action |
|---|---|
| `lib/control-plane/playbooks/detective.md` | Make the first rung held data and national APIs, then search, news and the subject's own site. |
| `lib/control-plane/playbooks/scout.md` | Its ladder never names held data, Open States, Congress, Census, FEC, LegiScan, search or news, so paid scouts skip free sources. First rung: held data and national APIs, then search and news. |
| `tests/meetings-official-page.test.ts` | Delete the tests that re-key a verified route whenever its code digest changes; the plan keys it by output version instead. |

## 2. Groups

### Group A (44 rows)

Inventory: Usable sources, endpoints, platforms and keys load into the source registry as data; each state's structure, walls and statutes load into its state profile; operating facts go into docs/how-meanwhile-works.md. Then the files are deleted.

Source rows go into the registry lane's source registry through its data path; ask River for the hook if one is missing. Create `docs/how-meanwhile-works.md` once and add to it.

| Paths | Action |
|---|---|
| `docs/**` (29 files; exact list in `ownership.csv`) | Move sources, endpoints, platforms and keys into the source registry as data and operating facts into `docs/how-meanwhile-works.md`; then delete each file. |
| `states/**` (15 files: `TIERS.md` and the az, nh, nj notes, sources, explainers and tenancy files) | Move each state's structure, walls, statutes and sources into that state's profile in the database; then delete each file. |

### Group B (2 rows)

Inventory: Facts that hold up load into the Arizona, New Jersey and New Hampshire state profiles. Then both files are deleted.

| Path | Action |
|---|---|
| `data/health/control-facts.json` | The August answer key goes (Sean, Oct 6). First pull out every fact in it that holds up and still matters for 85701, 85641, 07866 and 03255, and load those facts into the Arizona, New Jersey and New Hampshire state profiles. Then delete. |
| `docs/Meanwhile-Owner-Checklist.xlsx` | The August answer key goes (Sean, Oct 6). First pull out every fact in it that holds up and still matters for 85701, 85641, 07866 and 03255, and load those facts into the Arizona, New Jersey and New Hampshire state profiles. Then delete. |

## 3. The rest

| Path | Action |
|---|---|
| `data/method/conclusions.json` | The runner reads this file, so method conclusions can only change by code release. Read them from the database instead, then delete the file. |
| `lib/control-plane/playbooks/parser.md` | Says it reads "ONE saved official document", which implies only official sources count. Change to "saved source document". |
| `lib/doors/link-sweep.ts` | Built and correct about request pacing, but nothing runs it: no runner job, no package command. Put it on the runner's clock so Admin's dead-link count is real. |
| `lib/method/candidate.ts` | Used by scout write-back and the scoreboard. Remove the "RULING 243" citation; keep the code. |
| `lib/method/claims.ts` | Used by the method store's validator. Remove the ruling citations at lines 24, 172 and 755; its other importers in lib/governance are being deleted. |
| `lib/method/learn-batch.ts` | Used by scout write-back. Remove the ruling citations and the pilot-ZIP script reference in comments. |
| `lib/method/loss-response.ts` | Wire it into the daily loss study pass so lessons turn into action, as rules section 7 asks. |
| `lib/method/portability.ts` | Used by preflight and the method store. Remove the 13 ruling citations; keep the code. |
| `lib/method/spread.ts` | Wire it into the fix-standing pass so a method that works is tried at every same-kind door, which rules section 7 wants. |
| `scripts/link-sweep.mts` | Admin already reads its counts but nothing runs it. Put it on the audit pass clock so it runs by itself. No package.json entry. |
| `tests/field-manual-scout.test.ts` | Real learning loop; robots-not-a-wall matches the rules. Remove the ruling citation. |
| `tests/link-sweep.test.ts` | Reader link health is owed, but scripts/link-sweep.mts is run by nothing. Wire it into the runner. |
| `tests/method-fixtures.ts` | Used by kept method-store tests. Remove the RULING 103 citation in its header. |
| `tests/research-docs-and-method-bridge.test.ts` | Route-learning checks stay; drop the checks that every docs/detective and state NOTES line is in the manual, which come from a one-time seed script. |

**Check and close (6 rows).** The inventory gives these only comment, citation or deleted-file reference fixes, which the cleanup release was doing. Confirm each is done on `river`; finish any leftover; then close the row: `lib/method/conclusions.ts`, `scripts/field-manual-seed.mts`, `tests/field-manual.test.ts`, `tests/method-claims.test.ts`, `tests/method-knowledge.test.ts`, `tests/method-projection.test.ts`.

## Notes

- How shared knowledge is read: rulings §7.
