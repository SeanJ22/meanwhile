"use client";

// @server-boundary-exempt takes a live MapLibre projection and a live map's
// event subscription, so a Server Component has nothing to render it with —
// the 500 the boundary guard prevents cannot arise here.

import { useEffect, useRef, useState } from "react";

import type { StateOutlineFeature } from "@/lib/map/state-focus";

/**
 * The mute-and-blur half of the state extrusion — g3 item 10 (M91).
 *
 * ## Why this is a DOM overlay and not a map layer
 *
 * The author's spec has two halves. The raised EDGE is map layers
 * (`lib/map/state-focus.ts`); this is the other half — everything outside the
 * active state is **muted in colour and very slightly blurred**. Desaturation
 * alone is explicitly not the spec, and a WebGL paint property cannot blur
 * what is painted underneath it: MapLibre has no read-back of the frame. Only
 * the compositor can, through `backdrop-filter`.
 *
 * So: one absolutely-positioned element over the canvas, carrying
 * `backdrop-filter: blur() saturate()`, clipped to everything OUTSIDE the
 * active state's projected polygon.
 *
 * **The rejected alternative, recorded:** doing the mute as a MapLibre `fill`
 * over the world-minus-state polygon. It is cheaper and it needs no
 * per-frame projection — and it can only tint, never blur, so it delivers
 * half the spec while looking like the whole of it. The author named the
 * blur; a tint pretending to be a blur is the kind of quiet substitution this
 * project treats as a defect.
 *
 * ## The clip
 *
 * A CSS `clip-path: polygon()` cannot express a hole. An SVG `<clipPath>`
 * with `clip-rule="evenodd"` can: one path holding the viewport rectangle
 * followed by the state's rings, so the even-odd rule punches the state out
 * and leaves the rest. Referenced by `clip-path: url(#…)`.
 *
 * ## Cost, and the mobile answer
 *
 * The path is recomputed on the map's `move`/`zoom`/`render` — the outline is
 * ~600 points across three states and one of them at a time, so a redraw is a
 * few hundred `project()` calls, well inside a frame. `backdrop-filter` is
 * the expensive half. It is kept to **1.1px** of blur, which is what "very
 * slightly" costs and is cheap enough to hold 60fps on a phone; if a future
 * device says otherwise, the knob to turn is the blur radius, never the
 * presence of the effect.
 *
 * ## What it must never do
 *
 * Carry information. The reference's own accessibility caution is that a
 * low-contrast extrusion cannot be asked to mean something — so the mute is a
 * light scrim that leaves labels legible, and the border-crossing prompt does
 * the communicating.
 */

export interface ProjectPoint {
  (lngLat: [number, number]): { x: number; y: number };
}

export function StateFocusOverlay({
  outline,
  project,
  subscribe,
  clipId = "wtp-outside-state",
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
  clipId?: string;
}) {
  const [path, setPath] = useState<string>("");
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
        setPath("");
        return;
      }
      const { width, height } = box.getBoundingClientRect();
      // The map's rectangle first — the even-odd rule needs something to
      // subtract the state FROM. A little overscan so a rounded corner or a
      // sub-pixel rounding never exposes an unmuted sliver at the edge.
      const parts = [`M-32,-32 H${width + 32} V${height + 32} H-32 Z`];
      for (const ring of outline.geometry.coordinates) {
        if (ring.length < 3) continue;
        const points = ring.map((c) => project([c[0], c[1]]));
        parts.push(
          `M${points
            .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
            .join("L")}Z`,
        );
      }
      setPath(parts.join(" "));
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
    schedule();
    const unsubscribe = subscribe ? subscribe(schedule) : () => {};
    window.addEventListener("resize", schedule);
    return () => {
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
         * re-runs when `outline`, `project` or `subscribe` changes, which on
         * a first paint happens exactly once — as the outlines land. So the
         * feature worked in a screenshot taken before that and was dead in
         * every walk taken after it.
         */
        frame.current = null;
      }
      window.removeEventListener("resize", schedule);
      unsubscribe();
    };
  }, [outline, project, subscribe]);

  // The measuring box always renders — it is what `redraw` measures, and a
  // component that only mounts its ruler once it has a measurement cannot
  // take one. The SCRIM inside it is what waits for a focused state.
  return (
    <div ref={boxRef} aria-hidden="true" className="state-focus-layer">
      {outline && path && (
        <>
          <svg className="state-focus-defs">
            <defs>
              <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
                <path d={path} clipRule="evenodd" />
              </clipPath>
            </defs>
          </svg>
          <div
            className="state-focus-scrim"
            data-testid="state-focus-scrim"
            style={{ clipPath: `url(#${clipId})` }}
          />
        </>
      )}
    </div>
  );
}
