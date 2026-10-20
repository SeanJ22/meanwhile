import assert from "node:assert/strict";
import test from "node:test";

import { cannotRun, describe, extracted, zeroRows } from "../lib/extract/types.ts";
import { extractTextLayer } from "../lib/extract/text-layer.ts";
import { extractTables, cellsFromRow, rowsFromItems, tablesFromRows } from "../lib/extract/tables.ts";
import { ocrEngineAvailable, runOcr } from "../lib/extract/ocr.ts";
import {
  extractEmbeddedPayload,
  findInPayload,
  firstJsonLiteral,
  walkStrings,
} from "../lib/extract/embedded-payload.ts";

/** A zero-row extraction is a failed extraction, enforced inside the constructor rather than by every caller. */
test("extracted() with no items REFUSES to report success", () => {
  const r = extracted("TEXT_LAYER", "x.pdf", 100, []);
  assert.equal(r.outcome, "ZERO_ROWS");
  assert.equal(r.rows, 0);
  assert.match(r.reason, /failed extraction, not an empty document/);
});

test("extracted() with items reports EXTRACTED and states its count", () => {
  const r = extracted("TEXT_LAYER", "x.pdf", 100, [{ page: 1, text: "hello" }], { pages: 1 });
  assert.equal(r.outcome, "EXTRACTED");
  assert.equal(r.rows, 1);
  assert.equal(r.counts.pages, 1);
  assert.equal(r.reason, "");
});

test("ZERO_ROWS and CANNOT_RUN are different facts", () => {
  /* "I looked and found nothing" and "I could not look" must never render alike. */
  const zero = zeroRows("OCR", "s", 10, "ran, recognised nothing");
  const cant = cannotRun("OCR", "s", "no engine on PATH");
  assert.notEqual(zero.outcome, cant.outcome);
  assert.equal(zero.inputBytes, 10, "ZERO_ROWS knows what it examined");
  assert.equal(cant.inputBytes, 0, "CANNOT_RUN examined nothing, and says 0");
});

test("describe() always states the counts", () => {
  const line = describe(extracted("TABLES", "s", 5, [1], { pages: 3, candidateRows: 40 }));
  assert.match(line, /rows=1/);
  assert.match(line, /pages=3/);
  assert.match(line, /candidateRows=40/);
});

test("layer 1: a non-PDF input CANNOT RUN rather than reading as an empty PDF", async () => {
  /*
   * A challenge interstitial or an HTML error page fed to a PDF parser produces a document that says nothing,
   * indistinguishable from a body that published nothing.
   */
  const html = new TextEncoder().encode("<html><body>Client Challenge</body></html>");
  const r = await extractTextLayer(html, "challenge.html");
  assert.equal(r.outcome, "CANNOT_RUN");
  assert.match(r.reason, /does not begin with %PDF/);
});

test("layer 1: zero bytes CANNOT RUN", async () => {
  const r = await extractTextLayer(new Uint8Array(0), "empty");
  assert.equal(r.outcome, "CANNOT_RUN");
  assert.match(r.reason, /zero bytes/);
});

test("all five PDF readers destroy real document transports and workers after repeated documents and failures", async t => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { extractPdf } = await import("../lib/control-plane/scheduler/scout-tools.ts");
  const { extractPdfText } = await import("../lib/meetings/agenda-documents.ts");
  const { pdfVotingTables } = await import("../lib/ballot/voting-source-tables.ts");
  const stream = [
    "BT /F1 12 Tf 10 80 Td (Name) Tj 120 0 Td (Office) Tj ET",
    "BT /F1 12 Tf 10 60 Td (Alice) Tj 120 0 Td (Clerk) Tj ET",
    "BT /F1 12 Tf 10 40 Td (Bob) Tj 120 0 Td (Mayor) Tj ET",
  ].join("\n");
  const bytes = new TextEncoder().encode("%PDF-1.4\n" +
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n" +
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n" +
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n" +
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj\n` +
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n" +
    "trailer << /Root 1 0 R >>\n%%EOF\n");
  const probe = getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false });
  const proxy = await probe.promise;
  const pagePrototype = Object.getPrototypeOf(proxy) as { getPage: typeof proxy.getPage };
  const prototype = Object.getPrototypeOf(probe) as { destroy: typeof probe.destroy };
  await probe.destroy();
  const original = prototype.destroy;
  let destroyed = 0;
  t.mock.method(prototype, "destroy", async function (this: typeof probe) {
    const task = this as unknown as { _worker: { destroyed: boolean; port: unknown } | null; _transport: { destroyed: boolean } | null };
    const worker = task._worker, transport = task._transport;
    await original.call(this);
    destroyed++;
    assert.equal(this.destroyed, true);
    assert.equal(task._worker, null, "destroy drops the loading task's worker reference");
    assert.equal(task._transport, null, "destroy drops the loading task's document transport");
    if (worker) { assert.equal(worker.destroyed, true); assert.equal(worker.port, null); }
    if (transport) assert.equal(transport.destroyed, true, "the document transport terminates, rather than just clearing caches");
  });
  const readers = [
    { name: "text", read: async (input: Uint8Array) => extractTextLayer(input, "fixture.pdf"), refuses: (value: unknown) =>
      assert.equal((value as { outcome: string }).outcome, "CANNOT_RUN") },
    { name: "tables", read: async (input: Uint8Array) => extractTables(input, "fixture.pdf"), refuses: (value: unknown) =>
      assert.equal((value as { outcome: string }).outcome, "CANNOT_RUN") },
    { name: "scout", read: async (input: Uint8Array) => extractPdf(input, async () => { throw new Error("digital PDF must not use OCR"); }), refuses: (value: unknown) =>
      assert.equal((value as { kind: string }).kind, "EXTRACTION_FAILED") },
    { name: "agenda", read: extractPdfText },
    { name: "voting", read: pdfVotingTables },
  ];
  const expectedRows = [["Name", "Office"], ["Alice", "Clerk"], ["Bob", "Mayor"]];
  for (let repeat = 0; repeat < 3; repeat++) for (const reader of readers) {
    const before = destroyed, input = new Uint8Array(bytes), result = await reader.read(input);
    assert.equal(destroyed, before + 1, `${reader.name} owns exactly one terminated PDF task per document`);
    if (reader.name === "text") {
      const value = result as Awaited<ReturnType<typeof extractTextLayer>>;
      assert.equal(value.outcome, "EXTRACTED"); assert.equal(value.counts.pages, 1);
      assert.equal(value.items[0]?.text, "Name Office Alice Clerk Bob Mayor");
    } else if (reader.name === "tables") {
      const value = result as Awaited<ReturnType<typeof extractTables>>;
      assert.equal(value.outcome, "EXTRACTED"); assert.equal(value.counts.pages, 1);
      assert.deepEqual(value.items[0]?.rows, expectedRows);
    } else if (reader.name === "scout") {
      const value = result as Awaited<ReturnType<typeof extractPdf>>;
      assert.equal(value.kind, "TEXT");
      if (value.kind === "TEXT") { assert.equal(value.pages, 1); assert.equal(value.complete, true); assert.deepEqual(value.tables[0]?.rows, expectedRows); }
      assert.deepEqual(input, bytes, "Scout preserves the original evidence buffer for OCR and vault use");
    } else if (reader.name === "agenda") assert.equal(result, "Name Office Alice Clerk Bob Mayor");
    else {
      const value = result as Awaited<ReturnType<typeof pdfVotingTables>>;
      assert.deepEqual(value[0]?.headers, expectedRows[0]); assert.deepEqual(value[0]?.rows, expectedRows.slice(1));
      assert.deepEqual(input, bytes, "the voting reader preserves the source capture's bytes");
    }
  }
  const scan = new TextEncoder().encode(new TextDecoder().decode(bytes).replace(stream, "").replace(`/Length ${stream.length}`, "/Length 0"));
  const beforeOcr = destroyed;
  const scanned = await extractPdf(scan, async input => {
    assert.equal(destroyed, beforeOcr + 1, "the PDF transport is released before OCR begins; only copied text, tables and page count are still needed");
    assert.deepEqual(input, scan);
    return extracted("OCR", "scan.pdf", input.length, [{ page: 1, text: "Scanned agenda" }], { pages: 1 });
  });
  assert.equal(scanned.kind, "TEXT");
  if (scanned.kind === "TEXT") { assert.equal(scanned.pages, 1); assert.match(scanned.text, /Scanned agenda/); }
  for (const reader of readers) {
    const before = destroyed;
    const invalid = new TextEncoder().encode("%PDF-1.4\ninvalid document\n%%EOF");
    if (reader.refuses) reader.refuses(await reader.read(invalid));
    else await assert.rejects(reader.read(invalid), /Invalid PDF/);
    assert.equal(destroyed, before + 1, `${reader.name} also terminates the worker when document loading fails`);
  }
  t.mock.method(pagePrototype, "getPage", async () => { throw new Error("PAGE_TEXT_READ_FAILED"); });
  for (const reader of readers) {
    const before = destroyed;
    if (reader.name === "scout") reader.refuses!(await reader.read(new Uint8Array(bytes)));
    else await assert.rejects(reader.read(new Uint8Array(bytes)), /PAGE_TEXT_READ_FAILED/);
    assert.equal(destroyed, before + 1, `${reader.name} terminates the loaded document after page extraction fails`);
  }
  assert.equal(destroyed, 26);
});

const item = (x: number, y: number, text: string, width = text.length * 4) => ({
  x,
  y,
  width,
  text,
});

test("layer 2: items group into rows by baseline, within tolerance", () => {
  const rows = rowsFromItems([
    item(10, 700, "A"),
    item(200, 701, "B"),
    item(10, 680, "C"),
  ]);
  assert.equal(rows.length, 2, "701 and 700 are one visual row; 680 is another");
  assert.deepEqual(rows[0]!.map((i) => i.text), ["A", "B"]);
  assert.deepEqual(rows[1]!.map((i) => i.text), ["C"]);
});

test("layer 2: a wide gap cuts a cell, a word gap does not", () => {
  /*
   * The threshold comes from the ROW's own median character width, never a
   * fixed number of points — a 7pt footnote table and a 14pt agenda grid have
   * different natural word gaps, and any constant splits one of them wrongly.
   */
  const cells = cellsFromRow([
    item(0, 700, "Police"),
    item(28, 700, "Department"),
    item(300, 700, "4,812,000"),
  ]);
  assert.deepEqual(cells, ["Police Department", "4,812,000"]);
});

test("layer 2: three consecutive rows of equal width are a table; two are not", () => {
  const three = [
    ["Dept", "2025", "2026"],
    ["Police", "4.8", "5.1"],
    ["Fire", "3.2", "3.4"],
  ];
  assert.equal(tablesFromRows(three, 1).length, 1);
  assert.equal(tablesFromRows(three.slice(0, 2), 1).length, 0, "two rows are a coincidence");
  assert.equal(
    tablesFromRows([["a"], ["b"], ["c"]], 1).length,
    0,
    "one column is a list, not a table",
  );
});

test("layer 2: a non-PDF CANNOT RUN", async () => {
  const r = await extractTables(new TextEncoder().encode("not a pdf"), "x");
  assert.equal(r.outcome, "CANNOT_RUN");
});

test("layer 3: a missing engine is CANNOT RUN, never 'no text'", async () => {
  /* A scanned agenda recorded as a document that published nothing is a false claim about a public body. */
  const r = await runOcr(new Uint8Array([1, 2, 3]), "scan.pdf", {
    binary: "definitely-not-an-ocr-engine-wtp",
  });
  assert.equal(r.outcome, "CANNOT_RUN");
  assert.match(r.reason, /NOT a finding that the/i);
  assert.match(r.reason, /not on PATH/);
});

test("layer 3: an injected engine's output is extracted, page by page", async () => {
  const r = await runOcr(new Uint8Array([1]), "scan.pdf", {
    engine: async () => ["  PAGE ONE  ", "", "page three"],
  });
  assert.equal(r.outcome, "EXTRACTED");
  assert.equal(r.rows, 2, "the empty page contributes no row");
  assert.equal(r.counts.pages, 3);
  assert.equal(r.counts.pagesEmpty, 1);
  assert.equal(r.items[0]!.text, "PAGE ONE");
});

test("layer 3: an engine that recognises nothing is ZERO_ROWS with the next rung named", async () => {
  const r = await runOcr(new Uint8Array([1]), "scan.pdf", { engine: async () => ["", " "] });
  assert.equal(r.outcome, "ZERO_ROWS");
  assert.match(r.reason, /THIS ENGINE on THIS DOCUMENT/);
  assert.match(r.reason, /higher DPI|language pack|`-l`/);
});

test("layer 3: engine availability is answered, not assumed", () => {
  // Whatever this machine has, the probe returns a boolean rather than
  // throwing — the caller must be able to ASK before it decides anything.
  assert.equal(typeof ocrEngineAvailable("definitely-not-an-ocr-engine-wtp"), "boolean");
  assert.equal(ocrEngineAvailable("definitely-not-an-ocr-engine-wtp"), false);
});

/**
 * Apptegy ships page content as an escaped JSON payload inside a `<script>`: the rendered prose carries a blurb with
 * a bare surname and never the byline, so the full name is only in the payload. This fixture is the shape.
 */
const APPTEGY_SHAPED = `
<!doctype html><html><head>
<script type="application/ld+json">{"@type":"Organization","name":"Vail Unified"}</script>
</head><body>
<div id="app"><p>Superintendent Carruth welcomed families back.</p></div>
<script>window.__NUXT__ = (function(a,b){return {data:[{blocks:${JSON.stringify(
  JSON.stringify({
    sections: [
      { html: "<strong>John Carruth<br>Superintendent</strong>" },
      { title: "John Carruth" },
    ],
  }),
)}}]}}(1,2));</script>
</body></html>`;

test("layer 4: the byline is found in the payload though the prose never carries it", () => {
  const r = extractEmbeddedPayload(APPTEGY_SHAPED, "vail-shaped");
  assert.equal(r.outcome, "EXTRACTED");

  // The prose does not carry the full name.
  const prose = APPTEGY_SHAPED.replace(/<script[\s\S]*?<\/script>/gi, "");
  assert.ok(!prose.includes("John Carruth"), "the rendered prose has no byline");

  const hits = findInPayload(r, "John Carruth");
  assert.ok(hits.length >= 2, `expected the byline in the payload, found ${hits.length}`);
  assert.ok(
    hits.every((h) => h.path.length > 0),
    "every hit carries its key path — a hit with no provenance is a substring match",
  );
});

test("layer 4: a DOUBLY-encoded payload is walked, not skipped", () => {
  // Apptegy's shape: a JSON string whose value is itself JSON; skipping it misses the byline.
  const html = `<script>window.d = ${JSON.stringify(JSON.stringify({ name: "Buried Name" }))}</script>`;
  const r = extractEmbeddedPayload(html, "double");
  assert.equal(r.outcome, "EXTRACTED");
  assert.deepEqual(
    findInPayload(r, "Buried Name").map((h) => h.value),
    ["Buried Name"],
  );
});

test("layer 4: all three encodings are read", () => {
  const html = [
    `<script type="application/json">{"a":"plain json"}</script>`,
    `<script>window.__DATA__ = {"b":"assigned literal"};</script>`,
    `<script>var x = ${JSON.stringify(JSON.stringify({ c: "doubly encoded" }))}</script>`,
  ].join("\n");
  const r = extractEmbeddedPayload(html, "three");
  assert.equal(r.counts.scripts, 3);
  assert.equal(r.counts.scriptsWithJson, 3);
  for (const needle of ["plain json", "assigned literal", "doubly encoded"]) {
    assert.equal(findInPayload(r, needle).length, 1, `${needle} was read`);
  }
});

test("layer 4: no script at all is ZERO_ROWS naming the challenge possibility", () => {
  const r = extractEmbeddedPayload("<html><body>hi</body></html>", "plain");
  assert.equal(r.outcome, "ZERO_ROWS");
  assert.match(r.reason, /challenge interstitial served at 200/);
});

test("layer 4: scripts with no JSON is ZERO_ROWS naming the next rung", () => {
  const r = extractEmbeddedPayload("<script>alert(1)</script>", "nojson");
  assert.equal(r.outcome, "ZERO_ROWS");
  assert.match(r.reason, /rung 7/);
  assert.equal(r.counts.scripts, 1);
  assert.equal(r.counts.scriptsWithJson, 0);
});

test("layer 4: an empty document CANNOT RUN", () => {
  assert.equal(extractEmbeddedPayload("   ", "empty").outcome, "CANNOT_RUN");
});

test("layer 4: firstJsonLiteral respects strings containing braces", () => {
  const parsed = firstJsonLiteral('window.x = {"note":"a } inside a string","n":1};') as {
    note: string;
    n: number;
  };
  assert.equal(parsed.n, 1);
  assert.equal(parsed.note, "a } inside a string");
});

test("layer 4: walkStrings records the key path, which is the provenance", () => {
  const out: { path: string; value: string; script: number }[] = [];
  walkStrings({ staff: [{ name: "A Person" }] }, "", out, 1);
  assert.deepEqual(out, [{ path: "staff[0].name", value: "A Person", script: 1 }]);
});
