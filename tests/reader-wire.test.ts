import assert from "node:assert/strict";
import test from "node:test";
import { encodeReaderValue, decodeReaderValue } from "../lib/reader/wire.ts";
import { readReaderJson } from "../lib/reader/bootstrap.ts";

test("member source links travel once and regain their exact quotes before the reader uses them", async () => {
  const sourceUrl = `https://webapi.legistar.com/v1/example/officerecords?${"long-source-filter".repeat(30)}`;
  const source = { sourceUrl, collectedAt: "2026-10-23", quote: "HENRY FRIES" };
  const value = { coverage: { bodies: [{ readerRoster: { members: Array.from({ length: 37 }, (_, index) => ({
    name: `Member ${index}`, id: `member:${index}`, office: "Member", fieldSources: { name: source, termStart: source }, membershipSource: source,
  })) } }] }, stateResponse: { value: { source } } };
  const encoded = JSON.stringify(encodeReaderValue(value));
  assert.equal(encoded.split(sourceUrl).length - 1, 1);
  assert.ok(encoded.length < JSON.stringify(value).length / 5);
  assert.deepEqual(decodeReaderValue(JSON.parse(encoded)), value);
  assert.deepEqual(await readReaderJson(new Response(encoded)), value);
  assert.equal(value.coverage.bodies[0].readerRoster.members[0].fieldSources.name.quote, "HENRY FRIES");
});

test("reader dictionaries refuse missing, negative and noninteger references", () => {
  for (const index of [-1, 1, 0.5, "0"]) {
    assert.throws(() => decodeReaderValue({ readerTexts: ["source"], held: { $readerText: index } }), /Invalid reader text reference/);
    assert.throws(() => decodeReaderValue({ readerTexts: [], readerSources: [{}], held: { $readerSource: index } }), /Invalid reader source reference/);
  }
  assert.throws(() => decodeReaderValue({ readerTexts: [], readerShapes: [["name", "office"]], held: { $readerObject: [0, "one value"] } }), /Invalid reader object reference/);
});
