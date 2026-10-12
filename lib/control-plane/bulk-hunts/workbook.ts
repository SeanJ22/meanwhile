/** An uploaded Excel workbook as CSV text, read by the repository's own reader (there is no spreadsheet library here). */

import { readWorkbook, toCsv } from "../../../scripts/xlsx.mjs";
import { ZIP_COLUMN } from "./parse.ts";

/** The first sheet whose header row names the column; every other sheet is left alone. */
export function sheetAsCsv(base64: string, column: RegExp): { readonly ok: true; readonly csv: string } | { readonly ok: false; readonly says: string } {
  try {
    const sheets = readWorkbook(Buffer.from(base64, "base64")) as { name: string; rows: string[][] }[];
    const sheet = sheets.find((s) => (s.rows[0] ?? []).some((h) => column.test(String(h).trim())));
    if (!sheet) return { ok: false, says: column === ZIP_COLUMN ? "No sheet in that workbook has a column named zip." : "No sheet in that workbook has a column named link, url or website." };
    return { ok: true, csv: toCsv(sheet.rows[0], sheet.rows.slice(1)) as string };
  } catch {
    return { ok: false, says: "That file could not be read as an Excel workbook. Save it as CSV and upload that." };
  }
}
