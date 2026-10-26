"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { readerText } from "@/lib/text/reader-names";

import { anchorInViewport, type AnchorPosition } from "@/lib/map/anchor-in-viewport";
import { TIERS, TIER_LABEL } from "@/lib/ocd/tiers";
import { useUi, useUiDispatch } from "@/lib/state/provider";

import { tierVars } from "../shell/tier-style";

/**
 * Which district did you mean? A point sits inside a set of districts, so the
 * list holds however many contain it, grouped by tier. The reader's click
 * chooses the district.
 */
export function DistrictPicker() {
  const { districtPick, selectedDistrictOcdId } = useUi();
  const dispatch = useUiDispatch();

  /*
   * The box is measured in a layout effect and clamped to the viewport before
   * paint; the first render is hidden rather than misplaced.
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
          // offsetHeight: the CSS cap already keeps the box inside the viewport.
          width: box.offsetWidth,
          height: box.offsetHeight,
          containerWidth: window.innerWidth,
          containerHeight: window.innerHeight,
        }),
      );
    };
    measure();
    // Re-clamp on resize or orientation change.
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // choiceCount changes the box's height; the ref never changes identity.
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
      /* `placed` is null on the first paint, before measurement; the raw anchor is used for that frame. */
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
            // Choosing the already-selected row deselects it.
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
                  {readerText(choice.label)}
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
