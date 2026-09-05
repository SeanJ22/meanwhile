# September 4 tutorial and boundary accessibility proof

Scope: TUT-1 and ACC-1, the V94-F8 portion of the frozen reconciliation.
Both were PARTIAL before edits. Defaults and canonical boundary geometry are
unchanged.

## Reader behavior

- The once-per-device tour now contains exactly Ask, Who Governs Here,
  Local / State / Federal, and Boundary lines. No address or Ballot step.
- First display writes the existing seen flag while the active walk stays open.
  Reloading midway does not restart the automatic tour; deliberate replay still
  starts at Ask. Leaving the mounted surface clears its unfinished local request.
- Every step supports Skip, close, and Escape; native modal behavior traps
  keyboard focus and restores it on dismissal. Back and Next/Done work in both
  layouts. The schematics contain interface labels and neutral geometry, not
  invented bodies, people or agenda records.
- Quick tour is a persistent replay control beside the Filters heading, outside
  its collapsed content. Compact readers reach it through Open menu. Its server
  state is disabled until hydration attaches the handler; a pending shared
  replay request survives the deferred tutorial mount. The map-entry owner gates
  the tutorial on post-flight presentation readiness.
- Demonstration timing derives from the existing motion tokens. Reduced motion
  removes the schematic animations and preserves their visible meaning.
- All eight district types still default on. Filters and its groups still
  default collapsed. The master boundary switch retains its stored preference.
- Boundary line key is an opt-in disclosure immediately after Show districts.
  It works with Enter and Escape and derives all eight samples from the map's
  actual dash/weight specification.

## Boundary audit and change

The existing registry already differentiated most district types by dash and
weight. State House and unified schools shared `[2, 2]`; unified schools now use
paired short dashes `[2, 1, 2, 4]`. Reviewing the monochrome key exposed County and
Congressional as perceptually too similar despite different numeric lengths;
County now uses a long dash and two dots `[7, 2, 1, 2, 1, 2]`.

The existing tier colors remain. Unselected stroke opacity increases from 0.70
to 0.82 in both themes. Its zoom ramp rises modestly from 0.8 to 0.9 at zoom 4 and
from 1.5 to 1.65 at zoom 12, multiplied by each existing type weight. Selection
opacity stays 1. Geometry data passes through unchanged.

## Verification

Final deterministic pass: **21 tests passed, zero failed/skipped** across:

- `tests/tester-boundary-accessibility.test.ts`
- `tests/district-hits.test.ts`
- `tests/municipal-layer.test.ts`
- `tests/motion-tokens.test.ts`

The new checks exercise actual layer construction with a MapLibre test double,
preserve source geometry identity/coordinates, require eight distinct non-hue
patterns, compare the stronger opacity against every existing tier color in
both themes, and protect all-on/collapsed defaults. Targeted ESLint and diff
whitespace checks are clean.

Development browser proof ran on September 4 at 23:09 Arizona time,
against the isolated local app at `http://127.0.0.1:3244`. Its precise UTC run
identifier remains in the browser JSON.
Reproduce with `node --experimental-strip-types scripts/verify-tutorial-accessibility-9-4.mts`.

Both 1366×900 dark/normal-motion and 390×844 light/reduced-motion pass first
visit, returning-visit suppression, all four approved steps, skip at each step,
replay, Escape, close, keyboard focus trap/return, viewport fit, all-eight-on,
initially collapsed Filters, keyboard boundary toggle round trip, and the
keyboard-operated key. No actual map preferences are changed by the tour.

The final JSON is `.scratch/tester-tutorial-accessibility/proof.json`.
**Three of three final screenshots were opened and reviewed as images**:

- `tutorial-desktop-dark.png`: centered tour, legible content and controls,
  persistent replay visible in the collapsed Filters header behind it.
- `tutorial-compact-light.png`: bottom-positioned tour fully inside the compact
  viewport, readable step text, controls and replay hint without clipping.
- `boundary-key-compact-light-monochrome.png`: all eight labeled line samples
  visible, including the corrected County and unified-school patterns; the
  samples are intentionally grayscale to check distinction without hue.

Images are in `.scratch/tester-tutorial-accessibility/`. The screenshot harness
hides Next's development badge so it cannot obscure the product's controls.
It does not alter production styles.

This lane ran no production build, census, `walk:all`, civic acquisition, model
worker, operational control-plane write, or production scan. Root owns final
integration, the one production build, receipt renewal and shipping.

The final requirement audit added the first-display persistence control after
the development run above. The same browser script now advances to step 2,
asserts the seen flag before any dismissal, reloads, waits for post-flight
readiness, requires the automatic tour to remain absent, then exercises replay.
Root owns its final production-build execution; the development receipt above
does not claim that additional check ran before it was added.
