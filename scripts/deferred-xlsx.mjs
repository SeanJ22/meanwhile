/**
 * THE CENSUS, SPLIT INTO TWO TABS — `pnpm deferred:xlsx`
 *
 * The author's ruling of 2026-08-17: non-code decisions were confusing mixed in
 * with build work. `docs/deferred.csv` becomes `docs/deferred.xlsx` with two
 * sheets — **Build** and **Non-code decisions** — and which rows go where is
 * read from `docs/deferred-noncode.json`, so correcting a mis-sort is one line
 * in a list rather than an argument with a script.
 *
 * ## Rows are MOVED, never altered
 *
 * Same columns on both tabs, in the same order, `Disposition` included exactly
 * as the author marked it. This reads the CSV and writes the workbook; it does
 * not regenerate the census, does not consult the tracker, and cannot change a
 * cell. The CSV remains the file `pnpm deferred` owns and this the view onto
 * it — the same relationship `context.md` has to `state.md`.
 *
 * ## Why there is a ZIP writer in here
 *
 * An `.xlsx` is a ZIP of XML parts, and this repo has no spreadsheet library —
 * `scripts/gus-extract.mts` already reads the Census xlsx by treating it as
 * exactly that. Adding a dependency to write eleven columns of text is a worse
 * trade than ~70 lines of ZIP, and the output is verified by reading it back
 * through .NET's own ZipFile rather than by assuming it parsed.
 *
 * Timestamps in the archive come from `pnpm stamp`, not the wall clock, so two
 * runs on the same day produce byte-identical workbooks and a diff means a
 * real change.
 */

import { deflateRawSync } from "node:zlib";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { today } from "./doc-dates.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSV_IN = "docs/deferred.csv";
const NONCODE_IN = "docs/deferred-noncode.json";
const XLSX_OUT = "docs/deferred.xlsx";

const BUILD_SHEET = "Build";
const NONCODE_SHEET = "Non-code decisions";

/* ------------------------------------------------------------------- csv --- */

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/* ------------------------------------------------------------------- zip --- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/** DOS date/time from the stamped day at noon — deterministic, never the clock. */
function dosStamp(stampedToday) {
  const [y, m, d] = stampedToday.split("-").map(Number);
  return {
    time: (12 << 11) | (0 << 5) | 0,
    date: ((y - 1980) << 9) | (m << 5) | d,
  };
}

function zip(entries, stampedToday) {
  const { time, date } = dosStamp(stampedToday);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const comp = deflateRawSync(data, { level: 9 });

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    locals.push(local, comp);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length + comp.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, cd, eocd]);
}

/* ------------------------------------------------------------------ xlsx --- */

/**
 * Escape for XML, and drop the control characters XML 1.0 forbids outright.
 *
 * A stray control byte in a pasted cell makes the whole workbook unopenable
 * with an error naming no file, so it is removed here rather than shipped.
 */
// Written as escapes, never as the literal bytes. The first version of this
// line held six real control characters - invisible in an editor, invisible
// in a diff, and exactly the class of byte-level surprise this repo has been
// bitten by before. (No eslint-disable here: `no-control-regex` does not
// fire on escape sequences, and a disable directive that suppresses nothing
// is itself a lint warning.)
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function xml(s) {
  return String(s ?? "")
    .replace(XML_FORBIDDEN, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colRef(n) {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) {
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  }
  return s;
}

function sheetXml(header, rows, widths) {
  const lastCol = colRef(header.length);
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  parts.push(
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  );
  // Freeze the header so a 90-row tab stays readable while scrolling.
  parts.push(
    '<sheetViews><sheetView workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      "</sheetView></sheetViews>",
  );
  parts.push("<cols>");
  widths.forEach((w, i) => {
    parts.push(`<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`);
  });
  parts.push("</cols>");
  parts.push("<sheetData>");

  const cell = (r, c, v, style) =>
    `<c r="${colRef(c)}${r}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;

  parts.push(
    `<row r="1" ht="28" customHeight="1">${header.map((h, i) => cell(1, i + 1, h, 1)).join("")}</row>`,
  );
  rows.forEach((row, ri) => {
    const r = ri + 2;
    parts.push(`<row r="${r}">${row.map((v, i) => cell(r, i + 1, v, 2)).join("")}</row>`);
  });

  parts.push("</sheetData>");
  parts.push(`<autoFilter ref="A1:${lastCol}${rows.length + 1}"/>`);
  parts.push("</worksheet>");
  return Buffer.from(parts.join(""), "utf8");
}

const STYLES = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2">' +
    '<font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
    "</fonts>" +
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill>' +
    "</fills>" +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    "</cellXfs>" +
    "</styleSheet>",
  "utf8",
);

function buildWorkbook(sheets, stampedToday) {
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("") +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    "</Types>";

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheets
      .map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("") +
    "</sheets></workbook>";

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    "</Relationships>";

  const entries = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRels, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbook, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels, "utf8") },
    { name: "xl/styles.xml", data: STYLES },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: sheetXml(s.header, s.rows, s.widths),
    })),
  ];

  return zip(entries, stampedToday);
}

/* ------------------------------------------------------------------ main --- */

const stampedToday = today();

if (!existsSync(join(ROOT, CSV_IN))) {
  console.error(`\n${CSV_IN} not found — nothing to split. Nothing written.\n`);
  process.exit(1);
}

const grid = parseCsv(readFileSync(join(ROOT, CSV_IN), "utf8"));
const header = grid[0].map((h) => h.trim());
const rows = grid.slice(1);
const idAt = header.indexOf("ID");
if (idAt === -1) {
  console.error(`\n${CSV_IN} has no ID column — refusing to guess. Nothing written.\n`);
  process.exit(1);
}

const spec = JSON.parse(readFileSync(join(ROOT, NONCODE_IN), "utf8"));
const nonCodeIds = new Set([
  ...(spec.legal ?? []),
  ...(spec.business ?? []),
  ...(spec.rulingOnly?.ids ?? []),
]);

const buildRows = rows.filter((r) => !nonCodeIds.has(r[idAt].trim()));
const nonCodeRows = rows.filter((r) => nonCodeIds.has(r[idAt].trim()));

/* An id listed but absent from the CSV is a typo, and would silently shrink
 * neither tab — it would just never appear. Named, not swallowed. */
const present = new Set(rows.map((r) => r[idAt].trim()));
const missing = [...nonCodeIds].filter((id) => !present.has(id));

const problems = [];
if (buildRows.length + nonCodeRows.length !== rows.length) {
  problems.push(
    `${buildRows.length} build + ${nonCodeRows.length} non-code = ` +
      `${buildRows.length + nonCodeRows.length}, but the CSV holds ${rows.length} row(s)`,
  );
}
if (missing.length > 0) {
  problems.push(
    `${NONCODE_IN} names ID(s) the census does not hold: ${missing.join(", ")}`,
  );
}
if (problems.length > 0) {
  console.error("\npnpm deferred:xlsx — REFUSED, nothing written\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error("");
  process.exit(1);
}

// Roughly: narrow keys, wide prose. Excel widths are in character units.
const widths = header.map((h) => {
  if (h === "ID") return 8;
  if (h === "Area" || h === "Priority" || h === "Status") return 14;
  if (h === "Depends on" || h === "Target") return 12;
  if (h === "Item") return 46;
  if (h === "Detail" || h === "Notes") return 70;
  if (h === "What this is asking you") return 70;
  if (h === "Disposition") return 46;
  return 20;
});

const book = buildWorkbook(
  [
    { name: BUILD_SHEET, header, rows: buildRows, widths },
    { name: NONCODE_SHEET, header, rows: nonCodeRows, widths },
  ],
  stampedToday,
);

writeFileSync(join(ROOT, XLSX_OUT), book);

const marked = (n) =>
  n.filter((r) => (r[header.indexOf("Disposition")] ?? "").trim() !== "").length;

console.log("\npnpm deferred:xlsx\n");
console.log(`  source                ${CSV_IN}, ${rows.length} row(s)`);
console.log(`  ${BUILD_SHEET.padEnd(21)} ${buildRows.length} row(s), ${marked(buildRows)} carrying a Disposition`);
console.log(`  ${NONCODE_SHEET.padEnd(21)} ${nonCodeRows.length} row(s), ${marked(nonCodeRows)} carrying a Disposition`);
console.log(`  split closes          ${buildRows.length} + ${nonCodeRows.length} = ${rows.length}`);
console.log(`  columns               ${header.length} on both tabs — ${header.join(", ")}`);
console.log(`  non-code IDs          ${nonCodeRows.map((r) => r[idAt].trim()).join(", ")}`);
console.log(`  ${XLSX_OUT}    ${book.length} bytes, generated ${stampedToday}`);
console.log("");
