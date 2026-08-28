/**
 * **ONE BROWSER-MINTED CONTINUITY KEY IMPLEMENTATION — AND THE ONE THING IT
 * MUST NEVER DO.** (`NH79`, consolidated 2026-08-23. RULING 103.)
 *
 * `lib/feedback/client.ts` and `lib/reactions/client.ts` held byte-identical
 * copies of the minting and the get-or-create. This is the one audited copy.
 *
 * ## The consolidation that would have been a privacy defect
 *
 * Both files also held a module-level `memoryKey` — the fallback for a browser
 * that refuses `localStorage` (a private window, blocked site data). **Sharing
 * one module-level cell between the two callers would make the feedback key and
 * the reaction key THE SAME VALUE in that path**, and two identifier-free
 * stores holding one identical browser-minted value are two stores that join.
 * That is the `CLAUDE.md` n-stores rule broken by a tidy-up.
 *
 * So the fallback is a `Map` keyed by storage key, which reproduces the
 * per-module cell exactly, and `tests/browser-key.test.ts` asserts the two keys
 * differ **in both paths** — including the throwing one, which is the path that
 * would have silently merged them.
 *
 * ## What the key is, restated because it is easy to widen by accident
 *
 * A random 128-bit value the BROWSER mints, stored locally, sent so a person
 * can change their own answer. It relates one browser's rows to each other and
 * to nothing else: it is not an account, not a device id, not a fingerprint,
 * and it joins no other table. The server stores only a hash of it.
 */

/** Per-storage-key fallback, for a browser that refuses persistent storage. */
const memoryKeys = new Map<string, string>();

/** 128 bits from the platform CSPRNG, hex. Never a timestamp, never a counter. */
export function mintBrowserKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The shape a stored key must have to be reused rather than re-minted. */
const KEY_SHAPE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Read this caller's key, minting one on first use.
 *
 * `storageKey` is the caller's OWN `localStorage` key and is what keeps the
 * stores apart — `wtp.feedback_key` and `wtp.reaction_key` are different
 * strings holding independently random values, and nothing here can make them
 * the same.
 */
/**
 * **READ a caller's key. Never mint one.**
 * (PR #212 follow-up, 2026-08-28.)
 *
 * Ask needs this and the difference is not a detail. Its continuity key exists
 * to count DISTINCT READERS in a store that is not being written — the capture
 * ripcord ships pulled pending the author's approval of what a reader sees
 * before they type. Minting a new identifier onto somebody's device for a
 * capability that is switched off would be storing something new on a reader's
 * machine for no live purpose, and `tests/ask-box.test.ts` holds the map panel
 * to *"the ask box stores nothing on the device"* — a statement the
 * transparency page makes to readers.
 *
 * So Ask reads. An absent key is `null`, the request carries no continuity
 * value, and `captureAskInteraction` REFUSES to write a row without one rather
 * than digesting the empty string — which would give every reader the same hash
 * and quietly report one distinct reader forever.
 *
 * Minting for Ask is part of ACTIVATION, alongside the disclosure. It is not
 * something to do early and leave lying there.
 */
export function readBrowserKey(storageKey: string): string | null {
  try {
    const existing = window.localStorage.getItem(storageKey);
    return existing && KEY_SHAPE.test(existing) ? existing : null;
  } catch {
    return memoryKeys.get(storageKey) ?? null;
  }
}

export function getOrCreateBrowserKey(storageKey: string): string {
  try {
    const existing = window.localStorage.getItem(storageKey);
    if (existing && KEY_SHAPE.test(existing)) return existing;
    const minted = mintBrowserKey();
    window.localStorage.setItem(storageKey, minted);
    return minted;
  } catch {
    let fallback = memoryKeys.get(storageKey);
    if (fallback === undefined) {
      fallback = mintBrowserKey();
      memoryKeys.set(storageKey, fallback);
    }
    return fallback;
  }
}
