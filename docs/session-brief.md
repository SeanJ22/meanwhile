# Session brief

The last brief executed was g5 — the active-state model, and the panel that
would not paint. Two items, both P0, both shipped. This file is overwritten by
each session with the brief it ran; what follows is what g5 was asked to do and
what it found, so the next session starts from the record rather than from a
guess.

## What g5 was asked for

**Item 1 — the active-state model, built as specified.** One state is ACTIVE at
a time and the zip sets it. The ENTIRE active state renders crisp, sharp and
raised at every zoom; every other state renders blurred and lowered; only the
active state's per-state geometry loads; and with NO active state — before a
zip, or at a zip we do not cover — nothing is muted, blurred or raised at all.
The zip chooses the state and centres the camera and does nothing else on the
map. Remove the zip shading from the product. Diagnose before fixing, measure
the transition, and add permanent checks that assert WHAT is covered.

**Item 2 — the meetings panel renders empty until the mouse moves.** Header
read "86 meetings", Sort and Group rendered, the list body was blank until the
pointer moved over it. A phone has no hover. Fix so the rows are present and
painted on first render with no pointer event of any kind, walk it with a
browser that never moves the mouse, and audit every other panel that could
share the cause.

## What it found

Both items were the same defect. The mute is a DOM scrim carrying
`backdrop-filter`, clipped to "everything except the active state" by
`clip-path: url(#…)`, and the path fed to that clip was the state's rings at
FULL projected extent — about 16,800 × 20,000 CSS pixels at the zoom a reader
lands on. **Chromium silently drops a clip path that large**, and a dropped
clip is not a smaller clip: the scrim paints over the whole map. That same
full-viewport backdrop-filter surface, stacked under the list overlay's own
backdrop-filter over the WebGL canvas, is what stopped the meetings panel
painting until a pointer move dirtied the layer.

The fix is `clipRingToBox` — every ring cut to the mask's own region before it
is serialized — plus suspending the scrim while any full-screen overlay is
open. Full account in `docs/state.md` §36; tracker rows M128 and M129.

## What the next session should know

- `pnpm measure:focus`, `pnpm measure:panels` and `pnpm measure:fly` are new
  and permanent. The first two are appended to `pnpm walk:all`.
- The zip-shading walk check is RETIRED with the feature, replaced by its
  opposite. That is the only ground on which the suite ever loses a check.
- The playbook entry this session earned: a visual measurement that cannot
  distinguish correct from incorrect coverage is not a correctness test.
