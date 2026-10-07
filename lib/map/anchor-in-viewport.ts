/**
 * A popup opens whole, wherever the reader clicked. Given room the box sits
 * down-and-right of the click; near an edge it is clamped inside the
 * container, so its header and rows are never partly off-screen. Pure, so the
 * edges (a box taller than the viewport, a click at 0) can be tested.
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
   * The height the popup may use: its measured height, or less when it is
   * taller than the container, in which case it scrolls internally.
   */
  maxHeight: number;
}

export function anchorInViewport(box: AnchorBox): AnchorPosition {
  const margin = box.margin ?? 12;
  const offsetX = box.offsetX ?? 12;
  const offsetY = box.offsetY ?? -12;

  const available = Math.max(0, box.containerHeight - margin * 2);
  // A box taller than its space is capped and scrolls, keeping the header and first rows on screen.
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
