/**
 * The three reviewable raised-state treatments from the 2026-09-07 visual
 * pass. These values are review fixtures, not production preferences. A local
 * development build can select one with `?raisedState=A_SOFT_LIFT` (or B/C),
 * while a production build always keeps the established Reader treatment.
 *
 * Geometry is intentionally absent from this type. Every field is a paint
 * parameter measured in viewport pixels or an opacity multiplier, so changing
 * a candidate cannot select, simplify, buffer, or otherwise alter a border.
 */
export type RaisedStateVariant =
  | "A_SOFT_LIFT"
  | "B_MATERIAL_LIFT"
  | "C_DEEP_LIFT";

export interface RaisedStatePresentation {
  /** Distance from the canonical border to each opposed shadow. */
  shadowOffsetPx: number;
  /** MapLibre line blur for the two shadow silhouettes. */
  shadowBlurPx: number;
  /** Width of the soft shadow line before blur. */
  shadowWidthPx: number;
  /** Scales the theme's dark shadow opacity. */
  darkShadowScale: number;
  /** Scales the theme's light shadow opacity. */
  lightShadowScale: number;
  /** Scales the deliberately slight surface tint. */
  surfaceScale: number;
  /** Scales only the crisp directional edge width. */
  edgeWidthScale: number;
}

/**
 * Neumorphism.io's supplied reference uses opposed 12px offsets and 24px
 * softness. Those proportions are translated down to map-scale paint here:
 * A is restrained, B is the material midpoint, and C carries the full 1:2
 * offset-to-softness relationship most strongly. No candidate contains data
 * or geometry.
 */
export const RAISED_STATE_PRESENTATIONS: Readonly<
  Record<RaisedStateVariant, RaisedStatePresentation>
> = {
  A_SOFT_LIFT: {
    shadowOffsetPx: 3,
    shadowBlurPx: 8,
    shadowWidthPx: 10,
    darkShadowScale: 0.62,
    lightShadowScale: 0.58,
    surfaceScale: 0.28,
    edgeWidthScale: 0.78,
  },
  B_MATERIAL_LIFT: {
    shadowOffsetPx: 7,
    shadowBlurPx: 16,
    shadowWidthPx: 18,
    darkShadowScale: 0.86,
    lightShadowScale: 0.82,
    surfaceScale: 0.42,
    edgeWidthScale: 0.92,
  },
  C_DEEP_LIFT: {
    // Literal translation of the captured neumorphism.io 12px / 24px
    // reference proportions at the default state-view zoom.
    shadowOffsetPx: 12,
    shadowBlurPx: 24,
    shadowWidthPx: 26,
    darkShadowScale: 1,
    lightShadowScale: 1,
    surfaceScale: 0.55,
    edgeWidthScale: 1,
  },
};

const VARIANTS = new Set<RaisedStateVariant>([
  "A_SOFT_LIFT",
  "B_MATERIAL_LIFT",
  "C_DEEP_LIFT",
]);

export function raisedStateVariantFrom(
  value: string | null | undefined,
): RaisedStateVariant | null {
  return value && VARIANTS.has(value as RaisedStateVariant)
    ? (value as RaisedStateVariant)
    : null;
}

export function raisedStateVariantFromSearch(
  search: string,
  reviewMode = false,
): RaisedStateVariant | null {
  if (!reviewMode) return null;
  return raisedStateVariantFrom(new URLSearchParams(search).get("raisedState"));
}
