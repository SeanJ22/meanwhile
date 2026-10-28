import { pageWords } from "../control-plane/promotion/section3.ts";

/** Labels let a writer cite saved bytes without transcribing legal text. */
export function translationPassages(source: string) {
  const passages: { id: string; start: number; end: number; text: string }[] = [];
  let start = 0, hash = 0, oldestFactor = 1;
  for (let index = 0; index < 32; index++) oldestFactor = Math.imul(oldestFactor, 31);
  for (let index = 0; index < source.length; index++) {
    // The last 32 characters choose boundaries, so a changed ballot-style
    // header does not shift every following copy of the same legal passage.
    hash = Math.imul(hash, 31) + source.charCodeAt(index);
    if (index >= 32) hash -= Math.imul(source.charCodeAt(index - 32), oldestFactor);
    hash >>>= 0;
    let end = index + 1;
    const length = end - start;
    const boundary = /\s/.test(source[index]) && (/[.!?]/.test(source[index - 1] ?? "") || (hash & 63) === 0);
    if (end < source.length && length < 2000 && !(length >= 256 && boundary)) continue;
    if (end < source.length) {
      if (length >= 2000) {
        const space = source.lastIndexOf(" ", end - 1);
        if (space > start + 1000) end = space + 1;
      }
      const before = source.charCodeAt(end - 1), after = source.charCodeAt(end);
      if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end--;
    }
    passages.push({ id: `p${passages.length}`, start, end, text: source.slice(start, end) });
    start = end;
  }
  const first = new Map<string, string>();
  const encoded = passages.map(({ id, text }) => {
    const sameAs = first.get(text);
    if (sameAs) return { id, sameAs };
    first.set(text, id);
    return { id, text };
  });
  return {
    prompt: JSON.stringify({ ...(encoded.some(row => row.sameAs) ? {
      passageCopies: "sameAs repeats the exact text of that earlier passage. All passages remain in original order, including every variation; each p-number still cites its original position.",
    } : {}), sourcePassages: encoded }),
    reference(quote: string | undefined) {
      if (!quote?.trim()) return null;
      const at = source.indexOf(quote);
      if (at >= 0 && source.indexOf(quote, at + 1) < 0) {
        const first = passages.find(row => row.end > at), last = passages.find(row => row.end >= at + quote.length);
        if (first && last) return { passageFrom: first.id, passageThrough: last.id };
      }
      const needle = pageWords(quote);
      if (!needle) return null;
      const words = passages.map(row => pageWords(row.text));
      const joined = words.join(" "), start = joined.indexOf(needle);
      if (start < 0 || joined.indexOf(needle, start + 1) >= 0) return null;
      let offset = 0, first: string | null = null;
      for (let index = 0; index < words.length; index++) {
        const end = offset + words[index].length;
        if (first === null && end > start) first = passages[index].id;
        if (first !== null && end >= start + needle.length) return { passageFrom: first, passageThrough: passages[index].id };
        offset = end + 1;
      }
      return null;
    },
    quote(from: unknown, through: unknown): string | null {
      if (typeof from !== "string" || typeof through !== "string" || !/^p(?:0|[1-9]\d*)$/.test(from) || !/^p(?:0|[1-9]\d*)$/.test(through)) return null;
      const first = Number(from.slice(1)), last = Number(through.slice(1));
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last < first || !passages[first] || !passages[last]) return null;
      return source.slice(passages[first].start, passages[last].end);
    },
  };
}
