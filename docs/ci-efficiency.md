# CI verification and merge efficiency

This document describes the CI execution and retry contract. [PR #344](https://github.com/SeanJ22/meanwhile/pull/344) records rollout status and the measured hosted run evidence; its run links distinguish completed proof from pending work. Hosted measurements are required before claiming a speedup. The existing required contexts remain `build (default)`, `build (standalone)` and `gates (test · lint · tsc)`; repository settings are unchanged.

## Measured starting point

Five successful ready-PR runs on the same workflow took 39m15s–41m42s to finish required checks. Runner admission took 3–5 seconds. Both application configurations already built concurrently in 1m54s–2m23s total per job. Tests, not rebuilding, determined merge readiness.

| Run | Required checks complete | Sum of runner time | Rounded runner minutes |
| --- | --- | --- | --- |
| [35525230618](https://github.com/SeanJ22/meanwhile/actions/runs/35525230618) | 39m18s | 43m56s | 46 |
| [35500727348](https://github.com/SeanJ22/meanwhile/actions/runs/35500727348) | 39m15s | 43m43s | 46 |
| [35498027335](https://github.com/SeanJ22/meanwhile/actions/runs/35498027335) | 40m19s | 45m00s | 47 |
| [35479654386](https://github.com/SeanJ22/meanwhile/actions/runs/35479654386) | 41m42s | 46m03s | 48 |
| [35476985030](https://github.com/SeanJ22/meanwhile/actions/runs/35476985030) | 39m34s | 43m19s | 44 |

For run 35525230618, the critical job spent 29s in checkout, 28s in deterministic preflight, 3s installing dependencies, 61s linting, 54s checking types, 88s in governance/state checks (82s of that checking generated state manifests), 19s restoring/installing/asserting the browser, **34m19s testing**, and 3s in final schema/integrity checks. Artifact trace upload took 1s per build. pnpm and browser logs confirm primary-key cache hits. These are warm-cache results; a three-second install is not a cold-install estimate.

The suite includes exhaustive real-route Reader proofs. The largest single observed test took 237.8s, federal vote coverage 162.4s, and held-vote/contact/action coverage 141.9s. Assertions and coverage must remain intact. The generated-artifact test also invoked the same governance compiler for fourteen outputs. Its replacement snapshots all originals first, runs each command once, compares every output, and restores files; a negative stale-sibling fixture proves regeneration cannot repair away the failure.

Local warm-installed Windows measurement for the generation check: comparable targeted runs were 89.17s before and 67.15s after. A later complete-file validation measured 101.26s for the regeneration body under different host load. The compiler-call reduction is proven; these variable local timings are not a stable hosted end-to-end speedup claim.

## Execution and failure behavior

The first hosted full run, [35683872583 attempt 1](https://github.com/SeanJ22/meanwhile/actions/runs/35683872583/attempts/1), completed required checks in **18m16s** including 91s before admission started. Summed runner time was **46m42s**, or **52 rounded minutes / $0.312** at the Linux list rate. This is about 54% less elapsed time than the 39m34s baseline median, with six more rounded minutes ($0.036, about 13%) than the 46-minute baseline median. Extra isolated job setup and per-job rounding explain the increase; invoice charges remain unknown.

| Job | Elapsed runner time |
| --- | --- |
| Admission | 1m10s |
| Default / standalone build | 2m19s / 2m00s |
| Types / lint / governance | 1m45s / 1m37s / 2m22s |
| Test partitions 1 / 2 / 3 / 4 | 7m56s / 12m06s / 6m10s / 8m23s |
| Final integrity gates | 54s |

All 681 discovered test files appeared exactly once across the four successful manifests, with the same clean tested merge commit, tree, configuration and suite hashes. The slowest test step itself took 10m46s. This was a **mixed-cache** measurement: pnpm had hits; the new Next build-cache keys missed. It is not a fully warm or fully cold benchmark. The unequal partition times remain an optimization opportunity. No test file was omitted.

After Census #342 merged, the required combined revision received a new full run, [35685560850](https://github.com/SeanJ22/meanwhile/actions/runs/35685560850). It passed in **15m47s**, with 4s before runner admission, **48m04s summed runner time / 54 rounded minutes / $0.324**. Both compiler caches and pnpm were warm; default and standalone jobs took 1m29s and 1m13s, with fresh compilation taking 6.4s and 7.9s. This is a comparable updated-base measurement, not an identical-input cache experiment. Total test-step time varied from 29m18s to 33m23s across the two after runs. Parallel jobs spent 5m31s–5m37s checking out their independent trees and 36–38s installing dependencies. Extra checkout/browser setup and per-job rounding must be included in the cost comparison; faster elapsed time did not make the full run cheaper.

The full run discovers every test file, but existing conditional test skips remain explicit: build-dependent assertions in test-only checkouts, Windows-only checks on Linux and a server-side outbound-trap prerequisite. Mandatory trace/bundle assertions still execute after both builds. The first full run reported 6,919 passes, eight conditional skips and zero failures across 6,927 tests; a skipped assertion is not a pass.

REST job creation/start timestamps separate runner queue from prerequisite waiting: all three representative baseline jobs queued for 3s; the combined warm run's jobs queued for 4–8s each. Queueing did not explain the original 42-minute duration. The warm test-job log also confirms an exact-key Playwright cache hit; dependency/browser executable checks still ran.

The cost increase is accounted for by the saved step timings. Representative baseline run 35525230618 spent **86s in checkout and 2,550s elsewhere**; the combined warm run spent **337s in checkout and 2,547s elsewhere**. The extra independent checkouts account for the net runner-time increase in that pair. Rounding overhead then rose from 2.07 to 5.93 minutes because GitHub rounds each job separately. These are measured accounting categories, not a claim that every test's runtime was unchanged.

PR #344 merged normally as `116c8fc958ab2abe44f3a957f1c08f9c460fcc0c`. Its tree exactly matched the certified candidate. [Main run 35686685877](https://github.com/SeanJ22/meanwhile/actions/runs/35686685877) attested that tree in 2m34s elapsed / four rounded minutes without repeating install, builds or tests. [Post-deploy run 35686685793](https://github.com/SeanJ22/meanwhile/actions/runs/35686685793) took 1m25s runner time / two rounded minutes and recorded a real HELD/CURRENT receipt at `2026-09-21 21:24:40 America/Phoenix` for that served merge. This verifies deployment/integrity, not a browser or Admin integration walkthrough.

1. Admission runs dependency-free deterministic preflight once. If full verification is needed, a bounded install enables the existing read-only release-integrity gate before any application build, browser or test suite starts. This network prerequisite is separate from the dependency-free preflight definition.
2. Lint, fresh-checkout types and governance/evidence checks run in independent checkouts. The test jobs wait for their successful completion. Both original application configurations retain their distinct caches and bundle budgets.
3. Four test runners partition the canonical test command's complete TS and TSX file set, deterministically, with no changed-file omissions. Each uploads its exact assignment, commit/tree/configuration hashes, complete output and exit status. Measured file durations guide a bounded scheduling model with balanced file-count limits. Unknown files always run with an explicitly estimated scheduling cost; invalid hints fall back to equal positive costs. Hints never count as a test result.
4. The existing required final gates context always reports. It explicitly rejects a selected job that failed, was cancelled, was skipped, or is absent. It verifies the current PR head/base/draft policy against the original event and its checkout against the exact workflow SHA, then runs schema and live integrity verification. Draft and exact-tree attestation omissions are explained separately from failures.

All checkouts explicitly use the workflow SHA. Tests receive no mutable production/test-database credentials from the workflow. Separate runners isolate files, ports and fixtures; local mutating generator tests retain their common tree lock. No test result, build output or mutable integrity receipt is restored from a cache. pnpm caches are content stores keyed by OS/architecture/Node major/lockfile; Next caches are incremental compiler caches separated by mode, lockfile and build configuration; Playwright caches are keyed by OS/architecture/lockfile and the executable is still asserted after installation.

File processes remain isolated, with **one file process at a time inside each checkout** and four independent runner checkouts executing together. The fixture audit found that generator/tracker writers use locks that not every reader acquires: a policy reader can observe a generator's partially rewritten file, and a tracker snapshot can race a temporary transaction. Keeping each checkout serial prevents these races without weakening assertions or altering feature code. Existing server fixtures use ephemeral ports; database fixtures receive no shared credentials through this workflow. The manifest records available and chosen concurrency, platform and memory; configuration identity includes the runner, timing reporter, scheduling hints and concurrency choice.

The secondary reporter records Node's file-harness summaries alongside unchanged spec diagnostics. A complete expected-file set and terminal stream marker are required before a successful run can supply new hints. Bootstrap failures, termination, missing summaries and failed assertions remain visible and cannot become scheduling evidence. File-harness time excludes some process startup/exit overhead; use job timestamps for elapsed time and billed usage. Local Windows weights are explicitly local scheduling hints, not a prediction of hosted Linux cost or a substitute for hosted verification.

The initial hint collection passed all 682 files on the clean certified `f3e18b58` tree: 6,933 assertions passed, one existing conditional skip, 18m52.282s local elapsed. Those historical hints came from two local file processes and remain scheduling estimates only. A separate fixture proved that Node sorts CLI file arguments alphabetically. The planner compares round-robin and longest-first membership using the actual chosen concurrency, retains the better estimate, and accepts at most eight improving swaps. Counts remain balanced and every file runs. The two-worker experiment was rejected after the shared-fixture audit; its modeled savings are not a shipped performance claim. Hosted elapsed time and cost remain the evidence for improvement.

## Expired integrity receipts and retry

[Cleanup #341 attempt 1](https://github.com/SeanJ22/meanwhile/actions/runs/35673137395/attempts/1) spent 41m02s in gates, including 35m56s testing, before its final six-second freeze check refused a 39.9-hour-old receipt against the unchanged 24-hour limit. Both build jobs had passed. The existing observer subsequently recorded a current HELD reading without changing code. The old job boundary nevertheless repeated tests when the failed gates job was retried.

The early check prevents that known-expired state from buying the expensive jobs. It does not replace final verification: production can change or a receipt can expire while tests run.

If **only the final integrity verdict fails**, refresh the receipt through the existing post-deploy observer, which verifies the served production commit and durably records/readbacks the measurement. Then rerun the failed final job in the same workflow run. GitHub retains successful prerequisite jobs and the original SHA/ref for a job retry. The final job independently reads current production and the receipt again; refreshing the receipt never turns a failed test into success.

Reuse is refused for changed PR head, merge base, draft/ready policy, missing/non-green prerequisite jobs or checkout identity mismatch. Source, dependency lockfile, test/configuration and repository policy inputs remain bound to the same workflow tree. Repository protection still enforces current required contexts and up-to-date main. A changed base requires a new full run. No cross-run step-log inference, stale-result acceptance, or rerun of another session is authorized by this procedure.

An admission failure is different: no expensive proof exists yet. After refreshing its prerequisite, retry the failed workflow so all previously withheld verification runs. A code/test failure requires correction and new full verification.

Measured same-input terminal revalidation in [attempt 2](https://github.com/SeanJ22/meanwhile/actions/runs/35683872583/attempts/2) took **48s runner time**, about 56s from request, and one additional rounded minute ($0.006). All ten prerequisite jobs retained their original execution timestamps. The final job read a real CURRENT/HELD receipt again. By comparison, cleanup's old final-job retry took **28m04s**, including **24m16s repeating tests**. The new rehearsal did not deliberately expire production's receipt: it proves safe job-boundary reuse, while the historical cleanup incident supplies the real expired-receipt case.

An isolated failure-only [expiry rehearsal](https://github.com/SeanJ22/meanwhile/actions/runs/35683927305) used the unchanged expiry evaluator with a synthetic 39.9-hour receipt. Admission failed, no dependency-install/browser/test/build step ran, and the required final reducer failed. It took 2m27s elapsed / four rounded runner minutes ($0.024). Production receipts and the 24-hour policy were unchanged. This synthetic negative proof is separate from a real observer refresh measurement.

## Check selection rollout

File-impact selection is **not enabled** in this first change. Every ready PR receives the full suite; draft structural checks and existing proven exact-tree main attestation remain the only bounded alternatives. Each run's selection summary states this explicitly.

Before enabling impact selection, classify:

| Category | Required treatment |
| --- | --- |
| Always | Preflight, change-input validation, governance/generated consistency, selection proof and final fail-closed status; applicable live schema/integrity checks |
| Affected areas | Transitive imports, fixtures read dynamically, domain contracts, generators and their consumers; tests selected from the dependency closure, never merely edited test files |
| Full suite | Shared libraries, database/schema contracts, package/lock/config/workflow changes, canonical governance and generated-source changes, unknown paths, dynamic dependencies that cannot be bounded, classifier changes or missing diff/history |

Documents are not inherently harmless: governance, templates, evidence and generation inputs often affect execution. Compare proposed selection with historical full-suite results, exercise important dependency cases, and inject an affected failing test before activation. Keep a full ready-PR backstop for risky shared changes and a regular complete verification backstop. A post-merge check cannot be the first meaningful proof of a risky shared change.

Initial historical review compared full successful runs for the two-path documentation PR #340 (35525230618), shared Postgres retry PR #339 (35500727348), and broad Reader/contracts PR #338 (35498027335). The latter two require the full suite. The first is only a potential narrow prose case; no omission is authorized by that retrospective classification. RULING 290's exact-head run 35189398507 failed prerequisites and skipped tests despite successful builds, so it cannot count as successful full-suite comparison. Dynamic filesystem reads, Reader fingerprints, generated geography traces and governance compilation require explicit dependency coverage before any selector is activated.

## Merge process and cost

Effective ruleset 21572280 requires the three existing contexts and `strict_required_status_checks_policy: true`, with zero mandatory reviews. After another PR merges, a behind branch must incorporate current main and certify the combined change. That is the reason branch updates buy new verification. Drafting and freezing one logical change before its full run, followed by a coordinated merge window, avoids unnecessary moving targets without accepting stale checks.

The repository is private and owned by a personal user. GitHub's managed merge queue is available for organization-owned public repositories or private repositories under Enterprise Cloud; it is not an available setting for this repository as owned today. Account plan details were unavailable from the authenticated API. No transfer, paid plan change, relaxed protection or automatic merge is proposed. Keep strict checks and use coordinated windows. Existing exact-tree main-push reuse already works: run 35527729617 finished in 52s without repeating builds/tests.

GitHub's current standard Linux two-core list rate is $0.006 per runner minute, rounded up **per job**. These five baseline runs represent $0.264–$0.288 of list-rate compute before included allowance; actual invoice cost is not established. The timing API returned zero billable milliseconds despite real job durations, so it is not used to claim free execution. Parallelism can add checkout/install and rounding overhead. Compare summed runner seconds, rounded minutes, cache hits/misses and artifact retention alongside elapsed time.

Deployment is separate from PR merge readiness. Sample post-deploy run 35527729655 took 10m43s, including 9m53s in the observer. Its log shows 30 attempts over 580 seconds waiting for afab0126 while production still served 432b0275; **no new integrity receipt was recorded**. The docs-only merge produced an empty `git show --name-only` result and the classifier conservatively answered cannot-tell. This is measured wasted observation, not evidence of successful deployment or receipt refresh. CI does not deploy, and Netlify's actual deployment/plugin configuration has not been proven compatible with a reusable CI build artifact. Both existing builds and post-deploy verification remain intact.

## Documentary deployment observation

The observer follow-up uses a first-parent merge difference and proves the entire served-to-candidate ancestor range before treating a change as non-shipping. Unknown history, shipping paths and mixed ranges still require observation of the candidate. Checkout retains full commit/tree history with `blob:none`; path comparisons disable rename heuristics and do not hydrate historical file contents. Current checkout bytes still have to be downloaded, so filtering is not a claim that checkout is free.

A documentary range can skip another observation only when the canonical read-only store supplies a fresh successful post-deploy receipt for the exact served commit. The complete receipt envelope must match the existing writer's format, subject, timestamp, identity and embedded reading. Malformed, expired, missing or mismatched evidence cannot authorize a skip. The workflow installs locked dependencies before this read; it retains the existing separately scoped writer solely for recording an actual observation.

When a documentary tip was not deployed but still owes an integrity reading, the observer reads the actually served equivalent software immediately. Manual refresh always requests a new reading. If production advances during polling, a new exact ancestry and non-shipping proof must place that observed commit inside the already-scoped range before it can be accepted. The receipt names the freshly observed commit, never an undeployed documentary candidate. Default/staging polling remains exact, and the release-freeze evaluator and 24-hour bound are unchanged.

Real Git fixtures cover merges, renames/deletions, shallow and blobless history, accumulated software, invalid receipt provenance and production moving during polling. Hosted runtime and cost for the documentary skip remain pending until its rollout evidence records an actual measurement; local fixture success alone is not a deployed speedup claim.

Sources: [runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing), [job retries retain the original SHA/ref](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs), [merge queue availability](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request-with-a-merge-queue).

Rollback is a normal reviewed revert of this CI change, retaining the same required status names. No repository setting needs rollback. Do not remove failed-run diagnostics or rewrite proof receipts to get green.
