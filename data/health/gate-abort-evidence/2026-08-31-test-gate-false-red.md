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

---

## A second finding, from running seven lanes at once

**The gate-record numbering scheme collides under parallel execution.**

`data/ops/gate-runs/` names records `<date>-<n>.json`, where `n` is the next
free number *in the working tree that allocates it*. Four branches ran gates
independently tonight and three of them allocated the same numbers:

```
claude/sc2-governance   42, 43, 44
claude/sc2-parta        42
claude/sc2-tracker      42, 43, 44
claude/sc2-nh           none — this lane saw the collision coming and
                        deliberately left its record uncommitted
```

Same filenames, different trees, different results. Every one is a truthful
record of the tree it was taken on, and merging any two of them produces a
conflict on a file whose whole purpose is to be an unambiguous record.

This is not a defect in any lane. It is a **sequence allocated from local
state under an execution model the repository now mandates** — RULING 190 and
RULING 191 make safe parallel execution the DEFAULT, and a scheme that assumes
one writer was correct only while that assumption held.

The integration owner resolves it by renumbering on merge, deterministically
and in merge order, so no record is lost and none is silently overwritten.
That works and it does not scale: it is manual, and it puts the burden on the
one reader who has to notice.

**The durable fix is to make the identifier not require agreement** — derive it
from the tested SHA plus the run's start instant, which two branches cannot
collide on because they are not the same tree and not the same moment. Recorded
here rather than fixed, because the naming scheme is a shared store and this
session has seven lanes writing to it; changing it mid-flight is the thing the
integration rule exists to refuse.
