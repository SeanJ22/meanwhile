"use client";

import { useEffect, type RefObject } from "react";

/**
 * Native-sheet dismissal: a press anywhere outside the element dismisses it.
 *
 * The author's mobile pass, 2026-08-15 — "that's natural mobile behavior."
 * Every card on the map already had an explicit control; none of them had the
 * gesture a phone reader reaches for first, which is to tap the thing they
 * were looking at before. The explicit control STAYS: this is an additional
 * way out, never a replacement, because a gesture nobody discovers is not an
 * exit at all.
 *
 * Three things it deliberately does NOT do:
 *
 * - **No history entry.** M52: an overlay that pushes history state gets its
 *   island remounted by the Next router and dies on open. Dismissal here is
 *   pure React state, exactly as the explicit control already was.
 * - **No `click`.** The listener is `pointerdown` in the CAPTURE phase, so it
 *   sees the press before MapLibre's canvas handler runs and before any
 *   `stopPropagation` inside the card's own tree. A `click` listener misses a
 *   drag that starts outside and ends inside, which is exactly a map pan.
 * - **No dismissal on a drag.** A press that begins on the map and turns into
 *   a pan is browsing, not a dismissal — but the press itself already landed
 *   outside, so this fires on press. That is the native behavior: iOS sheets
 *   dismiss on touch-down outside, not on touch-up.
 *
 * `active` gates the listener rather than the caller unmounting the hook, so
 * a card that is rendered-but-collapsed costs nothing.
 */
export function useDismissOnOutside(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  active = true,
) {
  useEffect(() => {
    if (!active) return;

    const onPointerDown = (event: PointerEvent) => {
      const node = ref.current;
      if (!node) return;
      const target = event.target as Node | null;
      if (!target) return;
      // A press inside the card, or inside anything the card portalled
      // (a dialog it opened), is not an outside press.
      if (node.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest("[data-dismiss-exempt]") !== null
      ) {
        return;
      }
      onDismiss();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [ref, onDismiss, active]);
}
