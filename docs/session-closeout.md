# Session workspace closeout

This is the operating procedure for RULING 291 in the current shipping policy,
for both Claude Code and Codex. It extends the existing session-start/handoff
bookends; it is not another source of project law.

## Open one workspace

Read `docs/rulings.md`, `CLAUDE.md` (or its generated `AGENTS.md` mirror) and the
existing workstream cursor first. From a stable checkout, use:

```text
node scripts/session-workspace.mjs start <absolute-path-to-start-config.json>
```

The existing `pnpm session:start --workspace <config.json>` bookend routes to
the same operation without starting a preview or running main-checkout repairs.

The config names `repo` (main checkout), `home` (the established
`C:/Users/seanj/dev/meanwhile-worktrees`), a hyphenated `name`, a `codex/`,
`claude/` or `ws/` task `branch`, `owner` (visible task name and session ID),
`purpose`, `base`, `dependencies` and optional existing orchestration `plan`.
Each dependency records `resource`, `reason` and `state` (`active` or `released`).
Refresh the intended base first through normal Git reads. The command creates
exactly one new Git worktree and records its resources in the shared Git
directory's `session-handoffs/<name>.json`. This is local execution metadata,
linked to the existing orchestration plan when present, not another work queue.
It never adopts an unrelated existing folder or changes the main checkout.

The result gives an **external helper path**. Keep it: that versioned copy
survives removal of the task checkout. Put subsequent process IDs and shared
dependencies in the handoff while they are known; record process creation time,
purpose and supported stop procedure alongside the ID. A PID alone is not
authority to terminate a process. Existing active sessions are not silently
enrolled or released by installing this tool.

Keep temporary scripts, previews, logs and evidence staging in that workspace
(normally `.scratch`). Do not scatter them across `dev`. Reusable scripts and
docs go through the normal repository PR. Product images belong in the existing
asset repository/cache and application paths; internal proof images belong in
the established evidence home, retaining provenance and references. Learned
source knowledge uses the existing field-manual/import/dispatch and memory
paths. Neither importing knowledge nor writing a handoff releases its source.

## Finish delivery, then leave the workspace

1. Complete the authorized implementation, checks, normal PR/merge and required
   deployment verification. Do not copy code over a different checkout to ship it.
2. Consolidate useful material into its established permanent home. Update and
   verify actual consumers, including dynamically constructed paths. Preserve
   historical proof bytes and hashes; do not rewrite history into a new claim.
3. Inspect tracked, untracked **and ignored** content. Commit useful tracked
   changes. Classify each nontracked file explicitly as `preserved` or
   `disposable`, with its exact hash and use-based reason. Preserved files need
   an external `copy: {path, sha256}` and verified `recoveryCopy` in the configured
   recovery set; disposable files need `noConsumers: true`.
   Credentials must be securely preserved, never classified as disposable.
   No whole-worktree archive is the default. Refresh changed recovery content
   and verify the configured recovery volume before removing originals.
4. Stop only this session's temporary processes through their supported controls.
   Close its file/report references after saving useful buffers. Resolve links
   through their owning package/application tools. The helper refuses links and
   live recorded PIDs; it does not kill processes, close apps or follow links.
5. Leave the worktree in the agent, terminal and tools. Run the external helper
   from a stable directory (for example `dev`). An app which cannot detach from
   the checkout is a specific blocking dependency, not permission to force it.

## Check and remove automatically

From the stable directory:

```text
node <external-helper> prepare <absolute-handoff.json>
node <external-helper> check <absolute-closeout-plan.json>
node <external-helper> close <absolute-closeout-plan.json>
```

Save the `prepare` JSON outside the worktree and finish its explicit resource
classification. This inventory includes every ignored regular file and refuses
unresolved links. Each receipt below is an external file referenced as
`{path, sha256}`; no credential contents belong in a plan or receipt.

| Receipt | Required observations |
| --- | --- |
| `release` | Exact `root`, registered `owner`, `released: true`; reuse a valid earlier release. |
| `dependencyReview` | Exact `root`, frozen `head`, `reviewedAt`, and verified `noActiveConsumers`, `noUnsavedBuffers`, `noUnregisteredProcesses`, `noBranchConsumers`. Record how actual process/CWD, task, app, static and dynamic consumer checks established these facts. Unknown is not true. |
| `delivery` | Frozen `head`, `requiredChecksPassed`, `deploymentVerified`, and linked `evidence` for actual check/merge/deploy results within task scope. A task with no deployment records why it is inapplicable. |
| `recovery` | Frozen `head`, `verifiedAt` equal to the current review, `volumeVerified`, hash-bound `gitBundle` retaining that exact head (verified through Git), and `protectedFiles` (`path`, `sha256`) covering applicable credentials/instructions/knowledge/runtime references. Record changed-file recovery evidence. |

The plan also lists remaining `dependencies` (each must be released with
`evidence`), all registered `processes`, classified nontracked `files`, and
external hash-bound permanent `deliverables`. Review evidence expires after
30 minutes; refresh observations, not completed historical acceptance tests.

`close` repeats preflight and then actually removes the checkout through Git
without `--force`, deletes its eligible exact remote branch with an expected-tip
lease, and compare-and-deletes its exact local task ref. It reuses the existing
branch-retirement classifier: ancestry, a no-op content merge, or a merged PR
whose exact head matches and whose merge is in main can prove preservation.
This handles squash/rebase shipping without pretending ancestry always holds.
Open PRs, a different remote tip, another checkout, missing checks, unique files
or active dependencies refuse removal. Main, owner/shared branches, unfinished
work and ambiguous preservation remain protected. The older broad branch
inventory stays read-only; this command only acts on its registered task branch.

A journal outside the target records completion or the exact partial failure.
If Git leaves residue, the branch remains and the helper stops; it does not
recursively force-remove residue. Remote/permission failures are reported, not
bypassed. Never claim the workspace gone until the final verification succeeds.

## What is automatic, and what is not

The external `close` command performs the destructive closeout and verifies its
result. It is not a release-note generator or a periodic cleanup sweep. Agents
must invoke it as the last bookend after leaving their checkout. The existing
`handoff` reports delivery, and must not be mistaken for physical closeout.

No supported cross-provider hook can observe every Claude/Codex task ending,
save arbitrary unsaved buffers or discover every dynamically constructed external
reference. Those observations remain the session's responsibility, recorded in
the review receipts; a boolean alone is not evidence. There is **no claim of
universal background enforcement**. If the agent cannot leave its workspace,
app permission is unavailable, an owner/dependency is unresolved or automatic
approval rejects the action, report **implementation complete; cleanup blocked**
and name the dependency. Do not create an indefinite generic cleanup task.

Report delivery and verified physical cleanup together. Preserve unrelated
changes, runtime, credentials, governance and learned-knowledge connections.
