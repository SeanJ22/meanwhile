/**
 * `pnpm az:levy` — WHO ACTUALLY TAXES A PARCEL IN THIS COUNTY.
 * (2026-08-27, the 85641 detective session.)
 *
 * ## Why this is the strongest enumerator there is
 *
 * A government can publish nothing, appear in no directory, own no domain and
 * sit on no boundary layer, and it still cannot avoid being in here — because
 * somebody has to collect its money. Under **A.R.S. §§ 42-17101 to 42-17110**
 * an Arizona county board of supervisors adopts one resolution each August
 * levying taxes and special assessments for **every** entity that taxes
 * property in the county: the county itself and the districts it sits as, every
 * city and town, every school district, the community college, the JTED, every
 * fire district, every special taxing district, and the improvement districts
 * nobody has ever heard of.
 *
 * It is the "who bills for it" route, which this project learned against New
 * Hampshire's Department of Revenue village sheet, applied to Arizona — where
 * the publisher is the COUNTY rather than the state.
 *
 * ## What it corrected on its first run
 *
 * Pima County's own Community Facilities Districts page lists **two**. Its levy
 * resolution names **nine**. The page is the Finance Department's page for the
 * districts that department administers; the levy is the county saying who
 * taxes you. A government's own index is not the enumeration.
 *
 * It also produced, in one document, entire classes this project had never
 * recorded: irrigation districts levying PER ACRE rather than ad valorem, a
 * health district, domestic water improvement districts, street lighting
 * improvement districts, an unorganized school district tax, a fire district
 * assistance tax, and the Central Arizona Water Conservation District.
 *
 * ## What it refuses to do
 *
 * It never invents a rate. A jurisdiction whose numbers this parser cannot read
 * off the line is emitted with `rate: null` and a `parseNote`, because a
 * plausible tax rate attributed to a real government is a false claim about
 * somebody's money.
 *
 * ```
 * pnpm az:levy --pdf <file> --out data/hunt/pima-2026-27-levy.json
 * ```
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { floored, floorLine } from "../lib/ops/denominator-floor.ts";

interface Jurisdiction {
  section: string;
  name: string;
  line: string;
  valuation: number | null;
  levy: number | null;
  rate: number | null;
  parseNote?: string;
}

const num = (s: string): number | null => {
  const v = Number(String(s).replace(/[, ]/g, ""));
  return Number.isFinite(v) ? v : null;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const pdf = arg("pdf");
  if (!pdf) throw new Error("pnpm az:levy --pdf <levy-resolution.pdf> [--out <file>]");

  /*
   * **THE OPPOSITE EXTRACTOR FROM THE BALLOT LIST, AND THAT IS THE LESSON.**
   *
   * The obvious choice for a rate table is `pdftotext -layout`, because it
   * preserves columns. On this document it is WRONG: the label column and the
   * number columns are baseline-offset by one row, so `-layout` prints
   *
   *     Debt Service            11,380,492,838   38,773,339   0.3407
   *
   * where 0.3407 is the FLOOD CONTROL DISTRICT's rate and Debt Service's is
   * 0.0875 on the line above. A parser trusting that would publish a wrong tax
   * rate attributed to a real government, which is a false claim about
   * somebody's money.
   *
   * pdfjs — the repo's own extractor — emits this table in true reading order,
   * label immediately followed by its own three numbers, and is correct here.
   * On the Pima ballot candidate list the roles are exactly reversed. So there
   * is no "right extractor", only a right one per document, and the check is
   * to read a row whose answer is known from elsewhere before trusting the run.
   */
  const text = execFileSync(
    "node",
    ["--experimental-strip-types", "scripts/read-pdf.mts", pdf],
    { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
  );

  /*
   * pdfjs returns a page as one long line, so this is a single sequential scan
   * rather than a line loop: a heading and the rows under it are recovered in
   * document order from the same stream, which is the only way the CLASS a
   * jurisdiction belongs to stays attached to it.
   */
  const flat = text.replace(/\s+/g, " ");
  const out: Jurisdiction[] = [];
  const sections = new Set<string>();
  let section = "(no class heading seen before this line)";

  /* A row is `<label> <levy> <rate>` or `<label> <valuation> <levy> <rate>`. */
  const ROW = /([A-Za-z][A-Za-z0-9 .,&'"”()\-]{2,60}?)\s+((?:[\d,]{3,}\s+)?[\d,]{1,}\s+[\d]+\.[\d]{4})(?=\s|$)/g;
  /*
   * A class heading is ALL CAPS and ends in a colon.
   *
   * It may NOT contain a figure. pdfjs runs a page into one line, so the tail
   * of the preceding row sits immediately before the next heading and a looser
   * pattern swallows it — producing class labels like
   * `OF SOUTH TUCSON 829,268 2.8514 STREET LIGHTING IMPROVEMENT DISTRICTS`.
   * A district number is the one exception, and the resolution punctuates it
   * three different ways in the same document — `NO. 37`, `NO.12`, and `NO 1`
   * with no period at all — so all three are accepted. Requiring the period
   * silently lost Tucson Unified and Marana Unified, whose rows were then
   * attributed to the preceding class: a $146,498,365 school levy filed under
   * HEALTH DISTRICTS.
   */
  const HEAD = /\b((?:[A-Z][A-Z .,&'"”()\-]*)(?:NO\.? ?\d+ ?)?(?:[A-Z][A-Z .,&'"”()\-]*)?):/g;

  const marks: { at: number; kind: "head" | "row"; m: RegExpExecArray }[] = [];
  for (const m of flat.matchAll(HEAD)) marks.push({ at: m.index, kind: "head", m: m as RegExpExecArray });
  for (const m of flat.matchAll(ROW)) marks.push({ at: m.index, kind: "row", m: m as RegExpExecArray });
  marks.sort((a, b) => a.at - b.at);

  for (const mark of marks) {
    if (mark.kind === "head") {
      /*
       * Strip the page furniture that pdfjs runs into the front of a heading:
       * the repeating column header, the TOTAL line that ends the previous
       * class, and this extractor's own banner. Anything left that is not a
       * plausible class name is skipped rather than recorded as a government.
       */
      const s = mark.m[1]
        .replace(/\s+/g, " ")
        .replace(/^.*?TAX LEVY JURISDICTION VALUATION TAX LEVY RATE\s*/i, "")
        .replace(/^TOTAL (PRIMARY|SECONDARY)\s*/i, "")
        .replace(/^PIMA COUNTY FISCAL YEAR\s*/i, "")
        .trim();
      if (!s || s.length < 6 || /^(PDF|ATTEST|APPROVED AS TO FORM)/i.test(s)) continue;
      section = s;
      sections.add(section);
      continue;
    }
    let name = mark.m[1].replace(/\s+/g, " ").trim();
    /* A heading immediately precedes its first row; strip it off that row's label. */
    for (const s of sections) if (name.toUpperCase().startsWith(s)) name = name.slice(s.length).trim();
    if (!name || /^total/i.test(name)) continue;
    const cols = mark.m[2].trim().split(/\s+/);
    const rate = num(cols[cols.length - 1]);
    const levy = num(cols[cols.length - 2]);
    const valuation = cols.length >= 3 ? num(cols[cols.length - 3]) : null;
    out.push({ section, name, line: mark.m[0].trim(), valuation, levy, rate });
  }
  const withRate = out.filter((j) => j.rate !== null).length;
  console.log(`sections (government classes) named by the resolution: ${sections.size}`);
  for (const s of [...sections].sort()) console.log(`   ${s}`);
  console.log(
    `\n${floorLine(floored("lines carrying a rate", "the jurisdiction lines parsed", out.length, withRate))}`,
  );
  console.log("A line without a rate is a line this parser could not read, NEVER a government that levies nothing.\n");

  for (const j of out) {
    console.log(
      `${j.section.slice(0, 30).padEnd(30)} ${j.name.slice(0, 42).padEnd(42)} ` +
        `${j.rate === null ? "     —" : j.rate.toFixed(4).padStart(10)}  ${j.levy === null ? "" : `$${j.levy.toLocaleString()}`}`,
    );
  }

  const outFile = arg("out");
  if (outFile) {
    writeFileSync(
      outFile,
      `${JSON.stringify(
        {
          note:
            "Every entity that levies a property tax or special assessment in this county, from the county's own annual levy resolution under A.R.S. 42-17101 to 42-17110. A government that publishes nothing still appears here, because somebody has to collect its money. A jurisdiction with rate null is one this parser could not read off the line — never a government that levies nothing.",
          sections: [...sections].sort(),
          jurisdictions: out,
        },
        null,
        1,
      )}\n`,
      "utf8",
    );
    console.log(`\nwrote ${outFile}`);
  }
}

main();
