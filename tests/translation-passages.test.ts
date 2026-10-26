import assert from "node:assert/strict";
import test from "node:test";
import { translationPassages } from "../lib/translate/passages.ts";
import { decodedMeasurePassages } from "./helpers/measure-translation.ts";

test("passage labels retain every saved character and reconstruct contiguous citations without model transcription", () => {
  const source = `${"A legal condition applies. ".repeat(130)}\n\nAn exception follows.\n${"A further qualification applies. ".repeat(130)}`;
  const passages = translationPassages(source);
  const rows = decodedMeasurePassages(passages.prompt);
  assert.ok(rows.length > 2);
  assert.equal(rows.map(row => row.text).join(""), source);
  assert.equal(passages.quote(rows[0].id, rows.at(-1)!.id), source);
  assert.equal(passages.quote(rows[1].id, rows[2].id), rows[1].text + rows[2].text);
  for (const row of rows) assert.equal(passages.quote(row.id, row.id), row.text);
  for (const [from, through] of [["p999999", "p999999"], ["p2", "p0"], ["p00", "p1"], [null, "p1"], ["p0", "p1 trailing"]]) {
    assert.equal(passages.quote(from, through), null);
  }
});

test("a passage boundary never splits a Unicode character or rewrites PDF whitespace and entities", () => {
  const source = `${"a".repeat(1999)}😀\nA\tcondition&nbsp;applies.\r\n${"b".repeat(2300)}`;
  const passages = translationPassages(source);
  const rows = decodedMeasurePassages(passages.prompt);
  assert.equal(rows.map(row => row.text).join(""), source);
  assert.ok(rows.every(row => !/[\ud800-\udbff]$/.test(row.text) && !/^[\udc00-\udfff]/.test(row.text)));
  assert.equal(passages.quote("p0", rows.at(-1)!.id), source);
  const reference = passages.reference("A condition applies.");
  assert.ok(reference, "the held ballot's wording still locates PDF whitespace and HTML entities");
  assert.ok(passages.quote(reference.passageFrom, reference.passageThrough)?.includes("condition&nbsp;applies"));
  assert.deepEqual(passages.reference(source), { passageFrom: "p0", passageThrough: rows.at(-1)!.id });
});

test("repeated ballot styles reuse exact passages without losing a changed qualification or any original position", () => {
  const legal = "The measure authorizes a levy for library services, subject to the stated annual rate and renewal dates. ".repeat(50);
  const source = Array.from({ length: 40 }, (_, index) => `[Page ${index + 1}] Precinct ${index + 100}. ${legal}${index === 19 ? "Only households below the stated income threshold qualify for the exemption. " : ""}End of ballot style ${index + 1}.\n`).join("");
  const passages = translationPassages(source);
  const rows = decodedMeasurePassages(passages.prompt);
  const encoded = JSON.parse(passages.prompt).sourcePassages as { id: string; text?: string; sameAs?: string }[];
  assert.equal(rows.map(row => row.text).join(""), source);
  assert.equal(passages.quote("p0", rows.at(-1)!.id), source);
  assert.ok(passages.prompt.includes("Only households below the stated income threshold"));
  assert.ok(passages.prompt.length < source.length / 2, "identical legal text is not billed once per ballot style");
  const copy = encoded.findIndex(row => row.sameAs);
  assert.ok(copy >= 0 && copy + 1 < rows.length);
  assert.equal(passages.quote(rows[copy].id, rows[copy].id), rows[copy].text);
  assert.equal(passages.quote(rows[copy].id, rows[copy + 1].id), rows[copy].text + rows[copy + 1].text);
});
