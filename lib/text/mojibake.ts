/**
 * Mojibake detection: one definition of "this string was decoded wrong",
 * shared by the guard test and anything that writes reader-facing text. The
 * common case is UTF-8 bytes read back as cp1252 (an em-dash becoming three
 * characters). It is checked at the data, never patched at the render.
 */

/**
 * The signature: a UTF-8 lead byte landing as a cp1252/latin-1 character,
 * followed by one or two continuation bytes from the same high range.
 * Anchored on real sequences so legitimate non-ASCII (accents, →, ×, —) passes.
 */
const LEAD = "[\\u00c2\\u00c3\\u00e2\\u00e3\\u00f0\\u00f1]";
const TAIL = "[\\u0080-\\u00bf\\u2010-\\u203a\\u20ac\\u2122]";
const MOJIBAKE_SOURCE = `${LEAD}${TAIL}${TAIL}?`;

/**
 * A FRESH regex every call: a shared `/g` regex carries `lastIndex` between
 * calls and makes the next match start mid-string.
 */
export const mojibakePattern = (): RegExp => new RegExp(MOJIBAKE_SOURCE, "g");

/** Every mojibake sequence in a string, with where it sits. */
export function findMojibake(
  text: string,
): Array<{ at: number; sequence: string; context: string }> {
  const hits: Array<{ at: number; sequence: string; context: string }> = [];
  for (const m of text.matchAll(mojibakePattern())) {
    const at = m.index ?? 0;
    hits.push({
      at,
      sequence: m[0],
      context: text.slice(Math.max(0, at - 40), at + 40).replace(/\s+/g, " "),
    });
  }
  return hits;
}

export function hasMojibake(text: string): boolean {
  return mojibakePattern().test(text);
}

/**
 * Undo a cp1252-decoded-UTF-8 round trip, one matched sequence at a time: each
 * match is re-encoded to the cp1252 bytes it came from and decoded as UTF-8.
 *
 * Per match, because a corrupted string can also hold good characters; the
 * whole-string inverse would turn a good em-dash into U+FFFD. For repairing
 * stored data only; never wired into a render path.
 */
const CP1252_HIGH: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84,
  "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88,
  "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c,
  "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93,
  "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
  "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b,
  "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

export function repairMojibake(text: string): string {
  return text.replace(mojibakePattern(), (sequence) => {
    const bytes: number[] = [];
    for (const ch of sequence) {
      const cp = ch.codePointAt(0)!;
      const byte = cp < 0x100 ? cp : CP1252_HIGH[ch];
      // A character in the sequence that cp1252 cannot produce means this
      // is not the corruption we know how to undo. Leave it alone rather
      // than guess — a wrong repair is worse than a visible defect.
      if (byte === undefined) return sequence;
      bytes.push(byte);
    }
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(
      new Uint8Array(bytes),
    );
    // A decode that produced a replacement character did not recover
    // anything; keep the original so the guard still reports it.
    return decoded.includes("�") ? sequence : decoded;
  });
}
