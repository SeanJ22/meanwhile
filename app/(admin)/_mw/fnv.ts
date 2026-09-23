/**
 * FNV-1a over a string, in base 36: a short, deterministic tag for an
 * idempotency key (the same answer to the same card hashes the same). Not a
 * security hash, and never used as one. One implementation for every control
 * that builds a key (RULING 103).
 */
export function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
