"use client";

import { useEffect, type RefObject } from "react";

/**
 * A press anywhere outside the element dismisses it, in addition to its
 * explicit control. No history entry is pushed. The listener is `pointerdown`
 * in the capture phase, so it runs before MapLibre's handler and any
 * `stopPropagation` in the card, and it fires on press, as native sheets do.
 * `active` gates the listener.
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
