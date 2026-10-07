# Lane: ballot (Ballot, money, Ask and budgets)

**Starts in Codex** (suggested model GPT Sol 6.1). Status file: `.factory/ballot.md` on `stream/ballot`. If the Codex run stops, the Claude `meetings` worker (Sonnet 5.5) continues this lane on the same branch (common.md, "Paired continuation").

Read `briefs/common.md` first. Your work is every row in `briefs/ownership.csv` with `lane = ballot` (196 rows). Each row's full reason and evidence are in the inventory. Take them in the order below.

**Area.** Ballots and measures; voting sites; campaign money (FEC, state and local); government budgets; special-district boundaries; executive actions; plain-English translations and help-text definitions; and Ask.

**Shared files you own:** `lib/ask/`, `app/api/ask/`.

## 1. What stops free acquisition (rulings §2)

| Path | Action |
|---|---|
| `app/api/government-finance/route.ts` | Show it on the body card and let budgets run on a schedule, not only by owner command. |
| `data/fec/fec-2026.json` (group F) | Same facts already live in the database, refreshed by the FEC API job. This file only seeds an empty store and feeds tests. Delete in the same release as lib/control-plane/campaign-finance/obligations.ts's replacement. |
| `data/states/az/ballot/az-pima-2026.json` (group F) | Same facts already live in the database, refreshed by the Arizona ballot source (promoted September 14). This file only seeds an empty store and feeds tests. Ballots should become a standing job for every state. Delete in the same release as lib/control-plane/campaign-finance/obligations.ts's replacement. |
| `lib/civic-data/national-government-finance.ts` | Exactly the national free-source job the mission wants, but nothing runs it yet; only a test calls it. Wire it into the runner as a standing national job. |
| `lib/control-plane/campaign-finance/ballot-obligations.ts` | Skips any candidate outside 'admitted' (sent) places, so money work only happens where Sean sent agents. Run it for every held ballot. |
| `lib/control-plane/campaign-finance/obligations.ts` (group F) | Delete once the replacement is live. The scheduler should import ballot-obligations.ts directly and run money work for every state. |
| `lib/control-plane/expansion/district-territory.ts` | Move the territory rules into data rows and load special-district boundaries for any state by area. |
| `lib/control-plane/expansion/runner-load.ts` | Remove the Arizona-only branch that reads the fire district file; read special-district boundaries for any state from stored data. |
| `lib/control-plane/scheduler/providers/campaign-finance.ts` | Money sources are hard-coded for Arizona, New Hampshire and Pima County; replace with one money-source data row per state seeded from the held 56-agency list. |
| `lib/funding/data-plane.ts` | Money sources are typed for three states and one county. Make state money one door-driven source per state, seeded from the state agency list, and drop these four contracts. |
| `lib/funding/fec-send-districts.ts` (group F) | Delete once the replacement is live. Its whole job is limiting FEC reads to places Sean sent, and it returns nothing while the runner is paused. FEC should read every district for every federal candidate. |
| `lib/hunt/election-page.ts` | Official is never required; read other sources too and let official values replace them. |
| `lib/hunt/nj-filing.ts` | Ballots for Morris County run through a county-specific parser in code. Turn it into a general county candidate-list door reader driven by door settings; strip ruling citations. |
| `lib/routing/everyday-data-plane.ts` | Everyday contacts move only when the owner runs an import. Give this a standing national job and remove the owner-only promoter. |
| `lib/routing/everyday.ts` | Every contact is typed into code for 85701, 85641, 07866 and 03255, so nowhere else gets one. Move everyday contacts to data rows for every place and delete this table. |
| `lib/sources/ballot-curated/index.ts` | Hard-codes two counties as the ballots that exist, fed by owner-only projections. Make ballots data rows for every state in one standing ballot job. |
| `lib/sources/ballot-nj-morris/index.ts` | Move validateBallotFile and contestsForDivisions to a shared module; make Morris a data row in the national ballot job. |
| `lib/sources/cochise-vote-centers.ts` (group H) | Delete once the replacement is live. A hard-coded single-county special case (exactly 18 Cochise centers) run daily through voting sites. Replace with national polling-place data per state. |
| `scripts/build-nj-morris-ballot.mts` | Fold Morris into a national ballot job as a data row, then remove this contract. |
| `scripts/campaign-finance-az-pima-transactions.mts` | Read EasyVote portal addresses from data so every county on that vendor works, and drop the Pima-only contract. |
| `scripts/fetch-fec.mts` | Runs on the clock, but only reads challengers for sent districts and needs a switch to widen targets. Read every federal candidate and committee nightly; delete the WTP_FEC_TARGET_UNIVERSE switch. |
| `scripts/fetch-voting-sites.mts` | Delivers real polling places, but each county is a function typed into code. Drive it from the national election-office list as data so every state fills. |
| `scripts/state-money-az.mts` | Runs daily, but it is one hand-built script per state. Fold it into one money job per state seeded from the state agency list, find why it stopped publishing, and delete the many RULING citations. |
| `scripts/state-money-nh.mts` | Runs daily but defaults its reader view to Merrimack County and is a one-state script. Fold into one money job per state, fix why it stopped publishing, delete RULING citations. |
| `scripts/state-money-nj.mts` | Runs daily but reads the Morris County ballot to order its walk and is a one-state script. Fold into one money job per state, fix why it stopped publishing, delete RULING citations. |
| `tests/campaign-finance-data-plane.test.ts` | Keep publishing checks; delete the test pinning finance sources as owner-only. |
| `tests/cochise-voting-sites.test.ts` | The PDF parsing checks are real, but the tests pin Pima, NH, NJ and Cochise as the held places. Rewrite to assert any county's refresh, not this named set. |
| `tests/government-finance.test.ts` | Budgets are owed, but the national finance module and money card are used only by this test. Wire them into the runner and reader. |
| `tests/manual-ballot-profile-data-plane.test.ts` | Promotion and last-good-version tests are real. Two tests pin owner-only runs with no clock and police which files may exist. |
| `tests/nj-morris-data-plane.test.ts` | Make Morris a data row in the national ballot job and drop Morris-only assertions. |
| `tests/voting-sites-prl-data-plane.test.ts` | Keep promotion tests; delete the assertion that voting-sites and PRL are owner-only commands, so both run on a schedule. |
| `tests/voting-sites.test.ts` | Delete 'all three covered states are represented'; voting sites must work for any state. |

Group H (inventory): Voting sites come from the national source for every county. Then the Cochise special case is deleted.

## 2. Groups

### Group F (1 row)

Inventory: FEC is read nightly for every federal candidate and state money runs per state on a clock. Then the Pima/AZ-06 code and seed files are deleted.

| Path | Action |
|---|---|
| `lib/funding/state-vocabulary.ts` | Nothing imports it but a test. It holds old fetch attempts as code and an approval gate not in the rules. Delete in the same release as lib/control-plane/campaign-finance/obligations.ts's replacement. |

### Group N (3 rows)

Inventory: Large, slow-changing reference files (the ZIP index, boundary files) move to wtp-assets and are read through the CDN. Facts (body descriptions, seat makeup, coverage tiers, Arizona text compiled into code) live in the database, where the factory checks and updates them, and are published per state to wtp-assets for readers. Readers never pull these from Neon.

| Path | Action |
|---|---|
| `data/ballot/measure-records-first-seed.json` | Readers see these measure explanations, and they are bundled into the code, so only a code release changes them. Move into the database; none there now. |
| `data/campaign-finance/filing-regimes.json` | Move into the database and seed one regime per state from the state agency list. |
| `data/states/az/reference/body-blurbs.json` | Reader text bundled into code; only a release changes it, and only Arizona has it. Move into the database. |

Rows of these groups that stop free acquisition are in section 1: F (4), H (1).

## 3. The rest

| Path | Action |
|---|---|
| `app/api/address/resolve/route.ts` | Move that join to a general ballot module so nothing depends on a county-named file. |
| `app/api/ask/agenda/route.ts` | Answers from our data, but saves nothing. Every Ask question must be saved with the reader's place. |
| `app/api/ask/grounded/route.ts` | Questions without a returning-reader ID are never saved, the AI answers only when we hold zero records, its label trails the answer, stances are refused, Pima has its own path, and few gaps become work. |
| `app/api/ballot/scope/route.ts` | Generic, but it imports the contest join from the Morris County ballot module. Move the join to a general ballot module. |
| `app/api/funding/[target]/route.ts` | Arizona gets its own identity read. Make the state money path the same for every state. |
| `app/api/official-actions/[subject]/route.ts` | Only Arizona subjects ever get actions. Read official actions for every state the same way. |
| `data/reference/state-cf-agencies.md` | Keep the provenance; remove the numbered ruling citations and policy sections. |
| `lib/ask/ballot-inventory.ts` | Needed by Ask, but joins candidates through an Arizona-only identity module. Use the generic ballot identity for every state. |
| `lib/ask/ballot-summary.ts` | Office words are a closed list shaped by the pilot ballots (Arizona mine inspector, corporation commission). Make office vocabulary open data so any state's offices match. |
| `lib/ask/candidate-profile.ts` | Hard-codes the candidate-profile scope to Arizona, New Hampshire and New Jersey. Read the scope for the reader's own state from data. |
| `lib/ask/gap-codes.ts` | Widen to every kind of fact Ask is asked about (officials, money, ballots, votes, contacts, districts). |
| `lib/ask/gap-observation.ts` | Skips every answer without a coded meeting gap and refuses to store the place. Record every unanswered question by place and subject; delete the quoted owner decision. |
| `lib/ask/grounded-state.ts` | A hard 400-calls-per-day cap per server that Sean never set. Read the limit from Admin's spending settings, or remove it. |
| `lib/ask/held-filing-subjects.ts` | Arizona only: reads the Arizona ballot projection and nothing else. Read held filings for whatever state the reader is in. |
| `lib/ask/local-finance.ts` | The whole module is Pima County filings, with a hand-typed Vail committee mapping and banned 'X, not Y' copy. Read local filings by the reader's place from data. |
| `lib/ask/meeting-history-votes.ts` | Built for 'how did they vote years ago' and never connected; only a test calls it. Wire it into the Ask route. |
| `lib/ask/model.ts` | The AI-only answer runs on the cheapest model with thinking off and never steps up. Escalate when it hedges; remove Sean attributions and the governance pointer. |
| `lib/ask/office-contacts.ts` | Built today and never connected (its commit says 'hook pending'). Wire it into the Ask route so readers get office contacts. |
| `lib/ask/office-question.ts` | Office vocabulary is a closed list built from AZ/NH/NJ offices. Make it open data so any state's offices are recognized. |
| `lib/ask/reader-officials.ts` | Office words are a closed list from pilot states (corporation commissioner etc.), so other states' offices miss. Make the vocabulary open data. |
| `lib/ask/server-sources.ts` | Blocks Open States state legislators in production, limits measure analyses to Arizona, and imports the Morris County module for contests. Remove the ban and the state checks. |
| `lib/ask/synthesize.ts` | Timeouts of 6 and 12 seconds break the 3-second rule, and stance or empty packs return nothing so no labeled AI answer follows. Fix timing; let the AI fallback run. |
| `lib/ask/validate.ts` | The no-voting-advice check also rejects plain facts like 'members vote for the chair'. Narrow it to advice aimed at the reader. |
| `lib/ask/votes.ts` | State legislators' votes are only joinable through the 'retired' Open States test fixture switch. |
| `lib/ballot/analyses.ts` | Only reads Arizona's ballot package, so measure analyses can never show for any other state. Read analyses for any state's measures from the ballot data instead. |
| `lib/ballot/auxiliary-preloads.ts` | Useful code, but one of its fixed families is "nh-members", a New Hampshire-only slot. Replace it with a state-legislators family that works for any state. |
| `lib/ballot/candidate-cards.ts` | Code runs and is fine, but comments carry rulings and a tombstone for deleted code. Delete the ruling text at lines 35-60 and the whole tombstone block at 125-150. |
| `lib/ballot/candidate-contacts.ts` | Read candidate filing contacts from any county or state's ballot data instead of one county. |
| `lib/ballot/candidate-portraits.ts` | This is exactly what the rules say should publish on its own, but nothing calls it except a test. Wire it into the campaign-site job so campaign photos reach cards. |
| `lib/ballot/candidate-sites.ts` | Works and is used, but comments cite numbered rulings. Remove the ruling citations in the comment at lines 35-47. |
| `lib/ballot/candidate-targets.ts` | Certified-lineup nominees are only added for Arizona. Add nominees from every state's lineup data instead of the state === az check. |
| `lib/ballot/contest-universe.ts` | Each verified fact should attach on its own; keep "unresolved isn't challenger". Remove ruling citations. |
| `lib/ballot/coverage-notes.ts` | General scoping works, but hard-codes three Pima notes to ZIP 85641 and special-cases "ballot-az-pima". Move those three scopes into the Pima source data and drop the special case. |
| `lib/ballot/dated-events.ts` | Decides "still ahead" on Phoenix time for every state, so East Coast readers lose a same-day step hours early. Use the election state's time zone. Trim the 07866 bug-story header. |
| `lib/ballot/election-dates.ts` | Move election calendars to data rows filled for every state from the state election office list, then drop this list. |
| `lib/ballot/general-lineup.ts` | Only reads Arizona's ballot package and Arizona contest ids. Read certified lineups for any state from ballot data. |
| `lib/ballot/generic-projection.ts` | This is the right national ballot path, but one bad ballot anywhere throws and blocks every state's ballots. Drop only the broken ballot or contest and serve the rest. |
| `lib/ballot/incumbency-resolve.ts` | Accept Open States and official rosters for every state; drop the NH-only anchor and ruling citations. |
| `lib/ballot/measure-provisions.ts` | Default to the reader's loaded ballot for any state and delete MEASURE_PROVISIONS. |
| `lib/ballot/measure-records.ts` | Read measure records from each state's ballot in the database and delete the seed file path. |
| `lib/ballot/measure-summary.ts` | Defaults to Arizona's records and keeps a frozen seed list for tests. Take records from the reader's state ballot and delete MEASURE_SUMMARIES. |
| `lib/ballot/pick-jurisdiction.ts` | Build the label from the county and state names in the place data for any ballot. |
| `lib/ballot/picks.ts` | Works, but the comment credits a decision to Sean with a date. Remove the "(October 1, 2026, Sean)" attribution; describe what the code does. |
| `lib/ballot/polling-door-reader.ts` | Good general reader, but it refuses any capture that isn't an official site. Under the rules official is never required; accept other sources and let official values replace them. |
| `lib/ballot/polling-place-links.ts` | Production reads links from data, but the code still carries a typed seed for Arizona, New Jersey and New Hampshire only. Delete the seed and fill a link for every state from the election-office list. |
| `lib/ballot/reader-sources.ts` | Move Pima, Merrimack and Morris into the national ballot data and drop the legacy path. |
| `lib/ballot/registration-links.ts` | Same as polling links: production reads data, but a typed seed covers only Arizona, New Jersey and New Hampshire. Delete the seed and fill every state from the election-office list. |
| `lib/ballot/registry.ts` | Ballots come from three counties typed into code (Morris NJ, Pima AZ, Merrimack NH). Load those as rows in the national ballot data and delete this list. |
| `lib/ballot/seat-holders.ts` | Read seat holders for every state from Open States, with official rosters replacing them; drop the NH-only title parser and RULING citations. |
| `lib/ballot/uncontested.ts` | Only checks the three hand-typed county sources, and adds certified nominees for Arizona only. Read every state's ballot data and lineup instead. |
| `lib/ballot/voting-sites-data-plane.ts` | All voting sites are one record scoped to Arizona, New Hampshire and New Jersey for 2026, and non-official sources are refused. Scope by state so any state can publish; accept non-official sources. |
| `lib/ballot/voting-sites.ts` | Carries a New Jersey-only research log as code and a long refusal paragraph readers see. Delete NJ_DISTRICT_RUNGS, shorten the refusal copy, strip the quoted rulings. |
| `lib/civic-data/manual-read-models.ts` | Site reads ballots and profiles through it, but ballots are two state-specific readers (Arizona/Pima and New Hampshire/Merrimack) instead of one national ballot reader. |
| `lib/control-plane/ask-gap-observations.ts` | Header quotes a superseded decision barring saved question text and reader place. Rulings now require every Ask question saved with the reader's place; remove that policy text and the 'deliberately not here' list. |
| `lib/control-plane/campaign-finance/answers.ts` | Running code uses only its HeldFilingUniverse type. Move the type to model.ts and delete the rest. |
| `lib/control-plane/campaign-finance/authority.ts` | Generic resolver is fine, but it hard-codes Pima County, Tucson and Arizona authorities as constants. Remove them so authorities come from data for every state. |
| `lib/control-plane/campaign-finance/held-records.ts` | Ask reads money through Pima-only functions and Arizona file paths. Replace with a money reader keyed by place for any county, plus federal FEC for any contest. |
| `lib/control-plane/campaign-finance/model.ts` | Remove the policy text that keeps money out of the database and the ruling citations. |
| `lib/control-plane/scheduler/providers/ask-gaps.ts` | By design it only makes work from held meeting gaps and never from questions readers asked; every question Ask can't answer should become work for that place and subject. |
| `lib/db/ask-signal.ts` | Ask questions are never saved: the write step is optional and the Ask route never passes it, and a missing browser key drops the question. Make it always write to ask_interactions, keyed key or not. |
| `lib/funding/concentration.ts` | Readers see an in-state versus out-of-state split of individual money. The rules allow individual totals plus the one small-donor share only; remove that split. |
| `lib/funding/donor-privacy.ts` | Keeps names and places of individuals off pages, as the rules require, but adds a by-state breakdown of individual money. Remove byState; the rules allow totals plus one small-donor share. |
| `lib/funding/freshness.ts` | Shows readers technical disclaimers ("not a complete cross-authority answer", "bundled bootstrap"). Show when the source was last checked in Sources instead, and drop these notes. |
| `lib/funding/nominee-money.ts` | Gap records are hard-wired to Arizona's agency and Arizona's lineup, and comments cite rulings and Sean. Take the agency from the nominee's state data; strip the citations. |
| `lib/funding/snapshot.ts` | Falls back to a committed FEC JSON file in the repo when the database has no version. Read only from the database; delete the bundled file path. |
| `lib/funding/state-snapshot.ts` | Loops only over Arizona, New Hampshire and New Jersey. Read state money for any state from the national campaign-finance records. |
| `lib/funding/target-authorities.ts` | State money applies only if the state is Arizona, New Hampshire or New Jersey, plus an Arizona flag. Pick the state's money source from data for any state. |
| `lib/holdings/runtime-paths.ts` | Ask uses it. Keep stateForFips; remove the repo roster and ballot path builders once Ask reads rosters and ballots from the database. |
| `lib/identity/az-2026.ts` | Ask and the ballot use it, but it is one state typed into code reading repo files. Replace with one state-agnostic candidate identity reader from the database. |
| `lib/identity/reader-person.ts` | Positions and Ask use it. Remove the direct Arizona lineup import so the join works for every state. |
| `lib/identity/types.ts` | Remove the state: "AZ" literal types and ruling citations so the registry shape fits any state. |
| `lib/officials/body-definitions.ts` | Site reads it, but it is reader help text typed into code, with state entries only for NJ, NH and AZ. Help text must be data in the database, for every state. |
| `lib/officials/curated-definition-reader.ts` | Keeps the old code-typed text as a fallback 'until River checks the replacement'. Read only from the database. |
| `lib/officials/executive-actions.ts` | Built around one Arizona contract. Make it one reader for every state's executives. |
| `lib/officials/form-definitions.ts` | Help text typed into code for NJ, NH and AZ only. Move it to the database and cover every state. |
| `lib/officials/office-blurbs.ts` | Reader help text typed into code, including Tucson- and NJ-only entries. Move it to the database as editable text for every place. |
| `lib/officials/reader-actions.ts` | Has an Arizona-only identity path for ballot subjects. Remove it and use the national identity path. |
| `lib/ripcords.ts` | One switch keeps itemized donor names live, but the rules say individual donors are never named. Delete that display and its switch. |
| `lib/routing/ask.ts` | Keeps a block titled "the author's matcher ruling" and ends weak matches in a refusal. Delete the policy text and send unmatched questions on to the labeled AI answer. |
| `lib/routing/classifier.ts` | Sean sets limits in Admin only; read it from Admin. Remove the RULING 234 citation. |
| `lib/routing/named-entity.ts` | Used by Ask. Remove the RULING 103 citation; Pima examples stay only as test cases elsewhere. |
| `lib/routing/resolve.ts` | Used by Ask and the address prompt. Remove the RULING 118 and RULING 139 citations. |
| `lib/routing/topics.ts` | Carries a Pima County library-district fact typed into code. Move place facts like this to data; keep the national topic map. |
| `lib/routing/unsourced-fallback.ts` | Held to one or two sentences, 300 tokens and the cheapest model, told never to state names, dates or numbers, with a hedging label. Give normal answers with a plain lead label. |
| `lib/translate/curated-migration.ts` | Never run; only its test calls it. Moving code-held text into data is what the rules want, so run it once inside the translation job, then delete it with the old blurbs. |
| `lib/translate/playbook.md` | Read by the translation worker through a computed path. Change "from the supplied official text alone" to the saved source text, since official sources are never the only acceptable ones. |
| `lib/translate/publication.ts` | Built but only the unwired translation runtime calls it. Wire it in with the standing translation job below. |
| `lib/translate/runtime.ts` | Nothing outside tests calls it. Plain-English translations have never published. Wire it into the runner's standing jobs. |
| `lib/translate/standing.ts` | Built, but nothing in the runner calls it, so translations never reach readers. Put it on a clock for every place in the runner. |
| `lib/translate/text-runtime.ts` | Only the unwired standing job calls it. Wire it with that job. |
| `lib/translate/worker.ts` | Only the unwired translation runtime calls it. Wire it with the standing job. |
| `tests/action-outcome-data-plane.test.ts` | Good behavior, but it reads committed Arizona data files that should move to the database; use inline fixtures instead. |
| `tests/answer-length.test.ts` | A code-set limit Sean never set; it throws away answers and keeps Ask from answering as fully as Claude would. Remove the fixed limit or make it an Admin setting. |
| `tests/ask-agenda.test.ts` | Real Ask behavior, but it reads the committed meetings snapshot file and carries numbered-ruling labels; switch to a fixture and strip the labels. |
| `tests/ask-answer-contract.test.ts` | Real Ask contract; remove the numbered-ruling comment. |
| `tests/ask-box.test.ts` | Delete the daily classifier cap test (an env-var cap Sean didn't set) and the pilot-ZIP everyday contact grid tests; strip ruling attributions. |
| `tests/ask-destinations.test.ts` | Real routing checks; remove the "author's ruling" and dated-ruling wording in comments and a test title. |
| `tests/ask-gap-observation.test.ts` | Delete tests pinning that Ask saves no question or place and that uncoded gaps record nothing; the rulings say every question is saved with its place and becomes work. |
| `tests/ask-gap-work.test.ts` | Delete the test pinning that gap work never fetches, and stop reading the committed meetings snapshot; the rest is real behavior. |
| `tests/ask-group-money-answer.test.ts` | Real behavior, but it tallies exactly Arizona, New Hampshire and New Jersey from committed state files; loop over whatever states are held. |
| `tests/ask-identity-bridge.test.ts` | Pins an Arizona-only identity table read from committed files; rewrite against a national identity match from the database. |
| `tests/ask-integration.test.ts` | Real Ask wiring; one test reads the committed Pima ballot file, which should move to the database. Use a fixture. |
| `tests/ask-latency-shape.test.ts` | Speed behavior stays; remove the "Sean's bar" attribution comment. |
| `tests/ask-length-fallback.test.ts` | Tied to the fixed answer-length limit Sean never set; remove along with that limit. |
| `tests/ask-matcher.test.ts` | Real routing checks; remove "author's matcher ruling" and numbered-ruling wording. |
| `tests/ask-model-constant.test.ts` | Real Ask configuration checks; remove the numbered-ruling comment. |
| `tests/ask-model-registry.test.ts` | Model routing and escalation stay; remove the "Sean, 7:25 PM" chat quote, since chat instructions are not standing rules. |
| `tests/ask-money-answer.test.ts` | Real behavior; stop reading the committed Arizona, New Hampshire and New Jersey money files and the three-state loop; use fixtures. |
| `tests/ask-prompt-cache.test.ts` | Real behavior; remove the numbered-ruling comment. |
| `tests/ask-reader-edge.test.ts` | Speed behavior stays; stop pinning the three-state contract keys and committed data files; remove the "Sean's" attribution. |
| `tests/ask-relevance.test.ts` | Keeps answers accurate. |
| `tests/ask-representation-parity.test.ts` | Real behavior; remove the numbered-ruling comment. |
| `tests/ask-signal.test.ts` | Saving every question is required; remove the numbered-ruling comment. |
| `tests/ask-topic-timeline.test.ts` | Real behavior, but it reads the committed meetings snapshot and Arizona outcomes file; use fixtures and remove the "Sean's bar" note. |
| `tests/ask-votes.test.ts` | Real behavior, but it reads committed Arizona, New Hampshire and New Jersey roster files; use fixtures. |
| `tests/az-finance-corpus.test.ts` | Pins an Arizona-only money corpus and script; test the per-state money reader generally and remove the numbered-ruling labels. |
| `tests/az-identity-projection.test.ts` | Real behavior on live code; remove the numbered-ruling labels. |
| `tests/azleg-actions-store.test.ts` | Render checks on live code stay; drop the tests of the one-off hunt parser script nothing runs. |
| `tests/ballot-coverage-note-scope.test.ts` | Real behavior; it reads the committed Pima ballot file, which should move to the database. Use a fixture. |
| `tests/ballot-measure-text.test.ts` | Rendering checks stay; the first test asserts the measure text is committed in the repo for named Pima measures. Read from fixtures instead. |
| `tests/ballot.test.ts` | Rebuild on fixtures: it pins committed Morris, Pima and Newbury ballot files and pilot ZIPs, and quotes "the author's ruling" five times. |
| `tests/body-definition-body-keyed.test.ts` | Real behavior, but built on the stale lib/registry/registry.json that nothing running reads; use fixtures. |
| `tests/body-definition-identity.test.ts` | Real behavior; switch off the stale registry.json copy and remove the numbered-ruling comment. |
| `tests/body-territory.test.ts` | Real behavior; assert on a fixture rather than requiring the committed territory file, since place data belongs in the database. |
| `tests/campaign-finance-answerability.test.ts` | Real behavior, but it reads committed FEC and Pima money files and a test-only coverage module; use fixtures. |
| `tests/candidate-links.test.ts` | Real checks, but they read committed Arizona, New Hampshire and New Jersey ballot files; use fixtures. |
| `tests/control-plane-campaign-finance.test.ts` | Drop tests for coverage.ts, which nothing runs, the Arizona-walls-verbatim pin, and the "never sold, wall 1" policy test. Keep model and obligation tests. |
| `tests/everyday-routing-data-plane.test.ts` | Drop the test pinning the hand import's 36 cells and 26 sources for four pilot ZIPs. |
| `tests/filing-regime-registry.test.ts` | Drop tests that use coverage.ts, which nothing runs, and the clock-reading source scan. |
| `tests/funding-source-isolation.test.ts` | Isolation is real, but the test builds in an Arizona-only identity reader. Funding identity should work for every state. |
| `tests/funding.test.ts` | It pins named individual donors on cards (ripcord live), which the rules forbid, plus a pilot candidate gate and ruling citations. |
| `tests/helpers/pima-september-22-sitting.ts` | Useful Ask fixture, but it reads the committed production seed in data/states/az/outcomes. Read the tests/fixtures copy so the data can leave the repo. |
| `tests/incumbency-eligibility.test.ts` | Real fairness behavior, but it cites numbered rulings in comments and messages. |
| `tests/measure-order.test.ts` | One test reads the committed Pima ballot file, which should live in the database; use an inline fixture there. |
| `tests/measure-translation-standing.test.ts` | The translator is built but nothing runs it, so translations never publish. Wire lib/translate/standing.ts into a runner schedule; the test then stays. |
| `tests/measure-translator.test.ts` | Wire it as a standing national job so translations reach readers; the test then stays. |
| `tests/official-action-source-isolation.test.ts` | Isolation and explicit failure are real, but the actions authority is Arizona-only. Make it per-state data and drop the AZ-only assertions. |
| `tests/pdc-reader-remaining-repairs.test.ts` | Delete the registry-seed-proof test; lib/holdings/registry-seed-proof.ts is reached only by tests. |
| `tests/reader-finance-authority-isolation.test.ts` | Isolation is right, but it pins a separate Arizona-only finance authority. Make finance per state from data and drop the AZ-only assertions. |
| `tests/reader-finance-delivery.test.ts` | Delete the tests that block Open States ("retired Plural" and "retired intermediary") identities from the finance bridge. |
| `tests/routing.test.ts` | Routing stays; an unmapped topic must get the labeled AI answer, not a refusal. Strip RULING 62/116/118 labels. |
| `tests/tester-9-4-ask.test.ts` | Name matching stays; an unknown named body must get the labeled AI answer plus gap work, not a plain gap line. |
| `tests/text-translator.test.ts` | lib/translate/standing.ts and text-runtime.ts are reached only by this test; wire translation as a standing job so readers get plain English. |
| `tests/unsourced-fallback.test.ts` | Fallback must lead with the plain AI label, give a normal-length answer for any question we can't answer, and file gap work; drop 'stays short' and the Sean-dated title. |

**Check and close (13 rows).** The inventory gives these only comment, citation or deleted-file reference fixes, which the cleanup release was doing. Confirm each is done on `river`; finish any leftover; then close the row: `lib/ask/trace.ts`, `lib/control-plane/campaign-finance/filing-regime.ts`, `scripts/fec-disclosure-directory.mts`, `tests/ballot-finance-obligations.test.ts`, `tests/ballot-reader-edge.test.ts`, `tests/district-territory.test.ts`, `tests/donor-aggregation.test.ts`, `tests/held-filing-subjects.test.ts`, `tests/measure-provisions.test.ts`, `tests/measure-records.test.ts`, `tests/nj-filing-parse.test.ts`, `tests/reader-last-mile-ask-render.test.ts`, `tests/reader-last-mile-ask.test.ts`.

## Notes

- Money on reader pages: rulings §9. Ask: rulings §0 and §6.
- The registry lane deletes `lib/civic-data/morris-filing-documents.ts` once your national ballot job reads Morris County as data; tell River when it is live.
