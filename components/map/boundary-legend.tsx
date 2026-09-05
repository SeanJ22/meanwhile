"use client";

import { useRef } from "react";
import { DISTRICT_LAYERS, DISTRICT_TYPES } from "@/lib/map/districts";
import { DISTRICT_TYPE_TIER } from "@/lib/ocd/district-tiers";
import { TIER_ACCENT_VAR } from "@/lib/ocd/tiers";
import type { DistrictType } from "@/lib/state/types";
import styles from "./boundary-legend.module.css";

/** Same dash units and relative weights as the map, including in monochrome. */
export function BoundaryLineSample({ type }: { type: DistrictType }) {
  const spec = DISTRICT_LAYERS[type];
  const width = 1.65 * spec.weight;
  return (
    <svg className={styles.sample} width="64" height="12" viewBox="0 0 64 12" aria-hidden="true">
      <line
        x1="0" y1="6" x2="64" y2="6"
        stroke={`var(${TIER_ACCENT_VAR[DISTRICT_TYPE_TIER[type]]})`}
        strokeWidth={width}
        strokeDasharray={spec.dash.map((unit) => unit * width).join(" ")}
      />
    </svg>
  );
}

/** An opt-in key at the boundary switch, rather than another permanent panel. */
export function BoundaryLegend() {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  return (
    <details
      ref={detailsRef}
      className={styles.legend}
      data-boundary-legend
      onKeyDown={(event) => {
        if (event.key === "Escape" && detailsRef.current?.open) {
          detailsRef.current.open = false;
          detailsRef.current.querySelector("summary")?.focus();
          event.stopPropagation();
        }
      }}
    >
      <summary>Boundary line key</summary>
      <p>Patterns and line weight distinguish district types as well as color.</p>
      <ul>
        {DISTRICT_TYPES.map((type) => (
          <li key={type}>
            <BoundaryLineSample type={type} />
            <span>{DISTRICT_LAYERS[type].label}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
