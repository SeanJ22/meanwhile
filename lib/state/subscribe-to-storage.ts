/**
 * One `useSyncExternalStore` subscriber and publisher, shared by every
 * browser-stored value. Each hook keeps its OWN listener set, so a write wakes
 * only the components reading that value.
 *
 * - `subscribeToStorage` / `publishToListeners` — a module-level listener set.
 * - `subscribeToStorageEvent` / `publishStorageEvent` — a same-tab DOM event,
 *   for stores read from components that cannot import a set.
 * - `commitStorageWrite` — write-then-publish, with the ordering taken out of
 *   the call sites.
 */

/**
 * Subscribe `onStoreChange` to a local listener set and to cross-tab `storage`
 * events. `storage` never fires in the tab that wrote, so both are needed.
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

/**
 * Tell a listener set its store moved. A copy of the set is iterated, so a
 * subscriber that unsubscribes while being notified cannot cost a later
 * listener its notification.
 */
export function publishToListeners(listeners: Set<() => void>): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Subscribe to a same-tab DOM event AND to cross-tab `storage`, for stores
 * whose writer and readers do not share a module.
 */
export function subscribeToStorageEvent(
  eventName: string,
  onStoreChange: () => void,
): () => void {
  window.addEventListener(eventName, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(eventName, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

/** Announce a same-tab change on a DOM event. Guarded on `window`: in Node there is no subscriber. */
export function publishStorageEvent(eventName: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(eventName));
}

/**
 * Run a browser-storage mutation and publish it, in that order, ALWAYS. The
 * publish is never inside the mutation's `try`, so a refused write that falls
 * back to memory is still announced.
 *
 * `mutate` may throw (private windows, blocked site data, a full quota);
 * `onRefused` lets a caller keep the choice for this page's life. There is no
 * return value on purpose: callers must not branch on whether the write landed.
 */
export function commitStorageWrite(
  mutate: () => void,
  publish: () => void,
  onRefused?: () => void,
): void {
  try {
    mutate();
  } catch {
    onRefused?.();
  }
  publish();
}
