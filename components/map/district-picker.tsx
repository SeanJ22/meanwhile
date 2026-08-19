"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { anchorInViewport, type AnchorPosition } from "@/lib/map/anchor-in-viewport";
import { TIERS, TIER_LABEL } from "@/lib/ocd/tiers";
import { useUi, useUiDispatch } from "@/lib/state/provider";

import { tierVars } from "../shell/tier-style";

/**
 * Which district did you mean?
 *
 * A point on a map is inside a *set* of districts, so this is the ordinary
 * case, not an error. Downtown Tucson is in a congressional district, a state
 * senate district, a state house district, a county, a city and a school
 * district at the same time; Rockaway NJ is in a K-8 elementary district and a
 * regional high school district simultaneously.
 *
 * Grouped by tier, and never a two-option prompt: the list is however many
 * districts actually contain the point. This is also the moment the product's
 * rule about zip becomes real — the reader's own click chooses the district,
 * rather than anything being inferred from where their zip code centroid fell.
 */
export function DistrictPicker() {
  const { districtPick, selectedDistrictOcdId } = useUi();
  const dispatch = useUiDispatch();

  /*
   * F01 9.1 — measured, then placed.
   *
   * The clamp needs the box’s real size, and the box’s size depends on how
   * many districts the click landed in, so it cannot be known in advance. The
   * measurement runs in a LAYOUT effect: it reads the rendered size and sets
   * the position before the browser paints, so the reader never sees the box
   * at its unclamped anchor. The first render is hidden rather than misplaced
   * — a frame of nothing is better than a frame of a box half off the screen.
   */
  const boxRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<AnchorPosition | null>(null);

  const anchorX = districtPick?.at.x ?? 0;
  const anchorY = districtPick?.at.y ?? 0;
  const choiceCount = districtPick?.choices.length ?? 0;

  useLayoutEffect(() => {
    const node = boxRef.current;
    if (!node || !districtPick) {
      setPlaced(null);
      return;
    }
    const measure = () => {
      const box = boxRef.current;
      if (!box) return;
      setPlaced(
        anchorInViewport({
          x: anchorX,
          y: anchorY,
          // offsetHeight, the PAINTED height: the CSS cap below already keeps
          // the box inside the viewport and lets it scroll internally past
          // that, so what has to be placed is what is actually drawn.
          width: box.offsetWidth,
          height: box.offsetHeight,
          containerWidth: window.innerWidth,
          containerHeight: window.innerHeight,
        }),
      );
    };
    measure();
    // A resize or an orientation change moves the edges the box was clamped
    // against, so the same arithmetic runs again rather than leaving a box
    // clamped to a viewport that no longer exists.
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // choiceCount is in the deps because it is what changes the box’s HEIGHT;
    // the ref itself never changes identity and would not re-trigger this.
  }, [districtPick, anchorX, anchorY, choiceCount]);

  useEffect(() => {
    if (!districtPick) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "district/pick", pick: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [districtPick, dispatch]);

  if (!districtPick) return null;

  const groups = TIERS.map((tier) => ({
    tier,
    choices: districtPick.choices.filter((c) => c.tier === tier),
  })).filter((g) => g.choices.length > 0);

  return (
    <div
      ref={boxRef}
      className="district-picker"
      /* F01 9.1 (2026-08-19): the box lands WHOLE, wherever the reader clicked.
         `left: at.x; top: at.y` anchored its top-left corner to the click,
         which put most of the box below the fold on any click near the bottom
         edge — the author's "five districts here" showing one row. `placed` is
         null on the first paint, before the box has been measured; the raw
         anchor is used for that one frame and the clamp applies as soon as the
         size is known, which is the same frame a reader could see it. */
      style={
        placed
          ? { left: placed.left, top: placed.top }
          : { left: districtPick.at.x, top: districtPick.at.y, visibility: "hidden" }
      }
      role="dialog"
      aria-label="Choose a district"
    >
      <div className="district-picker-head">
        <span>
          {districtPick.choices.length} districts here
        </span>
        <button
          type="button"
          className="clear-btn"
          aria-label="Dismiss"
          onClick={() => dispatch({ type: "district/pick", pick: null })}
        >
          ✕
        </button>
      </div>

      {groups.map((group) => (
        <div key={group.tier}>
          <p className="district-picker-tier" style={tierVars(group.tier)}>
            {TIER_LABEL[group.tier]}
          </p>

          {group.choices.map((choice) => {
            // 3f (2026-08-16): the same gesture un-makes the selection HERE
            // too. 6d put the toggle only on the single-hit path, but a
            // click is almost never a single hit (downtown Tucson is in six
            // districts), so "click again to unshade" never engaged — the
            // picker reopened and re-selected. The already-selected row now
            // reads as selected and choosing it deselects.
            const isSelected = choice.ocdId === selectedDistrictOcdId;
            return (
              <button
                key={choice.ocdId}
                type="button"
                className="district-picker-row"
                style={tierVars(choice.tier)}
                aria-pressed={isSelected}
                onClick={() =>
                  dispatch(
                    isSelected
                      ? { type: "select/district", ocdId: null, districtType: null }
                      : {
                          type: "select/district",
                          ocdId: choice.ocdId,
                          districtType: choice.type,
                        },
                  )
                }
              >
                <span className="district-picker-label">
                  {choice.label}
                  {isSelected ? " ✓" : ""}
                </span>
                <span className="district-picker-type">
                  {isSelected ? "tap to unselect" : choice.typeLabel}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
