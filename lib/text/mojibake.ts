/**
 * Mojibake detection — one definition of "this string was decoded wrong",
 * shared by the guard test and anything that writes reader-facing text (M60,
 * 2026-08-15).
 *
 * The defect the author caught in production: every candidate blurb's
 * attribution line rendered `From the candidate's site â€" cindewarmington.com`.
 * That is a single em-dash (U+2014, UTF-8 `E2 80 94`) whose bytes were read
 * back as cp1252 — `E2`→â, `80`→€, `94`→" — and re-encoded as UTF-8. One
 * operation in the 2026-08-14 photo session round-tripped
 * `data/ballot/candidate-cards-2026.json` through such a decode and turned
 * all 28 of its em-dashes, plus 130 newly written ones, into that sequence;
 * `docs/photo-report.md` inherited 34 of them because its candidate-cards
 * section is generated from that file. No committed script does this — every
 * one of them reads and writes UTF-8 through Node — so the cause was an
 * ad-hoc shell round trip, which is exactly the class of thing a guard has to
 * catch, because the next one will be ad-hoc too.
 *
 * Running the check over the whole repo found two more the author had not
 * reported and nothing else would have: `Â»` in scraped meeting text, and
 * `CÃ­R` — Cír, the Tucson street abbreviation — in eight street-index files.
 *
 * The rule this module exists to enforce: **no reader-facing string carries
 * a mojibake signature.** It is checked at the data, never patched at the
 * render — a display-time substitution would leave the stored text wrong and
 * make every later reader of that file wrong with it.
 */

/**
 * The signature. A UTF-8 lead byte landing as a cp1252/latin-1 character,
 * followed by one or two continuation bytes from the same high range.
 *
 * Deliberately anchored on real sequences rather than "any high character":
 * this repo's data is full of legitimate non-ASCII — Andrés, Hernández,
 * Muñoz, →, ×, — — and a check that flags those is a check nobody can keep.
 */
const LEAD = "[\\u00c2\\u00c3\\u00e2\\u00e3\\u00f0\\u00f1]";
const TAIL = "[\\u0080-\\u00bf\\u2010-\\u203a\\u20ac\\u2122]";
const MOJIBAKE_SOURCE = `${LEAD}${TAIL}${TAIL}?`;

/**
 * A FRESH regex every call, never a shared global one.
 *
 * `RegExp.prototype.test` on a `/g` regex advances `lastIndex`, so a shared
 * instance makes the next `matchAll` start mid-string and find nothing —
 * `hasMojibake()` returning true while `findMojibake()` returned zero hits.
 * This module lied to its own test that way before the tests were run.
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
 * Undo a cp1252-decoded-UTF-8 round trip, **one matched sequence at a time**.
 *
 * Each match is re-encoded to the cp1252 bytes it came from and decoded as
 * UTF-8 — the inverse of the corruption, derived rather than a lookup table
 * of the sequences we happen to have seen.
 *
 * Per-match, and that is the whole subtlety: the corrupted file is MIXED. It
 * carried 158 broken em-dashes and 32 perfectly good ones written after the
 * bad operation. Running the inverse over the whole string re-encodes those
 * good em-dashes to a lone `0x97`, which is not valid UTF-8 on its own, and
 * they come back as U+FFFD — a repair that quietly destroys 32 characters
 * while reporting success. (Caught by asserting the em-dash count moved by
 * exactly the number of sequences removed. It had not: 32 + 158 should have
 * been 190 and the whole-string inverse produced 158.)
 *
 * Used to repair stored data once, by `scripts/repair-mojibake.mts`. It is
 * NOT wired into any render path: a repair that runs at display time hides
 * the corruption instead of removing it, and the next process to read the
 * file gets the broken bytes.
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
