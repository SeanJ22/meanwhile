# AUD-03 — the decision rule, registered before the measurement

Recorded 2026-08-18 (g17), in its own commit, **before** the measurement it
governs was run. The commit order is the point of this file: a threshold chosen
after seeing the number is not a threshold, it is a rationalisation of whatever
the number turned out to be. `git log --follow docs/aud-03-prereg.md` and the
build-check run that produced the measurement are both in the record, and the
first is older than the second.

## The row, as the auditor wrote it

AUD-03 is deliberately conditional. Measure `WelcomeOverlay`, `TutorialOverlay`,
the large official and entity detail surfaces, the popup implementations and the
list overlay. If together they save only a few KB compressed, leave them alone:
the extra async boundaries cost more in maintainability than they return.

The candidate split is explicitly **not the map**. MapLibre is the landing
product and is not to be deferred, and a budget gamed by moving the biggest
thing out of scope measures nothing.

## The candidate set, named now so it cannot be trimmed later

Exactly these, all statically imported by `components/map/map-entry.tsx`, none of
them on the first paint of `/`:

1. `components/map/welcome-overlay.tsx` — `WelcomeOverlay`
2. `components/map/tutorial-overlay.tsx` — `TutorialOverlay`
3. `components/map/popup/official-modal.tsx` — `OfficialModal`
4. `components/map/popup/entity-modal.tsx` — `EntityModal`
5. `components/map/popup/district-popup.tsx` — `DistrictPopup`
6. `components/map/popup/meeting-popup.tsx` — `MeetingPopup`
7. `components/map/popup/official-popup.tsx` — `OfficialPopup`
8. `components/map/list-overlay.tsx` — `ListOverlay`

`MapCanvas` and everything MapLibre reaches is **out of scope by the author's
instruction**, and so is anything on the first screen (`Sidebar`, `PillCluster`,
`Legend`, `CountBadge`, `MeetingPanel`, `DoorOverlay`, `CoverageNotice`,
`DataFreshness`, `DistrictPicker`, `StateCrossingPrompt`).

## How the saving is measured

Not estimated from source file sizes, and not read off a bundler report. A
**build diff**, by the same instrument that already prints budget 2:

1. Build with the candidate set statically imported — today's tree — and record
   the compressed transfer bytes for `/` that
   `scripts/check-build-output.mjs` prints, on the ubuntu standalone build.
2. Build again with the candidate set behind `next/dynamic` boundaries, nothing
   else changed, and record the same figure from the same instrument.
3. The saving is figure 1 minus figure 2, in gzip bytes of the scripts the
   prerendered `/` actually references.

A saving is only counted if it comes out of the **initial** graph. Bytes that
move from one initial chunk to another initial chunk are not a saving, and the
instrument's own chunk count is stated alongside so a shuffle is visible.

## The threshold

**20,480 bytes (20 KB) of compressed transfer, removed from the initial graph
for `/`.**

At or above it, AUD-03 is built. Below it, AUD-03 is **killed on the number**,
the number is stated in the report, and the static imports stay exactly as they
are.

Why that number, stated now rather than fitted later:

- Application chunks are **211,397 bytes** gzip of the current initial graph for
  `/` (`scripts/bundle-budget.json`, `client.applicationTransferBytes`). 20 KB is
  about **10%** of the half of the bundle this repo actually controls. A change
  that does not move a tenth of our own code is not visible against MapLibre's
  649,813 bytes sitting beside it.
- Against the wire: 20 KB is roughly 16 ms on a 10 Mbps connection. Below that
  no reader perceives anything, and what they get instead is a permanent set of
  async boundaries in the first-paint path — the maintainability cost the
  auditor said not to pay for a few KB.
- 20 KB is a **floor, not a target**. It does not license raising it if the
  measurement lands just under, and it does not license lowering it if the
  measurement lands just over. Either direction after the fact is the thing this
  file exists to prevent.

## What a kill has to say

If AUD-03 is killed, the report states the measured saving in bytes, the
threshold, and that the candidate set above was the one measured. A kill with no
number attached is a deferral wearing a decision's clothes, and this row is not
allowed to be deferred — the author's instruction is that either outcome is a
close.
