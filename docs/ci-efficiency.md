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

All 681 discovered test files appeared exactly once across the four successful manifests, with the same clean tested merge commit, tree, configuration and suite hashes. The slowest test step itself took 10m46s. This was a **mixed-cache** measurement: pnpm had hits; the new Next build-cache keys missed. It is not a fully warm or fully cold benchmark. The unequal partition times remain an optimization opportunity. No test was omitted.

1. Admission runs dependency-free deterministic preflight once. If full verification is needed, a bounded install enables the existing read-only release-integrity gate before any application build, browser or test suite starts. This network prerequisite is separate from the dependency-free preflight definition.
2. Lint, fresh-checkout types and governance/evidence checks run in independent checkouts. The test jobs wait for their successful completion. Both original application configurations retain their distinct caches and bundle budgets.
3. Four test runners partition the canonical test command's complete TS and TSX file set, deterministically, with no changed-file omissions. Each uploads its exact assignment, commit/tree/configuration hashes, complete output and exit status. Equal file counts are an initial distribution; use measured shard elapsed times to assess balance.
4. The existing required final gates context always reports. It explicitly rejects a selected job that failed, was cancelled, was skipped, or is absent. It verifies the current PR head/base/draft policy against the original event and its checkout against the exact workflow SHA, then runs schema and live integrity verification. Draft and exact-tree attestation omissions are explained separately from failures.

All checkouts explicitly use the workflow SHA. Tests receive no mutable production/test-database credentials from the workflow. Separate runners isolate files, ports and fixtures; local mutating generator tests retain their common tree lock. No test result, build output or mutable integrity receipt is restored from a cache. pnpm caches are content stores keyed by OS/architecture/Node major/lockfile; Next caches are incremental compiler caches separated by mode, lockfile and build configuration; Playwright caches are keyed by OS/architecture/lockfile and the executable is still asserted after installation.

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

Sources: [runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing), [job retries retain the original SHA/ref](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs), [merge queue availability](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request-with-a-merge-queue).

Rollback is a normal reviewed revert of this CI change, retaining the same required status names. No repository setting needs rollback. Do not remove failed-run diagnostics or rewrite proof receipts to get green.
