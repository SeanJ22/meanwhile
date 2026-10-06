"use client";

// @server-boundary-exempt takes a live MapLibre projection and a live map's
// event subscription, so a Server Component has nothing to render it with —
// the 500 the boundary guard prevents cannot arise here.

import { useEffect, useId, useRef, useState } from "react";

import {
  capSpecToSpan,
  clipRingToBox,
  extrusionSpecForZoom,
  riseAlphasFor,
  simplifyScreenRing,
  type ExtrusionSpec,
  type ScreenPoint,
  type StateOutlineFeature,
} from "@/lib/map/state-focus";

/**
 * The whole extrusion: the two opposed shadows AND the mute-and-blur outside
 * (M91, rebuilt for g4 items 1 and 2).
 *
 * ## Why the shadows moved here from the map
 *
 * They were two MapLibre `line` layers and they read as a grey stroke tracing
 * the polygon — `lib/map/state-focus.ts` carries the full account of why a
 * stroke can never become a shadow. A shadow is cast by the SHAPE, so it is
 * a blurred silhouette; and a blurred silhouette masked to the outside of the
 * shape is something only the DOM can draw here, because it needs a soft mask
 * and MapLibre's clip is binary.
 *
 * That turns out to be a simplification rather than a cost. This component
 * already projected the polygon every frame to clip the scrim, so the shadows
 * ride along on a computation that was happening anyway, and the map sheds
 * two layers.
 *
 * ## The soft mask IS the fix
 *
 * A shadow is at nearly full strength where it meets the shape that casts it
 * — that is what a shadow is. Clip it with a hard edge and the reader sees a
 * step from nothing to full strength exactly along the border: a line. So the
 * mask's own edge is blurred by `featherPx`, and the shadow rises out of zero
 * AT the border instead of arriving at full strength. This is the difference
 * the author's "the eye cannot find where the shadow begins" is describing,
 * and it is the reason this is a `<mask>` and not a `<clipPath>`.
 *
 * The SCRIM keeps a hard `clipPath`, deliberately. Its edge is the state's
 * SILHOUETTE, which the brief says must read — "the silhouette reads; the
 * digitization must not". A silhouette is a boundary between two treatments;
 * a line is a band darker or lighter than both of its sides. The measured
 * acceptance check in `scripts/measure-extrusion.mts` tests exactly that
 * distinction rather than testing for the absence of any edge at all.
 *
 * ## Same material inside and out
 *
 * Nothing is painted inside the active state. No fill, no tint, no wash — the
 * mask stops every shadow at the border and the scrim's clip stops the mute
 * there. Water inside Arizona is the same blue as water outside it, which is
 * what makes this an extrusion of the map rather than a card lying on it.
 *
 * ## Cost
 *
 * One projection pass per animation frame over rings that are simplified to a
 * sub-pixel tolerance first, so at continental zoom this is a few dozen
 * points rather than six hundred. `backdrop-filter` is still the expensive
 * half and is still 1.1 px; the SVG filters are composited on the GPU.
 */

export interface ProjectPoint {
  (lngLat: [number, number]): { x: number; y: number };
}

/**
 * Margin around the canvas for the filter regions and the mask.
 *
 * Comfortably more than the largest offset plus three sigma of blur, so every
 * Gaussian reaches zero inside its own region. See the note on the filters
 * below for what a clamped region does instead.
 */
const FILTER_PAD = 120;

interface Drawing {
  /**
   * The state's own silhouette — its rings and nothing else, CUT TO THE
   * FILTER REGION (g5 item 1).
   *
   * The cut is the fix and `lib/map/state-focus.ts#clipRingToBox` carries the
   * measurements: a clip path tens of thousands of pixels across is dropped
   * by Chromium rather than applied, and a dropped clip on a `backdrop-filter`
   * scrim mutes the whole map — including the state the reader is standing
   * in. Nothing outside `FILTER_PAD` of the canvas could ever have been seen,
   * so the cut removes only geometry that was being rasterized to be thrown
   * away.
   *
   * An EMPTY string here is a claim with a meaning: the viewport does not
   * touch the active state anywhere, so everything in view is outside it and
   * the mute is total. That is the correct render for panning into New Mexico
   * while Arizona is active, and it is why this case builds a full-coverage
   * drawing instead of clearing to null.
   *
   * **Kept separate from `outsidePath` on purpose, and the reason is a real
   * defect the measurement caught.** The first build used one path for both,
   * and that path was the CLIP: the viewport rectangle followed by the
   * state's rings, evaluated even-odd, which describes *everything except*
   * the state. Feeding it to the mask inverted the mask, and feeding it to
   * the shadows meant the thing being blurred and offset was a viewport-sized
   * rectangle with a state-shaped hole in it.
   *
   * The result was full-strength white and black over the terrain with the
   * state's border as a hard edge — the exact defect the rebuild existed to
   * remove, reintroduced by a variable name. `pnpm measure:extrusion`
   * reported peaks of 130–165 and adjacent steps of 165–202 where a blurred
   * shadow cannot exceed six, which is how it was found; nothing about it was
   * obvious in a screenshot, because a strong soft-cornered wash over a map
   * still looks deliberate.
   */
  statePath: string;
  /** The viewport minus the state, even-odd — what the scrim is clipped to. */
  outsidePath: string;
  /** Box the mask and shadows are sized against. */
  width: number;
  height: number;
  /** Sizes for this frame's zoom. */
  spec: ExtrusionSpec;
}

export function StateFocusOverlay({
  outline,
  project,
  subscribe,
  zoomOf,
  theme,
  clipId,
}: {
  /** The focused state, or null — then nothing renders at all. */
  outline: StateOutlineFeature | null;
  /** The map's own projection. Never a function stored in state — see below. */
  project: ProjectPoint | null;
  /**
   * Registers a callback for "the camera moved"; returns its unsubscriber.
   * The overlay does not know it is on a map, which keeps this testable and
   * keeps the map's event names in one file.
   */
  subscribe: ((onMove: () => void) => () => void) | null;
  /**
   * The camera's zoom, read at draw time.
   *
   * A function rather than a prop because the rise is re-sized on every frame
   * of a pinch, and threading zoom through React state would re-render this
   * component sixty times a second to change two numbers.
   */
  zoomOf?: (() => number) | null;
  /**
   * Which ground the rise is standing on.
   *
   * The two silhouettes' opacities differ by theme — a white highlight over
   * a pale basemap is nearly invisible at the strength that reads correctly
   * over a dark one. See `riseAlphasFor`.
   */
  theme: "light" | "dark";
  /** Overridable so a test can mount two of these without id collisions. */
  clipId?: string;
}) {
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const frame = useRef<number | null>(null);
  /**
   * The MAP's box, not the window's.
   *
   * The first version used `position: fixed` and `window.innerWidth`, which
   * put the scrim over the whole page — the sidebar's own text came back
   * washed out in the first screenshot pair, because a scrim built to mute
   * *terrain* was muting the controls as well. `map.project()` returns
   * canvas-relative pixels, so the clip has to be measured in the same box
   * the projection speaks in, and the element has to be positioned in it.
   */
  const boxRef = useRef<HTMLDivElement | null>(null);
  /**
   * **THE BOX IS MEASURED WHEN IT CHANGES, NOT ON EVERY FRAME OF A FLY-IN.**
   * (W6 H3, 2026-08-31, from a CPU profile — `pnpm measure:flyin --profile`.)
   *
   * `redraw` ran `box.getBoundingClientRect()` every time the camera moved, and
   * during the 2600 ms zip fly-in that is once per animation frame. A profile of
   * one flight put **46 ms of main-thread self time in `getBoundingClientRect`
   * alone** — third behind MapLibre's own worker-message handler and ahead of
   * every other named function in the page.
   *
   * Its own 46 ms is not the whole bill and is not the reason this changed.
   * `getBoundingClientRect` forces a SYNCHRONOUS STYLE AND LAYOUT FLUSH, and
   * this one is called from inside the animation frame that then sets React
   * state and rewrites four SVG path attributes — so the layout it forces is
   * the layout that was about to be invalidated anyway, computed twice, in the
   * middle of the frame a reader is watching.
   *
   * **And the value cannot change while the camera moves.** This is the MAP's
   * box. Panning, zooming and flying do not resize it; only a window resize, the
   * rail opening or a container change does. So it is measured on those, through
   * a `ResizeObserver` on the element itself, which catches every one of them —
   * including the rail, which the old `window.resize` listener could not see.
   *
   * `null` means "not measured yet", and the redraw below measures it once
   * rather than treating an unmeasured box as a zero-sized one.
   */
  const boxSizeRef = useRef<{ width: number; height: number } | null>(null);

  /**
   * Ids unique to this instance.
   *
   * `useId` rather than a module constant: two maps on one page would
   * otherwise share a mask id, and the second to mount would silently
   * repaint the first — the same class of aliasing bug as the funding cache
   * key, one layer down.
   */
  const alphas = riseAlphasFor(theme);
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const outsideClipId = clipId ?? `wtp-outside-${reactId}`;
  const maskId = `wtp-rise-mask-${reactId}`;
  const softId = `wtp-rise-soft-${reactId}`;
  const featherId = `wtp-rise-feather-${reactId}`;

  useEffect(() => {
    /*
     * Every path through this effect goes via the animation frame, including
     * "there is nothing to draw". The early return used to call `setPath("")`
     * straight away, which is a synchronous setState inside an effect — a
     * cascading render, and the lint rule is right to refuse it. Clearing on
     * the frame is also the correct ORDER: a stale clip must not survive one
     * paint into a new focused state.
     */
    const redraw = () => {
      frame.current = null;
      const box = boxRef.current;
      if (!outline || !project || !box) {
        setDrawing(null);
        return;
      }
      // Measured once and re-measured only when the element actually resizes —
      // see the note on `boxSizeRef`. A camera move never changes it.
      if (!boxSizeRef.current) {
        const rect = box.getBoundingClientRect();
        boxSizeRef.current = { width: rect.width, height: rect.height };
      }
      const { width, height } = boxSizeRef.current;
      const spec = extrusionSpecForZoom(zoomOf?.() ?? 10);

      /*
       * The box every ring is cut to: exactly the mask's own region and the
       * two filter regions, which are all `FILTER_PAD` around the canvas.
       * Cutting anywhere wider would leave geometry that cannot be seen;
       * cutting narrower would put an artificial edge close enough to the
       * canvas for its own shadow to reach back into view.
       */
      const clipBox = {
        minX: -FILTER_PAD,
        minY: -FILTER_PAD,
        maxX: width + FILTER_PAD,
        maxY: height + FILTER_PAD,
      };

      const rings: string[] = [];
      // The active state's own on-screen extent, accumulated as the rings are
      // built — the rise is capped by it so a state smaller than its own
      // shadow is not muted by it. See capSpecToSpan.
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const ring of outline.geometry.coordinates) {
        if (ring.length < 3) continue;
        const projected: ScreenPoint[] = ring.map((c) => project([c[0], c[1]]));
        // Cut BEFORE simplifying: the clip is what keeps the path small
        // enough for Chromium to honour it at all, and doing it first also
        // means the simplifier only ever walks the points that survived.
        const clipped = clipRingToBox(projected, clipBox);
        if (clipped.length < 3) continue;
        // Simplified AFTER projection, so one sub-pixel rule covers every
        // zoom — see lib/map/state-focus.ts#simplifyScreenRing.
        const points = simplifyScreenRing(clipped, spec.simplifyPx);
        for (const p of points) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        rings.push(
          `M${points
            .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
            .join("L")}Z`,
        );
      }

      /*
       * NO RINGS MEANS EVERYTHING IN VIEW IS OUTSIDE THE ACTIVE STATE.
       *
       * This used to clear the drawing, which rendered the frame plain — the
       * treatment reserved for having no active state at all. The two are
       * opposites: with a state active and none of it in view, the whole
       * viewport is somewhere else and the whole viewport is muted. The empty
       * `statePath` gets that for free: the mask keeps only its white rect, so
       * the mute covers everything, and the scrim's clip is the bare viewport
       * rectangle with nothing subtracted from it.
       */
      const statePath = rings.join(" ");
      // The map's rectangle FIRST — the even-odd rule needs something to
      // subtract the state from. A little overscan so a rounded corner or a
      // sub-pixel rounding never exposes an unmuted sliver at the edge. This
      // composite path is the SCRIM's clip and nothing else's; see the note
      // on `Drawing.statePath` for what happened when the shadows shared it.
      const outsidePath = `M-32,-32 H${width + 32} V${height + 32} H-32 Z ${statePath}`;
      // With nothing on screen there is no shape to size the rise against, and
      // nothing is drawn either — the uncapped spec is carried through so the
      // mute rect and the mask keep their zoom-appropriate sizes.
      const span =
        rings.length > 0 ? Math.min(maxX - minX, maxY - minY) : Number.POSITIVE_INFINITY;
      setDrawing({
        statePath,
        outsidePath,
        width,
        height,
        spec: capSpecToSpan(spec, span),
      });
    };

    const schedule = () => {
      if (frame.current !== null) return;
      frame.current = window.requestAnimationFrame(redraw);
    };

    // `schedule()`, not `redraw()`: the first draw goes through the same
    // animation frame every later one does. Calling `redraw` here would set
    // state synchronously inside the effect, which cascades a render — and
    // it would also measure the box before layout has settled on a fresh
    // mount, so the very first clip could be built against a zero-width
    // rectangle.
    /*
     * A resize is the ONE thing that invalidates the cached box, so every
     * path that can resize it clears the cache before scheduling the redraw.
     * Clearing rather than measuring here: the measurement then happens inside
     * the animation frame, where it always did, instead of synchronously
     * inside a resize event that may be one of a rapid series.
     */
    const onResize = () => {
      boxSizeRef.current = null;
      schedule();
    };

    schedule();
    const unsubscribe = subscribe ? subscribe(schedule) : () => {};
    window.addEventListener("resize", onResize);
    /*
     * **The element's own resizes, which `window.resize` never fired for.**
     *
     * The rail opening changes this box's width without the window changing
     * size at all, and the old listener could not see it — the scrim kept
     * drawing against a stale width until the next camera move happened to
     * re-measure it. Caching the box would have made that permanent, so the
     * observer is not an optimisation detail; it is what makes the cache
     * correct, and it fixes a staleness that predates it.
     */
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
    if (observer && boxRef.current) observer.observe(boxRef.current);
    return () => {
      observer?.disconnect();
      if (frame.current !== null) {
        window.cancelAnimationFrame(frame.current);
        /*
         * **Clearing the handle is the whole fix.** `frame.current` is the
         * "already scheduled" guard, and cancelling without clearing it left
         * a non-null handle for a frame that will never run — so the next
         * effect pass called `schedule()`, saw a pending frame, and returned.
         * One cancelled frame poisoned every later one, and the scrim simply
         * never drew.
         *
         * It was invisible for one reason worth remembering: the effect only
         * re-runs when its inputs change, which on a first paint happens
         * exactly once — as the outlines land. So the feature worked in a
         * screenshot taken before that and was dead in every walk after it.
         */
        frame.current = null;
      }
      window.removeEventListener("resize", onResize);
      unsubscribe();
    };
  }, [outline, project, subscribe, zoomOf]);

  // The measuring box always renders — it is what `redraw` measures, and a
  // component that only mounts its ruler once it has a measurement cannot
  // take one. Everything inside it waits for a focused state.
  return (
    <div ref={boxRef} aria-hidden="true" className="state-focus-layer">
      {outline && drawing && (
        <>
          <svg
            className="state-focus-art"
            width={drawing.width}
            height={drawing.height}
            data-testid="state-focus-art"
          >
            <defs>
              {/* The clip for the SCRIM: binary, and the state's silhouette. */}
              <clipPath id={outsideClipId} clipPathUnits="userSpaceOnUse">
                <path d={drawing.outsidePath} clipRule="evenodd" />
              </clipPath>

              {/*
                Each silhouette's own softness.

                An SVG filter primitive rather than the CSS `filter: blur()`
                shorthand, because this is SVG 1.1 core and renders
                identically everywhere, while CSS filters on SVG children
                have a longer tail of disagreement between engines.

                **The filter REGION is in user space, sized to the canvas,
                and that is load-bearing.** The first build used the default
                `objectBoundingBox` region of `-50% / 200%`, which is a
                percentage of the PATH's bounding box — and at neighbourhood
                zoom the projected state is thousands of pixels across, so
                that region is tens of thousands of pixels of filter surface.
                Chromium clamps it, and a clamped filter region does not fade
                out: it CUTS OFF. The measurement caught it as an adjacent
                step of 167 luminance units where a blurred shadow cannot
                exceed one, and it was the white silhouette arriving at full
                strength behind a hard straight edge — a second, worse
                version of exactly the defect this rebuild exists to remove.

                Bounded to the visible box plus a margin for the offset and
                three sigma of blur, the region is small, the blur completes
                inside it, and there is nothing to clamp.
              */}
              <filter
                id={softId}
                filterUnits="userSpaceOnUse"
                x={-FILTER_PAD}
                y={-FILTER_PAD}
                width={drawing.width + FILTER_PAD * 2}
                height={drawing.height + FILTER_PAD * 2}
              >
                <feGaussianBlur stdDeviation={drawing.spec.blurPx} />
              </filter>
              <filter
                id={featherId}
                filterUnits="userSpaceOnUse"
                x={-FILTER_PAD}
                y={-FILTER_PAD}
                width={drawing.width + FILTER_PAD * 2}
                height={drawing.height + FILTER_PAD * 2}
              >
                <feGaussianBlur stdDeviation={drawing.spec.featherPx} />
              </filter>

              {/*
                The soft mask. White everywhere, black over the state, and the
                black is BLURRED — so the shadows fade out of existence as they
                approach the border instead of being cut off at full strength.
                This one blur is the difference between a rise and the grey
                stroke the author rejected.
              */}
              <mask
                id={maskId}
                maskUnits="userSpaceOnUse"
                x={-FILTER_PAD}
                y={-FILTER_PAD}
                width={drawing.width + FILTER_PAD * 2}
                height={drawing.height + FILTER_PAD * 2}
              >
                <rect
                  x={-FILTER_PAD}
                  y={-FILTER_PAD}
                  width={drawing.width + FILTER_PAD * 2}
                  height={drawing.height + FILTER_PAD * 2}
                  fill="var(--state-focus-white)"
                />
                {/* Omitted, not emptied, when no part of the state is in
                    view: the mask is then its white rect alone and the mute
                    covers the frame, which is the correct answer for a
                    viewport that is entirely somewhere else. */}
                {drawing.statePath && (
                  <path
                    d={drawing.statePath}
                    fillRule="evenodd"
                    fill="var(--state-focus-black)"
                    filter={`url(#${featherId})`}
                  />
                )}
              </mask>
            </defs>

            <g mask={`url(#${maskId})`}>
              {/*
                THE MUTE'S COLOUR, and it lives here rather than on the scrim
                because this is the only place its edge can be soft.

                The mute was one `backdrop-filter` element clipped with a
                binary `clip-path`. Arizona's northern, eastern and southern
                borders are straight lines, so that clip drew a crisp
                rectangle across the map: the state read as pasted on rather
                than raised out, and only the west border — where the light
                is — was softened by a shadow. CSS `mask` referencing an SVG
                mask would have fixed it in one line and is not honoured on an
                HTML element in Chromium, which the four author frames showed
                by not changing at all.

                So the mute is split. Its COLOUR is this rect, masked by the
                same feathered mask the shadows use, so it fades in across the
                border on every side. Its BLUR and desaturation stay on the
                scrim, hard-clipped — a 1.1 px blur has almost no luminance
                step of its own, so what survives the split is far below what
                the eye finds as an edge.
              */}
              <rect
                x={-FILTER_PAD}
                y={-FILTER_PAD}
                width={drawing.width + FILTER_PAD * 2}
                height={drawing.height + FILTER_PAD * 2}
                fill={`var(--state-focus-mute-${theme})`}
                fillOpacity={theme === "light" ? 0.2 : 0.26}
              />
              {/* Light source at top-left. The lit silhouette is displaced
                  TOWARD it and the shaded one away, both in screen space —
                  the sun does not rotate with the map. Both are omitted when
                  no part of the state is in view: there is no edge on screen
                  to raise, and an empty `d` is not a shape. */}
              {drawing.statePath && (
                <>
                  <path
                    d={drawing.statePath}
                    fillRule="evenodd"
                    fill="var(--state-focus-white)"
                    fillOpacity={alphas.light}
                    filter={`url(#${softId})`}
                    transform={`translate(${-drawing.spec.offsetPx} ${-drawing.spec.offsetPx})`}
                  />
                  <path
                    d={drawing.statePath}
                    fillRule="evenodd"
                    fill="var(--state-focus-black)"
                    fillOpacity={alphas.dark}
                    filter={`url(#${softId})`}
                    transform={`translate(${drawing.spec.offsetPx} ${drawing.spec.offsetPx})`}
                  />
                </>
              )}
            </g>
          </svg>
          {/*
            The mute carries BOTH the hard clip and the soft mask, and the
            pair is deliberate.

            `clip-path` alone is what shipped, and the author's four frames
            show what it costs: Arizona's northern, eastern and southern
            borders are straight lines, so a binary clip along them reads as
            a crisp rectangle stamped onto the map — the state looks pasted
            on rather than raised out. The shadows soften the west border,
            where the light is, and could never soften the other three.

            The same feathered mask the shadows use fixes it, because it is
            already exactly the right shape: black over the state, white
            outside, with a blurred edge. Applied to the scrim, the mute
            fades in across the border instead of switching on at it.

            Both are set, and that IS the fallback: an engine that does not
            resolve an SVG `mask` reference from CSS ignores the property and
            still gets the clip, so the effect degrades to what shipped
            rather than to nothing. An engine that honours both intersects
            them, which is the soft edge.
          */}
          <div
            className="state-focus-scrim"
            data-testid="state-focus-scrim"
            style={{
              clipPath: `url(#${outsideClipId})`,
              mask: `url(#${maskId})`,
              WebkitMask: `url(#${maskId})`,
            }}
          />
        </>
      )}
    </div>
  );
}
