/**
 * An address, once given, is never asked for twice: the resolved outcome
 * persists for the session and answers every surface.
 *
 * - Nothing reaches the server or disk. Storage is `sessionStorage`, cleared
 *   when the tab closes.
 * - The street address and coordinates are never written; only the resolved
 *   outcome (contest and division ids) and a short label the reader typed.
 *   The house number is used for one request and discarded.
 */

import {
  commitStorageWrite,
  publishToListeners,
  subscribeToStorage,
} from "@/lib/state/subscribe-to-storage";

/** The one key. Named so it is greppable and so nothing else claims it. */
export const SESSION_ADDRESS_KEY = "wtp.session_address_scope";

/**
 * Same-tab subscribers. `sessionStorage` fires `storage` only in other tabs,
 * so the two writers here publish to local listeners themselves.
 */
const listeners = new Set<() => void>();

/**
 * Subscribe to changes, for `useSyncExternalStore`: local listeners carry
 * same-tab writes and the `storage` event carries cross-tab ones.
 */
export function subscribeToSessionAddress(onStoreChange: () => void): () => void {
  return subscribeToStorage(listeners, onStoreChange);
}

/** Tell every subscriber the scope moved. Called by both writers, always. */
function publish(): void {
  publishToListeners(listeners);
}

export interface SessionAddressScope {
  /** The zip the address was resolved inside. */
  zip: string;
  /** Contest ids on the ballot at that point. The whole payload's value. */
  contestIds: string[];
  /** What the reader typed for the street, for their own recognition only. */
  streetLabel: string;
  /** The division ids the address confirmed, across every level that resolved. */
  divisionIds: string[];
  /**
   * Levels the street genuinely crosses, so a surface can keep hedging exactly
   * those rows and nothing else. Partial ambiguity resolves partially.
   */
  splitLevels: string[];
  /** When it was resolved, so a surface can say "you told us this" honestly. */
  resolvedAt: string;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Private modes and webviews can throw on access; that means no session address.
    return null;
  }
}

/** Read the session's resolved address scope, or null. Never throws. */
export function readSessionAddress(): SessionAddressScope | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(SESSION_ADDRESS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionAddressScope>;
    if (
      typeof parsed.zip !== "string" ||
      !Array.isArray(parsed.contestIds) ||
      typeof parsed.resolvedAt !== "string"
    ) {
      return null;
    }
    return {
      zip: parsed.zip,
      contestIds: parsed.contestIds.filter((id): id is string => typeof id === "string"),
      divisionIds: Array.isArray(parsed.divisionIds)
        ? parsed.divisionIds.filter((id): id is string => typeof id === "string")
        : [],
      splitLevels: Array.isArray(parsed.splitLevels)
        ? parsed.splitLevels.filter((id): id is string => typeof id === "string")
        : [],
      streetLabel: typeof parsed.streetLabel === "string" ? parsed.streetLabel : "",
      resolvedAt: parsed.resolvedAt,
    };
  } catch {
    return null;
  }
}

/** Write it. `resolvedAt` is the browser's clock: a fact about the reader's own session. */
export function writeSessionAddress(scope: Omit<SessionAddressScope, "resolvedAt">): void {
  const store = storage();
  if (!store) return;
  // `commitStorageWrite` writes, then publishes either way; a refused store
  // costs the reader a second prompt, never an error.
  commitStorageWrite(
    () =>
      store.setItem(
        SESSION_ADDRESS_KEY,
        JSON.stringify({ ...scope, resolvedAt: new Date().toISOString() }),
      ),
    publish,
  );
}

/** Forget it. The reader asking to see the whole zip again is asking for this. */
export function clearSessionAddress(): void {
  const store = storage();
  if (!store) return;
  // Clearing widens every surface, not just the control clicked.
  commitStorageWrite(() => store.removeItem(SESSION_ADDRESS_KEY), publish);
}

/**
 * Does the session hold an address that answers for this zip? An address in
 * one zip answers nothing about another.
 */
export function sessionAddressFor(zip: string | null): SessionAddressScope | null {
  if (!zip) return null;
  const scope = readSessionAddress();
  return scope && scope.zip === zip ? scope : null;
}
