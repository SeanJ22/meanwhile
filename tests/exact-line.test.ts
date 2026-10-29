import assert from "node:assert/strict";
import test from "node:test";
import { door } from "../lib/core/door.ts";
import { checkFact, exactLine, lineOf, type SavedCopy } from "../lib/facts/check.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import type { PublishInput } from "../lib/facts/publish.ts";
import { factDb } from "./helpers/fact-db.ts";

const now = new Date("2026-10-24T08:00:00Z");
const clocks = factClocks(null);
const copyOf = (text: string): SavedCopy => ({ id: 1, finalUrl: "https://example.gov/api", text, fetchedAt: now, isArchive: false });
const example = { id: "e", fullName: "Example", stateName: null, hosts: [], externalIds: [] };

test("an API or filing copy quotes the exact field text: the JSON pair, the XML element or the CSV row", () => {
  const json = '{\n  "filer": "Citizens for Example",\n  "amount": 113895,\n  "memo": "amount 113895 raised"\n}';
  assert.equal(exactLine(json, "amount", "113895"), '"amount": 113895');
  assert.equal(exactLine(json, "filer", "Citizens for Example"), '"filer": "Citizens for Example"');
  assert.equal(exactLine(json, "amount", "11389"), null, "a number the field does not hold is not the field");
  assert.equal(exactLine('[{"name":"Ann \\"A\\" Lee"}]', "name", 'Ann "A" Lee'), '"name":"Ann \\"A\\" Lee"');
  assert.equal(exactLine("<r><amount>113895</amount><note>x</note></r>", "amount", "113895"), "<amount>113895</amount>");
  assert.equal(exactLine("<name>Fish &amp; Game</name>", "name", "Fish & Game"), "<name>Fish &amp; Game</name>");
  const csv = 'id,name,amount\n1,"Lee, Ann",500\n2,Bo Day,113895\n3,Cy Fox,1138951\n';
  assert.equal(exactLine(csv, "amount", "113895"), "2,Bo Day,113895");
  assert.equal(exactLine(csv, "name", "Lee, Ann"), '1,"Lee, Ann",500');
  assert.equal(exactLine(csv, "amount", "1138"), null);
  assert.equal(exactLine(csv, "missing", "500"), null);
  for (const text of [json, csv]) {
    const quote = exactLine(text, "amount", "113895")!;
    assert.equal(checkFact({ entity: example, fieldKind: "money", provenance: "FILING", valueText: "113895", quote, copy: copyOf(text) }, now, clocks.windowHours).ok, true);
  }
});

test("a page quotes its own line, cut to the words around a value on a long line, and nothing when it does not show the value", () => {
  const page = copyOf("Council meets monthly.\nSUMMARY:Regular Council Meeting\r\nLOCATION:1415 W Melody Ln");
  assert.equal(lineOf(page, "Regular Council Meeting"), "SUMMARY:Regular Council Meeting");
  assert.equal(lineOf(page, "Special Meeting"), null);
  const long = copyOf(`${"word ".repeat(200)}Budget Hearing ${"more ".repeat(200)}`);
  const quote = lineOf(long, "Budget Hearing")!;
  assert.ok(quote.includes("Budget Hearing") && quote.length < 240, quote);
  assert.ok(long.text.includes(quote));
});

test("a checked loader's fact is checked against the line it quotes; an unchecked loader still publishes", async () => {
  const db = await factDb();
  try {
    const id = "az:city:example#governing";
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body','Example City Council','AZ')", [id]);
    await db.query(`INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,'https://example.gov/api','https://example.gov/api',$1,$2,'k')`, [now.toISOString(), "a".repeat(64)]);
    const text = '{\n  "Name": "Example City Council",\n  "Phone": "520-555-0100"\n}';
    const claim = (over: Partial<PublishInput> = {}): PublishInput => ({
      entity: { id, fullName: "Example City Council", stateName: "Arizona", hosts: [], externalIds: [] },
      field: "office_phone", fieldKind: "contact", value: "520-555-0100", valueText: "520-555-0100", quote: exactLine(text, "Phone", "520-555-0100")!,
      provenance: "OFFICIAL", producedBy: "loader-a", acquisition: "checked", costUsd: 0, copy: copyOf(text), ...over });
    assert.deepEqual(await door(db, claim({ quote: '"Phone": "520-555-0199"' }), clocks, now), { refused: "QUOTE_NOT_ON_SAVED_COPY" });
    const published = await door(db, claim(), clocks, now);
    assert.ok("decision" in published && published.decision === "PUBLISH");
    const [fact] = await db.query("SELECT quote, quote_start FROM fact WHERE entity_id=$1 AND status='live'", [id]);
    assert.equal(fact!.quote, '"Phone": "520-555-0100"');
    assert.equal(Number(fact!.quote_start), text.replace(/\s+/g, " ").indexOf('"Phone": "520-555-0100"'));
    const filing = (over: Partial<PublishInput>) => claim({ field: "money:total", fieldKind: "money", provenance: "FILING", acquisition: "loader", value: 113895, valueText: "113895", ...over });
    assert.deepEqual(await door(db, filing({ quote: "" }), clocks, now), { refused: "QUOTE_NOT_ON_SAVED_COPY" }, "a money claim from a loader is checked, whatever its host");
    const amount = await door(db, filing({ copy: copyOf('{\n  "amount":   113895\n}'), quote: '"amount": 113895' }), clocks, now);
    assert.ok("decision" in amount && amount.decision === "PUBLISH", "the quote is an exact substring once whitespace is normalized");
    const unchecked = await door(db, claim({ field: "office_email", value: "a@example.gov", valueText: "a@example.gov", quote: "", acquisition: "loader" }), clocks, now);
    assert.ok("decision" in unchecked && unchecked.decision === "PUBLISH", "a loader not yet switched keeps publishing");
  } finally { await db.pg.close(); }
});
