import { cannotRun, extracted, zeroRows } from "./types.ts";
import type { ExtractResult } from "./types.ts";

/**
 * LAYER 2 — table extraction for agenda and budget grids (F11, Prompt C item
 * 12).
 *
 * ## Why a grid is a different problem from text
 *
 * `extractTextLayer` joins a page's text items with spaces, which is right for
 * prose and destroys a table: a budget line reading
 * `Police Department | 4,812,000 | 5,100,000` becomes
 * `Police Department 4,812,000 5,100,000`, and the column a number was in —
 * which is the whole meaning of a budget figure — is gone. An agenda grid
 * loses the same way: item number, subject, action, and who moved it collapse
 * into one line.
 *
 * PDFs carry no table structure. What they carry is POSITION: every text item
 * has a transform matrix, and its `[4]` and `[5]` are the x and y where the
 * item sits on the page. A table is recoverable from that, and only from that.
 *
 * ## The method, stated so its limits are visible
 *
 *   1. Group items into ROWS by y, within a tolerance — PDF baselines for one
 *      visual row differ by fractions of a point.
 *   2. Within a row, sort by x and cut a new CELL wherever the horizontal gap
 *      exceeds a threshold derived from the row's own median character width,
 *      never a fixed number of points. A fixed gap works on one document and
 *      on no other.
 *   3. A run of consecutive rows with the SAME cell count is a candidate
 *      table. One row is not a table; two are not either. Three is the floor.
 *
 * **WHAT THIS DOES NOT DO, stated rather than discovered later:** it does not
 * read ruling lines, so a borderless layout that is not aligned in columns
 * will not be found; it does not merge cells that span; and it does not join a
 * table that continues across a page break. Each of those is a real shape and
 * each is a rung this layer does not yet reach. A run that finds nothing says
 * so with these limits named.
 */

export interface ExtractedTable {
  page: number;
  columns: number;
  rows: string[][];
}

interface PositionedItem {
  x: number;
  y: number;
  width: number;
  text: string;
}

/** Baselines within this many points are one visual row. */
const ROW_TOLERANCE = 2.5;

/** A gap wider than this multiple of the row's median char width cuts a cell. */
const CELL_GAP_FACTOR = 2.2;

/** Fewer rows than this is a coincidence, not a table. */
const MIN_TABLE_ROWS = 3;

/** Fewer columns than this is a list, not a table. */
const MIN_TABLE_COLUMNS = 2;

export function rowsFromItems(items: PositionedItem[]): PositionedItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PositionedItem[][] = [];
  for (const item of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0]!.y - item.y) <= ROW_TOLERANCE) last.push(item);
    else rows.push([item]);
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x));
}

export function cellsFromRow(row: PositionedItem[]): string[] {
  if (row.length === 0) return [];
  /*
   * The threshold comes from the ROW, not from a constant. A 7pt footnote
   * table and a 14pt agenda grid have different natural word gaps, and a fixed
   * point value splits one of them wrongly whichever value is chosen.
   */
  const widths = row
    .filter((i) => i.text.length > 0)
    .map((i) => i.width / Math.max(1, i.text.length))
    .filter((w) => Number.isFinite(w) && w > 0)
    .sort((a, b) => a - b);
  const medianCharWidth = widths.length ? widths[Math.floor(widths.length / 2)]! : 4;
  const threshold = medianCharWidth * CELL_GAP_FACTOR;

  const cells: string[] = [];
  let current = row[0]!.text;
  let cursor = row[0]!.x + row[0]!.width;
  for (const item of row.slice(1)) {
    if (item.x - cursor > threshold) {
      cells.push(current.replace(/\s+/g, " ").trim());
      current = item.text;
    } else {
      current += (item.x - cursor > medianCharWidth * 0.3 ? " " : "") + item.text;
    }
    cursor = item.x + item.width;
  }
  cells.push(current.replace(/\s+/g, " ").trim());
  return cells.filter((c, i, all) => c !== "" || (i > 0 && i < all.length - 1));
}

/** Consecutive rows sharing a column count are a table. */
export function tablesFromRows(cellRows: string[][], page: number): ExtractedTable[] {
  const out: ExtractedTable[] = [];
  let run: string[][] = [];
  const flush = () => {
    if (run.length >= MIN_TABLE_ROWS && run[0]!.length >= MIN_TABLE_COLUMNS) {
      out.push({ page, columns: run[0]!.length, rows: run });
    }
    run = [];
  };
  for (const row of cellRows) {
    if (run.length === 0 || row.length === run[0]!.length) run.push(row);
    else {
      flush();
      run = [row];
    }
  }
  flush();
  return out;
}

export async function extractTables(
  bytes: Uint8Array,
  source: string,
): Promise<ExtractResult<ExtractedTable>> {
  if (bytes.length === 0) {
    return cannotRun("TABLES", source, "the input is zero bytes — nothing was fetched");
  }
  const magic = new TextDecoder("latin1").decode(bytes.slice(0, 5));
  if (!magic.startsWith("%PDF")) {
    return cannotRun(
      "TABLES",
      source,
      `the input does not begin with %PDF (saw ${JSON.stringify(magic)})`,
      { inputBytes: bytes.length },
    );
  }

  let doc;
  try {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    doc = await getDocument({ data: bytes, useWorkerFetch: false }).promise;
  } catch (error) {
    return cannotRun("TABLES", source, `the PDF engine refused the file: ${(error as Error).message}`);
  }

  const tables: ExtractedTable[] = [];
  let candidateRows = 0;
  try {
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: PositionedItem[] = [];
      for (const raw of content.items as unknown[]) {
        if (!raw || typeof raw !== "object" || !("str" in raw)) continue;
        const it = raw as { str: string; width?: number; transform?: number[] };
        const text = String(it.str);
        if (text.trim() === "") continue;
        const t = it.transform ?? [];
        items.push({
          x: Number(t[4] ?? 0),
          y: Number(t[5] ?? 0),
          width: Number(it.width ?? text.length * 4),
          text,
        });
      }
      const cellRows = rowsFromItems(items).map(cellsFromRow);
      candidateRows += cellRows.length;
      tables.push(...tablesFromRows(cellRows, p));
    }
  } finally {
    await doc.cleanup();
  }

  const counts = {
    pages: doc.numPages,
    candidateRows,
    tables: tables.length,
    tableRows: tables.reduce((n, t) => n + t.rows.length, 0),
  };

  if (tables.length === 0) {
    return zeroRows(
      "TABLES",
      source,
      bytes.length,
      `${candidateRows} text row(s) were reconstructed across ${doc.numPages} page(s) ` +
        `and none formed a run of ${MIN_TABLE_ROWS}+ rows with a consistent column ` +
        "count. LIMITS OF THIS LAYER, so this is read as what it is: no ruling-line " +
        "detection, no spanned-cell merging, no table joined across a page break. A " +
        "grid with any of those shapes is a rung this layer does not reach yet.",
      counts,
    );
  }

  return extracted("TABLES", source, bytes.length, tables, counts);
}
