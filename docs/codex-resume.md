# Resuming Meanwhile under Codex (or any coding agent)

*Written 2026-09-02 for the provider transition. This file is a POINTER, not a
state snapshot: it names the commands that print the current state, so it cannot
go stale the way a copied number would. `AGENTS.md` mirrors `CLAUDE.md` and is
what you should read first; this is the shortest path into the machinery.*

## The authority, in one sentence

`docs/governance/ledger.jsonl` is the canonical law. `CLAUDE.md` is the root
constitution generated-mirrored into `AGENTS.md`. Delegated policy lives in
`docs/governance/policies/`. When two disagree, the lower-numbered wins:
ledger > CLAUDE.md/AGENTS.md > delegated policy (RULING 185). `AGENTS.md` is a
mirror and never an authority.

## First commands, in order

```bash
pnpm install --frozen-lockfile                 # a fresh clone / worktree has no node_modules
git config core.hooksPath .githooks            # if `git config core.hooksPath` prints empty
pnpm session:start --check                     # stale main, CLAUDE.md intact, port 3000, hooks
git fetch origin && git rev-parse origin/main  # the exact current main SHA
pnpm governance:open --task <domain>           # current authority + policy + decisions + snapshot
pnpm workstream:status                         # canonical work state + the EXACT resume cursor
pnpm tracker:open                              # open rows, Needs Sean, the author's own notes
pnpm stamp                                     # the only source of a date you write
```

`<domain>` is one of: discovery, rendering-neutrality, data-privacy,
sources-licensing, shipping-ci, tracker-workflow, visual-feedback, business,
meta-governance.

## What each question resolves to

| You need | Command |
| --- | --- |
| current authority & governance | `pnpm governance:open --task <domain>` |
| relevant task policy | the same command prints `docs/governance/policies/<domain>.md` to read |
| exact current main SHA | `git rev-parse origin/main` |
| workstream / session resume state | `pnpm workstream:status` (cursor + open streams) |
| active acceptance denominator | the session directive; the SESSION EFFICIENCY LAW (`docs/governance/session-efficiency.md`) turns it into the finite table |
| unresolved Needs Sean / carried items | `pnpm tracker:open` and `docs/frontier.md` |
| shipping law | `pnpm governance:open --task shipping-ci` (RULING 1, RULING 155, RULING 233) |
| required gates | `pnpm gates` (the fourteen CI gates, each named) |
| how to close out and hand off | `pnpm handoff --check` (report), then `pnpm handoff --ship` (the only path that merges) |

## Rules that will bite you if you skip them

- **Never print, hash, or copy a secret value.** `.env.local` (gitignored) is
  read only by NAME; a process gets a value via `node --env-file=.env.local …`.
  A worktree has no `.env.local` until you copy it there (same machine only).
- **A worktree has no `node_modules`** — run `pnpm install --frozen-lockfile`
  first, or every check reports a false failure.
- **The standing runner writes into the main checkout** between hourly cycles
  (`data/method/candidates.json`, the staging manifest). After a merge,
  reconcile its dirty data files by union — never discard them — and run any
  manual cycle only when no `freshness-shadow.mts` child is alive.
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
