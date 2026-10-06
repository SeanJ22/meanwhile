/**
 * A CSV reader that handles quoted fields with embedded commas, quotes and
 * newlines — the Census unit file has all three, and a `split(",")` reader
 * silently produces short rows rather than failing.
 *
 * Returns rows as string arrays. The caller maps to objects, so a 90,837-row
 * file is not turned into 90,837 objects unless something wants them.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
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
  // A final line with no trailing newline is a row, not a discard.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

