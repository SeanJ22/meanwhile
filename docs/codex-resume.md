# Resuming Meanwhile under Codex (or any coding agent)

This is the coding-agent companion to the [starting guide](../README.md).
Use that guide for setup, current Windows folders and live-status links.
This page keeps the agent-specific resume and provider details in one place.

## The authority, in one sentence

Read [Sean's standing decisions](rulings.md) first — the single source for owner
policy — then the working guide [CLAUDE.md](../CLAUDE.md), which `AGENTS.md`
mirrors for Codex; neither is a separate version of those decisions. The
governance ledger and its generated views, including the
[historical ruling index](governance/rulings-index.md), are historical evidence:
use them to understand older comments or session notes, not as active instructions.

## First commands, in order

Create and register your named workspace using the
[session workspace bookend](session-closeout.md) before starting new work.
Keep the returned external helper path for physical closeout. Existing active
workspaces stay protected until their own dependencies are resolved.

```bash
pnpm session:start --check                     # stale main, CLAUDE.md intact, port 3000, hooks
git fetch origin && git rev-parse origin/main  # the exact current main SHA
pnpm governance:open --task <domain>           # authority pointers + ledger views (historical) + work state
pnpm workstream:status                         # canonical work state + the EXACT resume cursor
pnpm tracker:open                              # open rows, Needs Sean, the author's own notes
pnpm stamp                                     # the only source of a date you write
```

Install dependencies using the [starting guide](../README.md#getting-started)
first. Inspect hook configuration with `git config core.hooksPath`; coordinate
any correction because worktrees can share Git configuration. The session-start
check can stop a preview it attributes to this repository: check ownership
before using it alongside another session.

`<domain>` is one of: discovery, rendering-neutrality, data-privacy,
sources-licensing, shipping-ci, tracker-workflow, visual-feedback, business,
meta-governance.

## What each question resolves to

| You need | Command |
| --- | --- |
| standing decisions | [`docs/rulings.md`](rulings.md), applied by `CLAUDE.md` / `AGENTS.md` |
| earlier ledger rulings for a domain (historical evidence) | `pnpm governance:open --task <domain>` |
| exact current main SHA | `git rev-parse origin/main` |
| workstream / session resume state | `pnpm workstream:status` (cursor + open streams) |
| active acceptance denominator | the session directive |
| unresolved Needs Sean / carried items | `pnpm tracker:open` and `docs/frontier.md` |
| how work ships | `docs/rulings.md` §5–6 and §9, then the gates and handoff commands below |
| required gates | `pnpm gates` and the exact checks required by the current CI workflow |
| how to close out and hand off | `pnpm handoff --check` (report), then `pnpm handoff --ship` (the only path that merges) |

## Rules that will bite you if you skip them

- **Keep credentials private.** Follow the current
  [sources and secrets policy](governance/policies/sources-licensing.md) and the
  owner's explicit directions. The [starting guide](../README.md#getting-started)
  identifies the runner's current environment-file dependency. Do not print,
  commit or upload secret contents.
- **Use the assigned checkout.** New worktrees need their own dependency
  installation. The clean production runner is separate from the main checkout;
  its runtime data is not something to reconcile into Git after a merge.
  Runtime operations must use the supported installed-runner path and current
  [shipping policy](governance/policies/shipping-ci.md). Old bare manual-cycle
  recipes are not authorization to bypass runtime authority checks.
- **`pnpm handoff` never commits for you** and refuses a dirty tree under
  `--ship`. Commit your work first with a message that says why.
- **The Drive mirror** at `G:\My Drive\we-the-people` is a synced folder, not an
  API; `pnpm handoff` copies the standing documents there and records the exact
  SHA in `git-state.txt`. `.env.local` is never mirrored.

## Provider-specific steps that degrade harmlessly under Codex

- `pnpm handoff`'s transcript export shells to `~/.claude/export-transcript.mjs`;
  absent under Codex it warns and the run continues.
- `pnpm secrets:sweep --transcripts` scans a Claude transcript path; under Codex
  it is `NOT PRESENT` and skipped. The repo and mirror are still swept by value.

Neither fails the run. Everything else is provider-neutral.
