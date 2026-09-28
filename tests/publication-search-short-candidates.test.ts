import test from "node:test";
import assert from "node:assert/strict";
import {
  publicationHistoryExactGramPattern,
  publicationHistoryNeedsShortIndex,
  publicationHistoryShortGrams,
} from "../lib/control-plane/admin-view/publication-history-short.ts";

function allShortGrams(text: string): ReadonlySet<string> {
  const characters = Array.from(text);
  const grams = new Set(characters);
  for (let i = 0; i + 1 < characters.length; i++) grams.add(characters[i]! + characters[i + 1]!);
  return grams;
}

test("literal percent, underscore and backslash never become ILIKE wildcards", () => {
  assert.equal(publicationHistoryExactGramPattern("%_"), "\\%\\_");
  assert.equal(publicationHistoryExactGramPattern("\\a"), "\\\\a");
  assert.deepEqual(publicationHistoryShortGrams("%_a"), ["%_", "_a"]);
  assert.deepEqual(publicationHistoryShortGrams("🙂a"), ["🙂a"]);
  assert.deepEqual(publicationHistoryShortGrams("🙂"), ["🙂"]);
  assert.equal(publicationHistoryNeedsShortIndex("%_a"), true);
  assert.equal(publicationHistoryNeedsShortIndex("İ_🙂"), true);
  assert.equal(publicationHistoryNeedsShortIndex("John"), false);
  assert.equal(publicationHistoryNeedsShortIndex("abc%_"), false);
});

test("endpoint grams retain every exact short literal, including Unicode and a late matching record", () => {
  const alphabet = ["A", "a", "%", "_", "\\", "🙂", "İ", "i", "K", "k"];
  let checked = 0;
  const visit = (prefix: string, remaining: number): void => {
    if (prefix) {
      const indexed = allShortGrams(`before/${prefix}/after`);
      for (const gram of publicationHistoryShortGrams(prefix)) assert.ok(indexed.has(gram), JSON.stringify(prefix));
      checked++;
    }
    if (remaining === 0) return;
    for (const char of alphabet) visit(prefix + char, remaining - 1);
  };
  visit("", 4);
  assert.equal(checked, 11_110);

  const records = Array.from({ length: 3_001 }, (_, i) => i === 3_000
    ? "The last published record names %_🙂\\ precisely."
    : `Unrelated saved record ${i}`);
  const query = "%_🙂\\";
  const [first, last] = publicationHistoryShortGrams(query);
  const candidates = records.flatMap((record, index) => {
    const grams = allShortGrams(record);
    return grams.has(first!) && grams.has(last!) && record.includes(query) ? [index] : [];
  });
  assert.deepEqual(candidates, [3_000]);
});
