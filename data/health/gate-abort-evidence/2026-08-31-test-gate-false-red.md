# The test gate can report a false RED, and it aborts rather than failing

*Recorded 2026-08-31 by the Session C resume, integration owner. This is
EVIDENCE, not a ruling. It exists so the next session that sees `test FAIL`
with no attributable failing test does not spend an hour looking for one.*

## What was measured

One tree: `main` at `ac3cfced` plus this session's governance adoption.
One machine. One command — `gates.mjs:174` invokes the literal string
`pnpm test`, byte-identical to `package.json:294`. Three runs:

| run | invocation | result | wall clock |
| --- | --- | --- | --- |
| `data/ops/gate-runs/2026-08-31-42.json` | `pnpm gates` | **test FAIL** | 59s |
| standalone | `pnpm test` | **PASS** — tests 4274, suites 26, pass 4274, fail 0, cancelled 0, skipped 0 | 75s |
| `data/ops/gate-runs/2026-08-31-43.json` | `pnpm gates` | **test PASS**, 14 of 14 green | 65s |

Same command, same tree, minutes apart, opposite results.

## The discriminating fact

**The failing run was FASTER than a complete run.** 59s against a 75s
full pass. A suite that fails an assertion still runs to the end and
reports `fail N`; this one never reached the summary. So the gate did not
observe a failing test — **it observed a process that stopped**.

That single fact explains the whole history of this incident. Every prior
session that saw `test FAIL` went looking for a named failing test, found
none, and concluded *flaky*. There was never a failing test to find. The
search was looking for the wrong object.

## What the earlier flake-probe does and does not establish

`data/health/flake-probe/2026-08-31T15-11-34-552Z.json` records 6 runs,
**4170 pass**, 0 fail, 0 context rewrites, verdict `NOT_REPRODUCED`.

The measurement above records **4274 pass** on the same suite.

**+104 tests.** The probe therefore cleared a tree roughly ten hours older
than `18d1f808`, which is the tree gate record 41 — the committed close-out
record showing `test FAIL` — was actually taken on. The probe is genuine
corroborating evidence that the suite is healthy in general. It is **not** a
clearance of the tree the close-out claimed 14/14 on, and it may not be
cited as one.

## The standing correction

```
test FAIL with no attributable failing test
    -> DO NOT record it as a real failure
    -> DO NOT record it as green either
    -> RE-RUN THE GATE ISOLATED, and record the isolated result
```

A FAIL in under the suite's own full-pass duration is an abort, and an
abort is a fact about the host, not about the tree. Concurrent load on this
machine — parallel worktrees each running `pnpm install`, `pnpm build` and
`pnpm test` — is the load condition under which records 37, 41 and 42 were
taken; records 38, 39, 40 and 43, interleaved between them at nearly the
same SHAs, passed.

Load is the hypothesis with the evidence behind it. It is stated as a
hypothesis and not as a finding, because what is PROVEN here is narrower and
is enough on its own: **the gate can report FAIL on a tree whose suite
passes, and it does so by aborting early.**
