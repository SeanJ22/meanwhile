/**
 * **ONE `useSyncExternalStore` SUBSCRIBER, SHARED BY EVERY BROWSER-STORED
 * VALUE.** (`NH79`, consolidated 2026-08-23. RULING 103.)
 *
 * Six byte-identical copies of this callback existed — in
 * `components/map/tutorial-overlay.tsx`, `hooks/use-district-layer.ts`,
 * `hooks/use-narrowing.ts`, `hooks/use-recent-zips.ts`,
 * `hooks/use-stored-theme.ts` and `hooks/use-stored-zip.ts`. It was the largest
 * duplicate group in the tree and the one most likely to drift, because a fix
 * to one is invisible from the other five.
 *
 * Each hook keeps its OWN listener set. That is not incidental: the sets are
 * what make a write to one stored value notify only the components reading that
 * value, and merging them into one global set would wake every stored-value
 * hook on every write. The duplication was in the WIRING, never in the state.
 */

/**
 * Subscribe `onStoreChange` to a local listener set and to cross-tab
 * `storage` events.
 *
 * The `storage` event is what keeps two tabs in step: it fires in every OTHER
 * tab when one writes, and it does not fire in the tab that wrote — which is
 * why the local listener set is needed as well and why neither half can be
 * dropped as redundant.
 */
export function subscribeToStorage(
  listeners: Set<() => void>,
  onStoreChange: () => void,
): () => void {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}
