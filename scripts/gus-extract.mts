/**
 * The official universe, extracted per county from the Census of Governments.
 *
 *   pnpm gus:extract <xlsx-dir> <FIPS> [FIPS...]
 *
 * ## Why this exists as code
 *
 * `docs/coverage-audit-by-county.md` names the rule this serves: coverage
 * claims are made against the OFFICIAL universe, never against our own
 * records. The three clip counties' extract at
 * `data/audit/gus-2022-clip-counties.json` was produced by hand in an earlier
 * session, and a hand extraction is a one-off: the h session needed Sullivan
 * and Hillsborough counties — because 03255's twenty-five kilometre circle
 * crosses two county lines — and there was nothing to run.
 *
 * National expansion pays universe acquisition once per geography (the
 * h scorecard's C11 line). This script is that line's cost, paid once.
 *
 * ## Why it reads the xlsx directly
 *
 * The Census publishes the Government Units Listing as a single 11 MB
 * workbook and nothing else. Rather than add a spreadsheet dependency for one
 * file a year, this reads the `.xlsx` as what it is — a zip of XML — after
 * the caller has unpacked it. `sharedStrings.xml` holds every distinct cell
 * string once; each sheet references them by index. That is the whole format
 * we need, and a hand-rolled reader for it is smaller than the dependency.
 *
 * Unpack step, once, in any shell that has a zip tool:
 *   cp Govt_Units_2022_Final.xlsx gus.zip && unzip -o gus.zip -d gusx
 * then point this script at `gusx`.
 *
 * ## The count discipline
 *
 * An operation that can return nothing must be asked what it returned. This
 * prints rows read per sheet, rows matched per county, and the per-category
 * split — so a filter that silently matched zero cannot read as a clean run.
 */

import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Sheet order in the 2022 workbook, verified by reading each sheet's first
 * data row rather than by trusting the tab names: sheet1 opens with COUNTY OF
 * AUTAUGA, sheet2 with PRATTVILLE HOUSING AUTHORITY, sheet3 with AUTAUGA
 * COUNTY SCHOOL DISTRICT, sheet4 with a state-dependent REAA.
 */
const SHEETS = [
  { file: "sheet1.xml", kind: "GENERAL_PURPOSE" },
  { file: "sheet2.xml", kind: "SPECIAL_DISTRICT" },
  { file: "sheet3.xml", kind: "SCHOOL_DISTRICT" },
  { file: "sheet4.xml", kind: "DEPENDENT_SCHOOL_DISTRICT" },
] as const;

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/**
 * The shared string table, in document order.
 *
 * A `<si>` may hold one `<t>` or several (rich text runs); the cell's value is
 * every run concatenated, which is why this collects rather than takes the
 * first. Getting that wrong truncates exactly the names that carry formatting.
 */
function readSharedStrings(dir: string): string[] {
  const xml = readFileSync(join(dir, "xl", "sharedStrings.xml"), "utf8");
  const out: string[] = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml)) !== null) {
    const runs = m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [];
    out.push(
      runs
        .map((r) => unescapeXml(r.replace(/^<t[^>]*>/, "").replace(/<\/t>$/, "")))
        .join(""),
    );
  }
  return out;
}

function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * One row's cells, indexed by their own column letters.
 *
 * ## The defect this shape exists to avoid
 *
 * An empty cell is written self-closing — `<c r="G24141" s="12"/>` — and a
 * naive `/<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/` matches it anyway: the
 * `[^>]*` happily absorbs the trailing slash, and the lazy body then runs
 * forward to the NEXT cell's `</c>`, swallowing it whole. The following cell
 * never gets an entry of its own, so every column after the first empty one
 * reads SHIFTED.
 *
 * That symptom is the dangerous part. A shifted column does not look like a
 * parse bug; it looks like a data difference. The first run of this script
 * dropped twelve of Merrimack County's eighteen special districts because
 * their `FIPS_STATE` cell had slid one column left into `WEB_ADDRESS`, and
 * the natural reading was "the 2022 workbook disagrees with our committed
 * extract" rather than "our reader is broken". It was caught only because
 * a whole class of government came back suspiciously small and the committed
 * extract said otherwise.
 *
 * So the scan is explicit rather than regular: find each `<c`, read its
 * attributes to the first unquoted `>`, and branch on whether that `>` was
 * preceded by a slash. Self-closing cells contribute nothing and consume
 * nothing.
 */
function parseRow(rowXml: string, shared: string[]): string[] {
  const cells: string[] = [];
  let i = 0;
  while ((i = rowXml.indexOf("<c", i)) !== -1) {
    // Guard against matching `<col` or similar: the next char must end the
    // tag name.
    const after = rowXml[i + 2];
    if (after !== " " && after !== ">" && after !== "/") {
      i += 2;
      continue;
    }
    const gt = rowXml.indexOf(">", i);
    if (gt === -1) break;
    const selfClosing = rowXml[gt - 1] === "/";
    const attrs = rowXml.slice(i + 2, selfClosing ? gt - 1 : gt);
    const refMatch = attrs.match(/\br="([A-Z]+\d+)"/);

    if (selfClosing) {
      i = gt + 1;
      continue;
    }

    const close = rowXml.indexOf("</c>", gt);
    if (close === -1) break;
    const inner = rowXml.slice(gt + 1, close);
    i = close + 4;
    if (!refMatch) continue;

    const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
    const isMatch = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
    let value = "";
    if (/\bt="s"/.test(attrs) && vMatch) value = shared[Number(vMatch[1])] ?? "";
    else if (isMatch) value = unescapeXml(isMatch[1]);
    else if (vMatch) value = unescapeXml(vMatch[1]);
    cells[colIndex(refMatch[1])] = value;
  }
  return cells;
}

/** Streams one sheet, yielding each row as an array of cell strings. */
async function* rows(dir: string, file: string, shared: string[]) {
  const stream = createReadStream(join(dir, "xl", "worksheets", file), {
    encoding: "utf8",
    highWaterMark: 1 << 20,
  });
  let buf = "";
  for await (const chunk of stream) {
    buf += chunk;
    let end: number;
    // Rows are emitted only once their closing tag has arrived, so a row split
    // across two chunks is never parsed half-formed.
    while ((end = buf.indexOf("</row>")) !== -1) {
      const start = buf.lastIndexOf("<row", end);
      if (start === -1) {
        buf = buf.slice(end + 6);
        continue;
      }
      const rowXml = buf.slice(start, end + 6);
      buf = buf.slice(end + 6);
      yield parseRow(rowXml, shared);
    }
  }
}

function pick(header: string[], ...names: string[]): number {
  for (const n of names) {
    const i = header.findIndex((h) => (h ?? "").trim().toUpperCase() === n.toUpperCase());
    if (i !== -1) return i;
  }
  return -1;
}

async function main() {
  const dir = process.argv[2];
  const fipsWanted = process.argv.slice(3).filter((a) => /^\d{5}$/.test(a));
  if (!dir || fipsWanted.length === 0) {
    console.error("usage: pnpm gus:extract <unpacked-xlsx-dir> <5-digit-county-FIPS>...");
    process.exit(2);
  }

  const shared = readSharedStrings(dir);
  console.log(`shared strings: ${shared.length}`);

  const out: Record<string, unknown[]> = {};
  for (const f of fipsWanted) out[f] = [];
  let totalRead = 0;

  for (const sheet of SHEETS) {
    let header: string[] | null = null;
    let read = 0;
    let matched = 0;
    let iState = -1, iCounty = -1, iName = -1, iId = -1, iType = -1, iWeb = -1, iCity = -1, iActive = -1, iZip = -1, iAddr = -1;

    for await (const cells of rows(dir, sheet.file, shared)) {
      if (!header) {
        header = cells.map((c) => c ?? "");
        // FIPS_STATE first, deliberately. `STATE` in this workbook is the
        // postal abbreviation ("AL"), not the numeric code, and preferring it
        // is what made the first run of this script match zero rows in three
        // counties — caught only because the count is printed rather than
        // assumed.
        iState = pick(header, "FIPS_STATE", "STATE_CODE");
        iCounty = pick(header, "FIPS_COUNTY", "COUNTY_CODE");
        iName = pick(header, "UNIT_NAME", "NAME");
        iId = pick(header, "CENSUS_ID_PID6", "CENSUS_ID", "ID");
        iType = pick(header, "UNIT_TYPE", "FUNCTION_NAME", "TYPE");
        iWeb = pick(header, "WEB_ADDRESS", "WEBSITE", "WEB");
        iCity = pick(header, "CITY", "ADDRESS_CITY");
        iActive = pick(header, "IS_ACTIVE", "ACTIVE_FLAG", "ACTIVE");
        iZip = pick(header, "ZIP");
        iAddr = pick(header, "ADDRESS1");
        if (iState === -1 || iCounty === -1 || iName === -1) {
          throw new Error(
            `${sheet.file}: could not find the FIPS/name columns in ${JSON.stringify(header)}`,
          );
        }
        continue;
      }
      read += 1;
      const st = (cells[iState] ?? "").trim().padStart(2, "0");
      const co = (cells[iCounty] ?? "").trim().padStart(3, "0");
      const fips = st + co;
      if (!(fips in out)) continue;
      matched += 1;
      (out[fips] as unknown[]).push({
        kind: sheet.kind,
        censusId: (cells[iId] ?? "").trim(),
        name: (cells[iName] ?? "").trim(),
        unitType: iType === -1 ? undefined : (cells[iType] ?? "").trim() || undefined,
        web: (cells[iWeb] ?? "").trim(),
        city: (cells[iCity] ?? "").trim(),
        active: (cells[iActive] ?? "").trim(),
        zip: iZip === -1 ? "" : (cells[iZip] ?? "").trim(),
        address1: iAddr === -1 ? "" : (cells[iAddr] ?? "").trim(),
        countyFips: fips,
      });
    }
    totalRead += read;
    console.log(
      `${sheet.file} (${sheet.kind}): ${read} rows read, ${matched} matched` +
        (header ? "" : " — NO HEADER FOUND"),
    );
    if (read === 0) throw new Error(`${sheet.file} returned zero rows — refusing a silent empty read`);
  }

  console.log(`\ntotal rows read across sheets: ${totalRead}`);
  for (const f of fipsWanted) {
    const rowsFor = out[f] as { kind: string }[];
    const split: Record<string, number> = {};
    for (const r of rowsFor) split[r.kind] = (split[r.kind] ?? 0) + 1;
    console.log(`  ${f}: ${rowsFor.length} governments  ${JSON.stringify(split)}`);
    if (rowsFor.length === 0) {
      console.log(`  ${f}: MATCHED ZERO — stated, not swallowed. Check the FIPS.`);
    }
  }

  const dest = process.env.GUS_OUT ?? "data/audit/gus-2022-extract.json";
  writeFileSync(dest, `${JSON.stringify(out, null, 1)}\n`, "utf8");
  console.log(`\nwrote ${dest}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
