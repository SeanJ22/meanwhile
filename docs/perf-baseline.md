# Performance baseline

Written by `pnpm perf`. **This file asserts nothing.** It is the measurement
the author rules on; the frame budget is UNSET until he picks one, and
`pnpm measure:fly` no longer asserts the retired 32 ms absolute.

- Measured: 2026-08-24 (America/Phoenix)
- Target: http://localhost:3210, zip 07866, 3 cold run(s)
- Browser: the Chrome installed on this machine, visible
- **Hardware acceleration: ON** — WebGL: Hardware accelerated · Canvas: Hardware accelerated · Rasterization: Hardware accelerated

| Measurement | Value |
|---|---|
| Time to first meaningful paint | 220 ms |
| Largest contentful paint | 644 ms |
| Median frame during the fly-in | 16.7 ms |
| Worst frame | 216.6 ms |
| Dropped frames (worst run) | 34 of 2191 sampled |

A frame counts as dropped when its gap exceeds 1.8x this display's own median
frame interval — measured, not assumed, so a 120 Hz laptop and a 30 Hz remote
session are both judged against themselves.

## Per run

| Run | FCP ms | LCP ms | Median frame ms | Worst frame ms | Dropped | Frames |
|---|---|---|---|---|---|---|
| 1 | 372 | 624 | 16.7 | 216.6 | 32 | 727 |
| 2 | 220 | 656 | 16.7 | 117.3 | 34 | 733 |
| 3 | 212 | 644 | 16.7 | 152.5 | 34 | 731 |
