# The nightly research window

`pnpm window:run` enters the validated installed-runtime dispatcher and then
runs a research/control-plane evidence window. It is not a
routine civic-data clock, acquisition path, promotion door, release path, or
Reader fallback.

The standing production runner owns routine civic-data cadence through the
typed contracts in `lib/civic-data/contracts.ts`. Validated candidates promote
atomically in the production civic-data store. No nightly-window action writes
tracked Reader data, invokes Git, runs a software build or deploy, or verifies a
data update through a staging site.

## What the window still does

The local runner invokes the window at the 04:00 America/New_York boundary and
catches up a missed window at its next healthy poll. It is the only scheduled
clock for this operation. An explicit owner may request `--wakeup`; that is an
interactive command, not a second installed clock. One compare-and-set lease
prevents overlap. The window:

1. maps existing research evidence into the append-only research pipeline;
2. evaluates each item against the closed research activation record;
3. records research progression, refusals, incidents, and a digest; and
4. writes canonical outcomes to the control-plane database, plus an optional
   ignored host diagnostic and configured mirror digest.

Evaluation labels such as `PROMOTE_WOULD` are historical research-pipeline
vocabulary. The executable window records them for review but has no callback
that can materialize Reader data.

The former isolated refresh worktree invocation, its decoder, its promotion
callback, its Git revert planner, and the staging observer invocation were
deleted in the permanent civic-data-plane cutover. Historical evidence remains
historical data; none of its transition schema is executable or rendered by
the current window.
GitHub Actions is not a backup wakeup for this window or a freshness surface
for routine civic data.

## Commands

```bash
pnpm window:run --shadow
pnpm window:run --shadow --force
pnpm window:run --wakeup
pnpm window:readback
pnpm pipeline:map
```

The package command first proves the live stable launcher, clean detached
installed checkout, exact running parent, deployed SHA, post-deploy receipt,
and full required-check certification. It cannot impersonate the runner's
`RUNNER_CLOCK` or `CATCH_UP` trigger. For a standalone local proof, invoke the
script directly with `--provider=file`; that uses the ignored repository under
`.runtime/control-plane/freshness-shadow/` and has no production capability.
The `--skip-legacy` and `--skip-verify` options no longer exist because those
executable stages no longer exist.

## Failure semantics

A failed research stage appends a typed incident and produces a non-zero exit.
The next local window names missed research dates in `caughtUp`. A missing or
unreachable control-plane store never becomes a clean or empty result.
