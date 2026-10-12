/**
 * The browser-minted continuity key: a random 128-bit value the BROWSER mints,
 * stored locally, sent so a person can change their own answer. It relates one
 * browser's rows to each other and to nothing else — not an account, device id
 * or fingerprint — and the server stores only a hash of it.
 *
 * Each caller has its own storage key, and the fallback for a browser that
 * refuses `localStorage` is a `Map` keyed by storage key, so two callers'
 * keys never share a value in either path (two stores holding one value would
 * join).
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
 * Reads this caller's key, minting one on first use. `storageKey` is the
 * caller's OWN `localStorage` key and is what keeps the stores apart.
 */
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
