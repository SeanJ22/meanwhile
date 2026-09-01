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
 *
 * ## THE PUBLISH HALF LIVES HERE TOO. (`WGH-22` class audit, 2026-08-31.)
 *
 * `WGH-22` was one store that wrote without telling its subscribers, and the
 * fix landed at that one store. The class audit that followed found this file
 * owned only HALF the contract: it knew how to subscribe, and every one of the
 * nine subscribed stores hand-wrote its own publish — seven as a copy of
 * `for (const listener of listeners) listener();`, two as a bare
 * `window.dispatchEvent`. **A contract with one half shared and one half copied
 * nine times is the shape a missed notification hides in**, because the half
 * that can be forgotten is the half nobody shares.
 *
 * So subscribe and publish are now the same module, in matched pairs:
 *
 * - `subscribeToStorage` / `publishToListeners` — a module-level listener set.
 * - `subscribeToStorageEvent` / `publishStorageEvent` — a same-tab DOM event,
 *   for stores read from components that cannot import a set (the ballot picks
 *   file and the device's own reaction record).
 * - `commitStorageWrite` — the ORDERING, taken out of the call sites entirely.
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

/**
 * Tell a listener set its store moved. The same-tab half of the pair above.
 *
 * A copy of the set is iterated, so a subscriber that unsubscribes while being
 * notified — a component unmounting on the very change it was told about —
 * cannot mutate the set mid-iteration and cost a later listener its
 * notification.
 */
export function publishToListeners(listeners: Set<() => void>): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Subscribe to a same-tab DOM event AND to cross-tab `storage`.
 *
 * The listener-set pairing above needs the writer and the reader to share a
 * module. Two stores cannot: `wtp.ballot_picks` and `wtp.reactions` are written
 * in `lib/` and read from three components each, and a DOM event is how a
 * component subscribes without importing the set. Both halves are still
 * load-bearing for the same reason — `storage` never fires in the tab that
 * wrote.
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

/**
 * Announce a same-tab change on a DOM event.
 *
 * Guarded on `window` because the reaction store is exercised in Node by the
 * suite, where the write falls to an in-memory map and there is nothing to
 * dispatch on. The signal is a browser convenience; its absence in Node is not
 * a missed notification, because in Node there is no subscriber.
 */
export function publishStorageEvent(eventName: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(eventName));
}

/**
 * **A WRITE THAT NOBODY IS TOLD ABOUT IS NOT A WRITE.** (`WGH-22`, 2026-08-31.)
 *
 * Run a browser-storage mutation and publish it, in that order, ALWAYS — and
 * take the ordering away from the call site, because the ordering is the part
 * that gets it wrong. Two failure shapes were live in this tree, and both are
 * ordering rather than logic:
 *
 * - **The publish inside the `try`.** `lib/ballot/picks.ts` dispatched its
 *   change event on the line after `setItem`, inside the same `try`. A store
 *   that refuses the write skips the announcement with it. Nothing had changed
 *   in that case, so no reader was lied to yet — but the next writer to add an
 *   in-memory fallback in the `catch` (three stores in this tree already have
 *   one) would have inherited a silent write and had no reason to look.
 * - **The publish that is simply absent**, which is `WGH-22` itself.
 *
 * `mutate` may throw and the store is expected to refuse sometimes: private
 * windows, blocked site data, a full quota. `onRefused` is where a caller keeps
 * the choice for this page's life so the session still works. `publish` runs
 * either way, because a store that fell back to memory has still moved and a
 * store that did not has subscribers whose re-read is a harmless no-op.
 *
 * There is no return value on purpose. A caller that branched on "did the write
 * land" would be reintroducing the decision this function exists to remove.
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
