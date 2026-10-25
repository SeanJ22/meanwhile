import { pageWords } from "../control-plane/promotion/section3.ts";

/** Labels let a writer cite saved bytes without transcribing legal text. */
export function translationPassages(source: string) {
  const passages: { id: string; start: number; end: number; text: string }[] = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(source.length, start + 2000);
    if (end < source.length) {
      const paragraph = source.lastIndexOf("\n\n", end);
      const line = source.lastIndexOf("\n", end);
      const space = source.lastIndexOf(" ", end);
      if (paragraph > start + 1000) end = paragraph + 2;
      else if (line > start + 1000) end = line + 1;
      else if (space > start + 1000) end = space + 1;
      const before = source.charCodeAt(end - 1), after = source.charCodeAt(end);
      if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end--;
    }
    passages.push({ id: `p${passages.length}`, start, end, text: source.slice(start, end) });
    start = end;
  }
  return {
    prompt: JSON.stringify({ sourcePassages: passages.map(({ id, text }) => ({ id, text })) }),
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
