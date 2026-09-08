# Reader #303 before/after performance evidence

Measured 2026-09-08 on Windows with Node 24.19.0, Next.js 16.3.0,
Playwright 1.62.1, and Playwright Chromium headless.

## Compared revisions

- Before: `87f79722ac627839330b2fe9c0485c83339a10f9`
- After: `b19e638b1fb5dab543e965c6acbe6293638962dd`
- The measurement instruments were byte-identical between revisions:
  `scripts/measure-load.mts`, `scripts/measure-fly.mts`, and
  `scripts/browser.mts`.

Both revisions were clean detached local clones using the same existing
`node_modules` tree. No dependency install, database URL, production mutation,
or source workaround was involved.

## Protocol

- Built both revisions with matching Next production webpack `compile` and
  `generate` modes, then served them on separate localhost ports.
- Gave both servers the same warm-up, then measured sequentially in
  `A1 -> B1 -> B2 -> A2` order.
- Used five cold runs for each desktop/phone x ballot/map combination in each
  arm: 10 samples per revision and surface, 80 load samples total.
- Used three cold desktop-dark map fly runs in each arm: six samples per
  revision, 12 fly samples total.
- Created a fresh browser context per load run; HTTP cache was disabled for
  fly runs. No CPU or network throttling was applied.

## Load results

Arm-level medians from the unchanged repository instrument:

| Arm | Desktop ballot interactive | Desktop map first marker | Phone ballot interactive | Phone map first marker |
| --- | ---: | ---: | ---: | ---: |
| Before A1 | 180 ms | 750 ms | 150 ms | 510 ms |
| After B1 | 170 ms | 820 ms | 180 ms | 540 ms |
| After B2 | 140 ms | 930 ms | 180 ms | 590 ms |
| Before A2 | 170 ms | 1,400 ms | 210 ms | 650 ms |

Pooled conventional medians across 10 cold samples per revision and surface:

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Desktop ballot interactive | 175 ms | 160 ms | -15 ms (-8.6%) |
| Desktop map first marker | 905 ms | 830 ms | -75 ms (-8.3%) |
| Phone ballot interactive | 175 ms | 180 ms | +5 ms (+2.9%) |
| Phone map first marker | 575 ms | 545 ms | -30 ms (-5.2%) |

All 80 load samples reached their target. Every arm median passed the
repository's 2.5-second ballot and 3.0-second map budgets.

## Fly results

| Arm | FCP median | LCP median | Map-ready median | Worst frame | Frames over 32 ms in worst run |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before A1 | 140 ms | 300 ms | 269 ms | 30.6 ms | 0 |
| After B1 | 112 ms | 264 ms | 233 ms | 29.0 ms | 0 |
| After B2 | 116 ms | 252 ms | 225 ms | 33.3 ms | 1 |
| Before A2 | 132 ms | 296 ms | 265 ms | 55.8 ms | 1 |

Pooled conventional medians across six cold samples per revision:

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| First contentful paint | 136 ms | 114 ms | -22 ms (-16.2%) |
| Largest contentful paint | 298 ms | 258 ms | -40 ms (-13.4%) |
| Map ready | 268.5 ms | 229 ms | -39.5 ms (-14.7%) |

The median per-run fly frame remained approximately 16.7 ms. The maximum
observed frame changed from 55.8 ms to 33.3 ms, but maxima are noisy and the
repository has no fly-frame budget. Each revision recorded one frame over
32 ms across six runs. FCP passed its 3.0-second budget in every arm.

## Limitations and build notes

- These are local, unthrottled, relative measurements on one machine. The
  5 ms phone-ballot change and other small deltas are within ordinary run
  noise and should not be generalized as population latency.
- A normal Turbopack build cannot follow the intentionally external
  `node_modules` junction used by the disposable clones, so webpack was used
  identically for both revisions.
- The canonical base's ordinary single-pass build reaches compilation but
  encounters a pre-existing route-export type-check error because
  `app/api/ask/grounded/route.ts` exports `resetGroundedState`. To preserve the
  exact source revisions, both sides used Next's matching production
  `compile` + `generate` modes without a source or configuration workaround.
- The first fly run in every arm was consistently slower than runs two and
  three. Equal treatment, pooled medians, and ABBA ordering reduce, but do not
  eliminate, local warm-state effects.

Raw build, server, and eight measurement logs are retained in the local
measurement archive at
`C:/Users/seanj/dev/reader-303-perf-evidence/20260908-141756`.
