# repo-ops P1 burn-down — 2026-08-25, part2-0825

Branch: `claude/part2-0825`. Evidence read from GitHub, not from the working tree
(RULING 75 part 2 — only the server knows what happened to a commit after it landed).

## `RO04` — main is RED on two react-hooks/set-state-in-effect lint errors

**Condition: `main` green. It holds.**

- `corepack pnpm main:green` at session open: `main 706c934: GREEN — 3 check(s) passed`.
- `repos/SeanJ22/We-The-People/commits/706c934.../check-runs` returns
  `build (default) :: success`, `build (standalone) :: success`,
  `gates (test · lint · tsc) :: success`.
- The gates job (run `32926120881`) step **12. Lint :: success** — the exact gate
  RO04 named as failing.

## `NH106` — the CI runner installs no Chromium at all

**Reproduced-gone at CI, on Linux, on the current tip.**

NH106's four failures were all `NO CHROMIUM INSTALLED. Wanted build 1234; searched
/home/runner/.cache/ms-playwright` — three in `tests/beacon-guard.test.ts`, one in
`tests/chromium-pin.test.ts`. The cause was `lib/ops/chromium-pin.ts` resolving the
legacy `chrome-linux/chrome` while Chrome for Testing writes `chrome-linux64/chrome`.

Gates job steps at `706c934` (run `32926120881`), read from
`actions/runs/32926120881/jobs`:

```
  9. Install the browser the suite needs      :: success
 10. Prove the browser is actually there      :: success
 11. Test                                     :: success
 12. Lint                                     :: success
 13. Types (fresh checkout, no build)         :: success
```

Step 10 is `pnpm run assert:browser`, which RULING 113 gave **no skip flag** — it
lists the browsers root and every build directory in it, compares our resolution
against Playwright's own `executablePath()`, and exits non-zero on either an
absence or a disagreement. It passed on the runner, and the suite that carried the
four failures then passed on the same runner. That is the defect observed absent
at the place it lived, not inferred from a green aggregate.

## Still open, and why — stated rather than demoted

- **`NH170`** — three of its four defects were fixed in final-pass-0825; the row
  exists so the fourth is not lost, and the fourth is not addressed here. The
  daily refresh is separately red right now under `R59`, which is out of this
  session's scope by its brief.
- **`NH176`** — `walk:all` failing a different single check on each of four
  consecutive runs against an unchanged tree. Not touched this session; no
  evidence exists that it has stopped.
- **`JOB03`** — RULING 151 records it as diagnosed the day it was rerouted, but
  the row carries no diagnosis and none was found in `docs/rulings.md`,
  `docs/state.md` or the row's Notes. Closing it on a ruling that asserts a
  diagnosis nobody wrote down would be closing it on nothing.

**No row was demoted to get under the RULING 30 cap.** repo-ops P1: 5 → 3.
