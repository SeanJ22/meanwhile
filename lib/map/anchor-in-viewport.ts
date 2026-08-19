/**
 * **A POPUP OPENS WHOLE, WHEREVER THE READER CLICKED** — F01 9.1, 2026-08-19.
 *
 * The author, clicking south of Vail: *"the 'Five districts here' pops below
 * where I can see. Obviously there is more. It says 'Five districts here' but
 * it's only showing me Empire Elementary District. You need to make sure that
 * it's visible no matter where I click on the screen."*
 *
 * ## The defect, exactly
 *
 * The district picker was positioned with `left: at.x; top: at.y` and nothing
 * else. That anchors its TOP-LEFT corner to the click, which is fine in the
 * top-left two thirds of a map and wrong everywhere else: a click 100px from
 * the bottom edge puts 240px of the box off-screen, and the reader sees a
 * header saying "5 districts here" over one visible row. The number and the
 * rendered rows disagree — which is the stated-N defect this codebase keeps
 * naming, arriving through CSS instead of through a count.
 *
 * ## Why a pure function
 *
 * The arithmetic is the whole fix and it is the sort of thing that is easy to
 * get subtly wrong at the edges (a box taller than the viewport, a click at
 * exactly 0, a container that is not the window). Kept here so it can be
 * tested at those edges without mounting a map — `tests/anchor-in-viewport.test.ts`
 * — and so the next surface that needs it uses this rather than a second copy.
 *
 * ## What it does NOT do
 *
 * It does not change dismissal (F01 8.1 governs that), it does not decide
 * whether the popup opens, and it never returns a position that hides the
 * anchor point itself under the box when it can avoid it: given room, the box
 * prefers to sit down-and-right of the click exactly as it did before, so the
 * common case looks identical and only the edges move.
 */

export interface AnchorBox {
  /** The click point, in the same coordinate space as the container. */
  x: number;
  y: number;
  /** The popup's measured size. Zero is treated as "not measured yet". */
  width: number;
  height: number;
  /** The space the popup must land inside. */
  containerWidth: number;
  containerHeight: number;
  /**
   * The offset the popup prefers from the click, when there is room. Matches
   * the `translate(12px, -12px)` the picker shipped with, expressed as data so
   * the clamp can account for it instead of fighting a transform it cannot see.
   */
  offsetX?: number;
  offsetY?: number;
  /** Breathing room kept between the popup and every container edge. */
  margin?: number;
}

export interface AnchorPosition {
  left: number;
  top: number;
  /**
   * The height the popup may actually use. Equal to its measured height in the
   * ordinary case; smaller only when the popup is taller than the container,
   * where something has to give and a scrollbar inside the box is the honest
   * answer — never a box that runs off the screen.
   */
  maxHeight: number;
}

export function anchorInViewport(box: AnchorBox): AnchorPosition {
  const margin = box.margin ?? 12;
  const offsetX = box.offsetX ?? 12;
  const offsetY = box.offsetY ?? -12;

  const available = Math.max(0, box.containerHeight - margin * 2);
  // A box taller than the space it must fit into cannot be placed whole. It is
  // capped and scrolls internally, which keeps the header and the first rows on
  // screen — the failure the author saw was the opposite, a box that simply
  // ran off and gave no way to reach the rest.
  const height = Math.min(box.height, available);
  const width = Math.min(box.width, Math.max(0, box.containerWidth - margin * 2));

  const clamp = (value: number, max: number) =>
    Math.max(margin, Math.min(value, max));

  return {
    left: clamp(box.x + offsetX, box.containerWidth - width - margin),
    top: clamp(box.y + offsetY, box.containerHeight - height - margin),
    maxHeight: height,
  };
}
