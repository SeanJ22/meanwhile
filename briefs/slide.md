# Lane: slide (Box, verification and publishing)

**Starts in Codex** (suggested model GPT Astra 6). Status file: `.factory/slide.md` on `stream/slide`. If the Codex run stops, the Claude `hunters` worker (Opus 5.5) continues this lane on the same branch (common.md, "Paired continuation").

Read `briefs/common.md` first. Your work is every row in `briefs/ownership.csv` with `lane = slide` (66 rows). Each row's full reason and evidence are in the inventory. Take them in the order below.

**Area.** The Box; the verification check (rulings §3); the publish-now lane; the conflict rule; edge publication and reader readback; and removing the old multi-stage approval chain.

**Shared files you own:** `lib/control-plane/promotion/section3.ts`, `lib/civic-data/worker-publication-evidence.ts`, `lib/control-plane/workers/standing-runtime.ts`, `lib/civic-data/worker-publication-tasks.ts`.

## 1. What stops free acquisition (rulings §2)

Findings that never reach the Box never publish. These rows come first.

| Path | Action |
|---|---|
| `lib/control-plane/box.ts` | The Box only runs when an unapproved switch is on, and it is off. Delete the switch so the Box always runs. |
| `lib/control-plane/promotion/campaign-publication-cycle.ts` | Reads at most 2 candidate pages per cycle, one after another, a cap Sean never set. Remove the cap (or make it an Admin setting), read in parallel, and drop the "(Sean, Oct 6)" quote. |
| `lib/control-plane/promotion/campaign-site-cycle.ts` | Caps campaign-site reads at 12 per cycle, a limit Sean never set. Remove the cap or make it an Admin setting. |
| `lib/control-plane/promotion/window.ts` | Delete the nightly window decisions and blackout check; keep only a lease if the runner needs one to avoid double cycles. |
| `lib/control-plane/repository/worker-completion.ts` | Needed by every worker, but detective findings reach the Box only when the Box switch is on; that switch is slated for deletion so findings always flow. |
| `lib/control-plane/workers/standing-runtime.ts` | Core runtime; Box indexing still depends on the Box switch, and comments cite RULING 63. |

## 2. Groups

_None._

## 3. The rest

| Path | Action |
|---|---|
| `lib/civic-data/campaign-link-refresh.ts` | Used by publishing. A different campaign site is held as an unresolved conflict and waits; the rule is newer wins, the losing value is logged, nothing waits. |
| `lib/civic-data/candidate-builders.ts` | Core builder used everywhere, but it carries New Hampshire-only roster code, a Morris County filing builder, and a rule that refuses a short roster instead of publishing what verified. |
| `lib/civic-data/derived-campaign-site-writer.ts` | This is what publishes campaign sites today. Two verified sites for one candidate hold the link instead of newer-wins, and the header cites a numbered ruling credited to Sean. |
| `lib/civic-data/manual-prior-authority.ts` | Publishing needs it so unchanged facts are not dropped; only the comment credits a decision to Sean by date. |
| `lib/civic-data/manual-projections.ts` | Central publish builder, but it calls the Open States ban on every officeholder and works out a candidate's state from AZ/NH/NJ name prefixes. |
| `lib/civic-data/meeting-research-evidence.ts` | Runner uses it, but a researched meeting needs parser, validator, adversarial auditor and five passed burdens before it can publish. It should publish once the fact checks out against its saved source. |
| `lib/civic-data/promoted-edge-publication.ts` | Needed for fast cold pages, but its list of what to publish hard-codes the AZ and NH ballots, NH members, Pima finance and AZ official actions instead of every published source. |
| `lib/civic-data/promotion.ts` | Remove the numbered-ruling comment and the Pima-only special case in the old import path. |
| `lib/civic-data/reader-edge-publication.ts` | Needed for fast pages, but state legislators come only from the three hard-coded states and outcomes are Pima and Mesa contracts plus doors. |
| `lib/civic-data/reader-verification.ts` | Confirms readers see new data, but it is a per-contract switch with Morris, Pima and other single-place cases that must become one data-driven check. |
| `lib/civic-data/source-authority.ts` | Every publish checks it. Open States and LegiScan may carry no facts, LegiScan is research-only, ten sources cannot publish on their own, and many sources are pinned to AZ, NH or NJ. |
| `lib/civic-data/source-conflicts.ts` | Publishing uses it, but it ranks sources on a 0-to-7 ladder where Open States, Wikipedia and reference sources score 0. |
| `lib/civic-data/trusted-lkg-import.ts` | Stored versions from that cutover still need checking, so keep only that check. The one-time import planning and its New Hampshire and Pima special cases should go. |
| `lib/civic-data/types.ts` | Everything imports it; keep it. Remove the "(Sean, date)" attribution and the Pima-only evidence type when the cutover check shrinks. |
| `lib/civic-data/validate.ts` | Core check, but it refuses any record whose place is outside a source's AZ/NH/NJ list, even when the source checks out. |
| `lib/civic-data/worker-publication-evidence.ts` | A non-.gov page counts as official only if a linking .gov page is among about 13 saved pages from the same job; the search should be wider. |
| `lib/control-plane/promotion/fact-chain.ts` | Demands a second acquisition by another worker plus an audit stage before a meeting fact publishes; the rule has neither. Publish once the value is on a fresh saved page from the right place. |
| `lib/control-plane/promotion/fact-freshness.ts` | Holds facts as NOT_SCHEDULED or NEVER_ACQUIRED based on scheduler rows, not on when the evidence was captured. Judge freshness only by the capture time against an Admin-set window. |
| `lib/control-plane/promotion/fact-verification.ts` | Keep the value-on-page check. Drop burdens beyond the rule, including requiring provenance on the publisher's own host, which makes the check official-only. |
| `lib/control-plane/promotion/pipeline.ts` | Collapse it to one verification step that matches the rule, and keep the append-only record. |
| `lib/control-plane/promotion/section3.ts` | Two parts exceed the rule: news and unlisted sources must re-prove every field through a linked page, and freshness windows are fixed in code (meetings 12 hours). Make windows Admin settings. |
| `lib/control-plane/promotion/types.ts` | Reduce to a single verified state matching the rule and delete the shadow window types and the RULING 242 cite. |
| `lib/control-plane/repository/file-store.ts` | Delete the "RULING 242" nightly-door comment and the nightly-door log when that chain is removed. |
| `lib/control-plane/repository/types.ts` | Everything runs through it, but it carries ruling citations and declares the stores for the nightly five-stage approval chain, which is being deleted. |
| `lib/control-plane/scheduler/promotion-tail.ts` | The acquire-to-staged path is needed; strip RULING 207/224 framing and the activation-gate "promotionEnabled" field tied to the publishing allowlist being deleted. |
| `lib/control-plane/scheduler/scout-result.ts` | Evidence checks are the verification standard; but its refusal messages tell agents to "use the current official page", implying official-only, and it cites rulings throughout. |
| `lib/control-plane/served-reader-production.ts` | The readback is approved, but it only checks three hard-coded ballot sources (Arizona, New Hampshire, Morris NJ); it should read every published ballot source. |
| `lib/control-plane/workers/autonomous-plan.ts` | Plans are needed, but their instructions require each fact to be on "a saved official page"; any checkable source should count. |
| `lib/control-plane/workers/generalized-validator.ts` | Marked test-only but runs inside the isolated validator; it says values must be on "a saved official page" and checks OFFICIAL_SOURCE, while any checkable source should count. |
| `lib/control-plane/workers/held-meeting-contract.ts` | Meeting captures only enter worker audit for Pima's Legistar feed; derive the contract from any Legistar meeting partition instead. |
| `lib/control-plane/workers/parser.ts` | Runs in production; drop the old-format event parser once the two-publisher legacy chain goes, leaving the general parser. |
| `lib/control-plane/workers/pipeline.ts` | Keep the fact-chain projection that publishes; delete the writes into the five-stage shadow approval pipeline. |
| `lib/control-plane/workers/plan-repair.ts` | Self-repair is needed, but its instructions demand "official source bytes" and only official authorities, and restrict .org/.edu publishers; any checkable source should count. |
| `lib/control-plane/workers/routine-meeting-intake.ts` | Only Pima County's Legistar captures are retained for worker checks; it should take captures from every meeting partition. |
| `lib/control-plane/workers/standing.ts` | The general chain is needed, but a legacy branch hard-codes two Arizona feeds (Pima Legistar, Avondale CivicClerk) and state "az"; delete it. |
| `lib/control-plane/workers/validator.ts` | Runs inside the isolated validator; drop the old-format Legistar/CivicClerk validator once the legacy chain goes. |
| `lib/extract/count-assertion.ts` | Strip the ruling citations; a short count must stay a report and never hold back the rows that did verify. |
| `lib/registry/runtime-data-plane.ts` | Core publish path. It lets non-official sources like Open States fill only seats and portraits. Let them carry every fact, and remove '(Sean, date)'. |
| `scripts/publish-now-runner.mts` | Add it as a child in scripts/pilot-runner.mts so verified facts reach readers within minutes. |
| `tests/campaign-site-chain.test.ts` | Keep the campaign-site verification checks; drop driving findings through the five-stage approval chain slated for deletion. |
| `tests/campaign-site-gate.test.ts` | Delete the assertion that source code quotes Sean's Sept 21 words and the activation-gate pins; keep "plain code never uses a paid lane." |
| `tests/campaign-site-runner.test.ts` | Live publishing path; stop driving it through the five-stage approval chain and activation gate slated for deletion, and remove the "Sean, 2026-10-06" note. |
| `tests/civic-data-read-model-memo.test.ts` | Speed and correctness on live code; remove the numbered-ruling label in the header. |
| `tests/civic-data-read-model.test.ts` | Remove the ruling citation in the header and the test that checks old writers say "retired", which is a tombstone check. |
| `tests/civic-data-store-integrity.test.ts` | Store integrity and write-safety checks guard real data. Drop the test that greps source files to prove an old API family stays deleted. |
| `tests/delivery-experience-subset-verification.test.ts` | Keep the record-verification checks. Drop tests of the generalized validator and auditor, which nothing running calls. |
| `tests/held-directory.test.ts` | Good plain-code publishing, but it refuses an unlinked city .com page. Under the rules that page publishes as an ordinary source. |
| `tests/helpers/registry-runtime-first-seed.ts` | Used by about 90 tests, but it seeds the Morris County NJ ballot contract by name. Drop that once ballots are national data. |
| `tests/reader-edge-carry.test.ts` | Reader speed and cost. |
| `tests/routine-civic-data-promotion.test.ts` | Delete the test asserting LegiScan bytes stay research-only and cannot auto-promote; LegiScan is to publish on its own. |
| `tests/source-conflicts.test.ts` | Replace the 'standing wins' ranking with the rule: official beats other, then newer wins; keep the losing-value log check. |

**Check and close (9 rows).** The inventory gives these only comment, citation or deleted-file reference fixes, which the cleanup release was doing. Confirm each is done on `river`; finish any leftover; then close the row: `tests/conservation.test.ts`, `tests/control-plane-conformance.test.ts`, `tests/control-plane-fixtures.ts`, `tests/count-assertion.test.ts`, `tests/extraction-partials.test.ts`, `tests/fact-chain.test.ts`, `tests/filed-address.test.ts`, `tests/permanent-civic-data-plane-pdc8.test.ts`, `tests/trusted-lkg-import.test.ts`.

## Notes

- Dropping the approval-chain tables needs a contract migration; name it by path and River numbers it.
- Verification: rulings §3.
