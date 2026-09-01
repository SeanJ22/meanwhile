/**
 * **RULING 74 — AN ADDRESS, ONCE GIVEN, IS NEVER ASKED FOR TWICE.**
 * (NJ Hunt 3 item 3.6b, 2026-08-22.)
 *
 * Wherever a reader supplies an address — the who-governs surface, the
 * polling-place surface, the ballot, anywhere — it persists for the rest of
 * that SESSION and resolves every surface that could have used it. Asking twice
 * for the same fact is a frustration the product manufactures itself, and it
 * reads as a product that is not paying attention.
 *
 * ## WHAT IS STORED, EXACTLY, AND WHERE
 *
 * This is the part that matters most, so it is stated plainly rather than
 * implied by the code:
 *
 * - **Nothing reaches the server, and nothing reaches disk.** No column on the
 *   search log, no column on the reactions store, no row anywhere. The
 *   collection minimum in `CLAUDE.md` is unchanged by this file — it adds no
 *   field to the user model and creates no table.
 * - **The storage is `sessionStorage`**, which the browser clears when the tab
 *   closes. Not `localStorage`, which survives; not a cookie, which would be
 *   sent to the server on every request and would therefore reach access logs.
 * - **The street address itself is NEVER written.** What is written is the
 *   RESOLVED OUTCOME: the contest ids the point produced, and a short label the
 *   reader typed for their own recognition. The house number is used for one
 *   request and discarded, exactly as `ballot-narrowing.tsx` already discarded
 *   it. A resolved contest list cannot be walked back to a house.
 * - **The coordinates are not written either.** They are the one derived value
 *   that would locate a home, and no surface needs them after the contest list
 *   exists.
 *
 * The claim that survives a hostile reader is *the schemas share no joinable
 * column* — which is architecture, not a policy promise. A session-scoped
 * resolution keeps that claim exactly as it is, because it never becomes a row.
 *
 * ## Why a resolved list rather than the address
 *
 * Because re-resolving would mean re-asking the geocoder on every surface, and
 * because storing the thing that identifies a person in order to avoid asking
 * for it twice would trade a small friction for the exact retention this
 * product refuses. The outcome is the useful part; the input is the sensitive
 * part; only the outcome is kept.
 */

import {
  commitStorageWrite,
  publishToListeners,
  subscribeToStorage,
} from "@/lib/state/subscribe-to-storage";

/** The one key. Named so it is greppable and so nothing else claims it. */
export const SESSION_ADDRESS_KEY = "wtp.session_address_scope";

/**
 * **A WRITE THAT NOBODY IS TOLD ABOUT IS NOT A WRITE.** (WGH-22, 2026-08-31.)
 *
 * This is the fourth appearance of one defect (WGH-12 and WGH-15 on 8/28,
 * WGH-22 on 8/30 and again on 8/31), and the first time the notification
 * itself is the thing being fixed. Every previous pass corrected what the
 * panel DERIVED from the scope. The scope was correct each time. It simply
 * never arrived.
 *
 * The seam: `sessionStorage` fires a `storage` event in every OTHER tab and
 * NEVER in the tab that performed the write. A surface reading this store
 * through `useSyncExternalStore` therefore hears nothing when the reader
 * confirms an address in that same tab — which is the only tab a reader ever
 * uses. The address control re-rendered because it had just made the request
 * and held the answer in its own state; the who-governs panel two components
 * away was never told, and went on rendering the ZIP-level districts under a
 * banner announcing the confirmed ones.
 *
 * So the local listener set lives HERE, at the store boundary, rather than in
 * the hook that reads it. `writeSessionAddress` and `clearSessionAddress` are
 * the only two writers, and both now publish. A future third writer gets the
 * notification by construction instead of by remembering — which is the part
 * `use-stored-zip` got right and this file did not.
 */
const listeners = new Set<() => void>();

/**
 * Subscribe to changes in the session address, for `useSyncExternalStore`.
 *
 * Both halves are load-bearing and neither is redundant: the local set carries
 * same-tab writes (the reader confirming an address), and the `storage` event
 * carries cross-tab ones. `subscribeToStorage` wires both.
 */
export function subscribeToSessionAddress(onStoreChange: () => void): () => void {
  return subscribeToStorage(listeners, onStoreChange);
}

/**
 * Tell every subscriber the scope moved. Called by the two writers, always.
 *
 * The loop moved to `publishToListeners` in the `WGH-22` class audit: seven
 * stores held a byte-identical copy of it, and the copy is what let one store
 * ship without one.
 */
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
  /**
   * The division ids the address CONFIRMED, across every level that resolved.
   *
   * Added for WGH-5 (2026-08-22). The scope used to carry contests only, which
   * meant the who-governs card and the meeting pill could not use it — they ask
   * about jurisdictions, not about a ballot. One address, resolved once, now
   * answers for every surface. RULING 74 is the reason: an address, once given,
   * is never asked for twice, and "never asked twice" was only true of the one
   * surface that happened to store its own answer.
   */
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
    // Private modes and embedded webviews can throw on access rather than
    // return null. A store we cannot reach means no session address, which is
    // the same as never having been given one — never an error to the reader.
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

/**
 * Write it. Called once, by whichever surface the reader happened to use.
 *
 * `resolvedAt` is taken from the browser's clock rather than passed in: this is
 * a client-side fact about the reader's own session, not a stamp entering a
 * document, so the date rule in `CLAUDE.md` — which governs dates written into
 * this repo's records — is not what is in play here. Nothing here is a record.
 */
export function writeSessionAddress(scope: Omit<SessionAddressScope, "resolvedAt">): void {
  const store = storage();
  if (!store) return;
  // The ordering — write, then publish, publish either way — is
  // `commitStorageWrite`'s and not this file's. A full or refused store costs
  // the reader a second prompt, never an error; the one thing that must never
  // happen is a successful write with no publish.
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
  // The reader asking to see the whole zip again is asking every surface to
  // widen, not just the control they clicked. RULING 222's scope runs both
  // directions: the panel narrows on a write and widens on a clear.
  commitStorageWrite(() => store.removeItem(SESSION_ADDRESS_KEY), publish);
}

/**
 * Does the session hold an address that answers for THIS zip?
 *
 * A reader who resolved an address in 07866 and then looks at 03255 has not
 * answered anything about 03255, and treating the two as one would be the
 * product asserting a location the reader never gave it.
 */
export function sessionAddressFor(zip: string | null): SessionAddressScope | null {
  if (!zip) return null;
  const scope = readSessionAddress();
  return scope && scope.zip === zip ? scope : null;
}
