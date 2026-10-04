# Common instructions — corrected launch edition

Read this file and your lane brief from `board/briefs` every run. The approved implementation plan belongs at `plan/plan.md`; the approved design belongs at `plan/design.md`. Eleven logical build lanes own 314 steps; River owns RL-01 through RL-07, for 321 total. Preserve the whole scope. The goal is built, deployed and working within 36 hours of the recorded launch, with genuinely time-dependent proof reported separately. This is a target, not a claim that every step takes an hour.

These documents prepare execution. They do not themselves authorize creating tasks, spending money, deploying, starting a hunt, or changing policy. After Sean authorizes launch, carry out the authorized work without asking him to decide routine implementation details. Existing approvals remain valid.

## Workers and automatic continuation

Start six Claude build tasks plus River on an hourly cloud schedule. Initially start five Codex tasks as well. A lane is a body of work, not a session; a fresh session can continue its saved branch.

| Scheduled Claude worker | Primary lane | Codex lane it continues when assigned |
|---|---|---|
| measures | measures | admin |
| hunters | hunters | slide |
| registry | registry | bank |
| meetings | meetings | ballot |
| auditors | auditors | frontend |
| people | people | None initially |

A stopped Codex task must not become Sean's routine restart job. If a verified cloud restart mechanism exists, River may use it within the launch authorization. Otherwise River assigns the unfinished lane to its paired existing Claude worker on `board/river`. This uses the same seven scheduled tasks, not five additional subscriptions or tasks. The paired worker alternates ready batches between its assigned lanes, prioritizing returned failures and work that unblocks other lanes. Never starve either lane. An hourly run checks both assignments even if its primary lane is complete.

This fallback preserves continuation, but may reduce parallel work and move usage to Claude. Report the resulting pace and usage limitation honestly. If the scheduler, branch access, or provider allowance prevents continuation, report a real block; do not describe the system as unattended while relying on Sean to restart it.

River must record a single active provider/worker assignment per lane. A Codex run that resumes after reassignment reads that record and exits without writing. Handoffs use the lock rules below. Up to two overflow workers are permitted only if included in Sean's launch authorization and existing spending limits; they are not an automatic budget increase.

## Standing rules

- Sean's standing decisions are `docs/rulings.md` on `main`. They win over everything else. Read §0, §3, §5, §6 and §10 at the start of every run.
- Follow Sean's actual adopted decisions. These briefs do not adopt additional policy proposals or override his spending controls or hunt pauses. D7 remains parked: build nothing for SC-17 until Sean decides it; continue everything else. Do not reopen settled decisions.
- **Nothing built for one place.** Never target, name or prepare a particular ZIP, county, city or state.
- **No new gates, approvals or proof steps** beyond what a step says.
- **Plain English in Admin.** No code names, error codes or IDs on any Admin screen. Detail goes behind "Technical details". A number we don't have shows "—". Admin shows Eastern time.
- **Reader copy:** an uncovered section says "We're working on getting this info". Sources only in a card's Sources section.
- **Runner changes keep a way back:** the old path stays behind a switch until the new path is checked live.
- **Stay on your steps.** A bug or cleanup outside your steps goes in one line under "Seen, not fixed" in your status file. Don't chase it unless it blocks one of your steps.

## Model choice and usage

Each lane brief and start prompt names its recommended starting model. These are task-based recommendations, not repository benchmarks or a guarantee of subscription capacity. Use Sean's existing subscriptions and allowed models; this does not authorize new API spending. GPT Sol 6.1 is OpenAI's GPT-6.1 Sol; GPT Astra 6 is GPT-6 Astra.

For Codex, start Sol 6.1 at medium reasoning and Astra 6 at high reasoning if the task settings expose those choices. For Claude, use the selected model's normal/adaptive reasoning setting; do not force maximum effort for routine work. Use more reasoning for a specific difficult problem, not automatically for every step.

Escalate Sonnet 5.5 to Opus 5.5, or Sol 6.1 to Astra 6, when a substantive unresolved failure or a broad design decision makes repeated cheaper attempts wasteful. Send the smallest useful problem, relevant code and failed evidence. Return to the normal model for routine implementation. Do not escalate credential errors, missing dependencies, waiting on another lane or a known mechanical text correction. If model switching/delegation is unavailable, River can investigate with its existing Opus session; preserve current work and do not assume a prompt can change the running model.

A Claude worker continuing a Codex lane uses its own configured Claude model. Model availability and allowance must be confirmed in the actual account; state an unavailable choice rather than silently enabling new paid services. Use observed successful progress and usage to adjust this starting allocation within the authorization.

## Branches and permissions

- `board/briefs`: the plan, design, briefs and start prompts. Builders read it. The launch session and River may update execution instructions and assignments; neither may silently change approved scope or policy.
- `board/river`: River's `status.md`, worker assignments, priorities, `returns/<lane>.md`, release records and its own lock. Only River writes it.
- `river`: combined, tested application work. Only River updates it.
- `stream/<lane>`: the lane's work and `.factory/<lane>.md`. Only the currently assigned worker holding that lane's lock writes it. A paired Claude worker may write the Codex lane's branch only after the recorded handoff.
- River may also write `stream/river`, `stream/salvage-*`, `river-next` and `release/*` for the duties in its brief. These are explicit exceptions to the builder restrictions.
- No worker pushes directly to `main`. Release PRs are River's responsibility.

Prefer branch pushes without PRs. The inspected repository filters avoid its main CI jobs on ordinary work-branch pushes; confirm actual GitHub workflows and Netlify account settings at startup. Do not promise that every push is cost-free on every service.

Codex has one explicit PR exception: if branch publication requires a PR, maintain one **draft** from its stream into `river`. Keep it draft; do not request reviews or enable auto-merge. Confirm draft jobs are skipped in the current workflows. River reads the branch and closes the draft when its work is integrated; it does not merge that PR. Other builders open no PRs. A draft workflow entry can exist even when runner jobs are skipped.

## Startup and each run

1. Use the repository and cloud credentials actually available in this environment. Do not assume tools called `add_repo`, `list_triggers` or `fire_trigger` exist. Use a supported equivalent and record missing capabilities precisely. Never print credentials.
2. Fetch `main` and `board/briefs` into explicit remote-tracking refs. For example:
   ```sh
   git fetch origin refs/heads/main:refs/remotes/origin/main refs/heads/board/briefs:refs/remotes/origin/board/briefs
   git show origin/board/briefs:briefs/common.md
   ```
   Discover whether `river`, `board/river` and your stream exist before fetching each with the same explicit source:destination form. A missing optional branch on the first run is normal. Do not put nonexistent refs in a mandatory fetch, and do not assume a fetch into FETCH_HEAD created `origin/<branch>`. Deepen history when the merge base is missing.
3. Read River's assignment and returns. River creates the integration and assignment branches before releasing builders to work. If they are absent, do useful read-only preparation and let the next scheduled run continue; do not invent an assignment. Create your stream from current `river` when first assigned. An existing stream is resumed, never overwritten.
4. Claim your assigned lane. `.factory/<lane>.md` records `worker`, `provider`, `run_id`, `lock`, `heartbeat` and a unique ownership token. Read the current remote tip and acquire the lock by a normal fast-forward commit and push. A rejected push means refetch and reassess; never force-push. A live other owner is not yours to replace. Refresh the heartbeat at least every 15 minutes, including during long commands, using a background/helper process if needed. A heartbeat younger than 45 minutes prevents takeover. River checks provider run state when available before treating an expired heartbeat as stopped. A resumed stale owner must stop before writing. Recheck remote ownership before every work/status push; if ownership changed, preserve local work for recovery and exit without rebasing it over the new owner.
5. Catch up with `river`, preserving your own `.factory` status while resolving coordination-file deletions from integration. Never resurrect another lane's status or overwrite application conflicts blindly. Fix returned failures first. Select the first ready step from your lane, honoring the full plan's dependencies and River's priorities. Ready means cross-lane prerequisites are integrated, not merely claimed complete by another session.
6. Read the step's full text and existing implementation. Build only missing work. Use the existing tests and add tests where needed to establish the step's acceptance condition. Save unfinished work as `WIP` checkpoints so a stopped session loses as little as possible; WIP is not ready for integration.
7. Run focused checks in the cloud session, not by opening repeated release PRs. Install dependencies once per environment as needed. Run lint/types and the repository's affected-test selector against your stream's merge base with `river`. `CI_TEST_FILES` must contain the selector's actual newline-separated test paths; it is not a literal placeholder. For an affected selection, run those tests with `pnpm test`. For FULL, run the full test command once per ready batch. For NONE, record that no test files were selected and still complete the other applicable checks; do not run an empty selection and call it passing. Do not label an unchecked FULL batch ready.
8. Publish a `READY: <step ids>` commit only after its checks pass. Include the exact ready commit SHA and check evidence in status. Push immediately when another lane needs it. River integrates only through that ready commit, never later WIP. Keep going through ready steps; at a safe checkpoint release your lock when ending or moving between assigned lanes.
9. When waiting, save dependencies and release the lock. The next scheduled worker run or assigned continuation resumes from GitHub. Do not ask Sean to send "keep going". All non-parked steps integrated means `BUILD COMPLETE`, not production complete. Measures reports `BUILD COMPLETE — SC-17 PARKED`. River owns deployed/live verification status.

## Lane status

Keep this concise in `.factory/<lane>.md`:

```text
build_state: active | waiting | BUILD COMPLETE | BUILD COMPLETE — SC-17 PARKED
worker: <assigned worker>
provider: <Claude or Codex>
run_id: <current run>
lock: <unique ownership token or none>
heartbeat: <UTC timestamp>
on_river: <step ids and integration SHAs>
ready: <step ids and exact ready commit SHA>
checks: <commands, result and tested SHA; skipped means skipped>
working_on: <step and checkpoint>
waiting_on: <specific prerequisite and owner>
returned: <failure and repair status>
needs_hook: <shared file, function and requested connection>
needs_Sean: <only a real owner decision or credential dependency>
seen_not_fixed: <out-of-scope observations>
runs_and_working_minutes: <measured totals; unknown if unavailable>
```

## Shared files, migrations and handoffs

Keep logic in separate files where possible. If another lane owns a shared file, request its connecting change through River instead of editing it concurrently. Ownership is attached to the logical lane even when its provider changes.

New migrations may start with step-ID names. River assigns final numbers, updates the journal and coordinates shared schema edits **before** integration tests. Apply migrations through the authorized deployment/migration path; a committed SQL file is not proof that production has applied it. Developer tests use isolated development data. Production inspection credentials remain read-only; necessary product data changes use the system's authorized paths and retain before/after evidence.

River excludes `.factory/` from the released application tree, but preserves the source stream and its status. Its integration records retain source ready SHAs so the same batch is not repeatedly folded. A worker restores its own current coordination file when catching up with an integration that excluded it.

| Shared file | Owner lane |
|---|---|
| `scripts/freshness-shadow.mts`, `scripts/pilot-runner.mts`, `lib/ops/runtime-release-handoff.ts` | hunters |
| `lib/doors/registry.ts` | registry |
| `scripts/ingest.ts`, `lib/civic-data/runner.ts` | meetings |
| `lib/control-plane/gateway/registry.ts`, `lib/control-plane/settings.ts`, `lib/control-plane/fix-list.ts` | admin |
| `lib/control-plane/promotion/section3.ts`, `lib/civic-data/worker-publication-evidence.ts`, `lib/control-plane/workers/standing-runtime.ts`, `lib/civic-data/worker-publication-tasks.ts` | slide |
| `lib/coverage/place-owed.ts`, `lib/civic-data/held-place-capture.ts` | measures |
| `lib/control-plane/workers/detective.ts` | auditors |
| `lib/control-plane/field-manual.ts` | bank |
| The shared reader Card and design tokens (FE-07, FE-10) | frontend |
| `lib/ask/`, `app/api/ask/` | ballot |
| The database schema and migration numbers, `.github/workflows/`, `scripts/ci-*`, `scripts/river.mjs` | river |

Agreed exceptions: auditors' DP-01 edits `scripts/freshness-shadow.mts` near lines 589–600 and DP-02 near line 995, nothing else in that file.
