/**
 * **PARSING THE FEC's COMBINED FEDERAL/STATE DISCLOSURE AND ELECTION
 * DIRECTORY** — RULING 69 (NJ Hunt 2, 2026-08-22).
 *
 * ## Why the directory is parsed rather than committed as a PDF
 *
 * RULING 69 says the session fetches these documents into `data/reference/`.
 * RULING 20 says PDF binaries do not go in git — they are content-addressed
 * outside the repo with their hashes committed, while REFERENCE DATA and all
 * provenance stay in git.
 *
 * Both are satisfied by taking the directory's CONTENT rather than its
 * container: the rows land as a CSV in the repo's existing reference
 * convention, the PDF's URL, byte count and SHA-256 land in the provenance
 * note, and the 2.24 MB binary is not committed. The conflict is named on a
 * Needs Sean row rather than resolved by a session, because it is a conflict
 * between two of his rulings.
 *
 * ## The document's grammar
 *
 * One or more pages per state. Fields are `*`-delimited runs in reading order:
 *
 *   -80- NEW JERSEY DEPARTMENT OF STATE * Tahesha Way (Appointed, D) *
 *   -Chief Election Officer Secretary of State * State House * P.O. Box 300 *
 *   ... * URL https://www.nj.gov/state/ * 609/777-2581 FAX 609/777-1764 *
 *
 * Three things are reliable and everything else is prose:
 *
 *  - an ALL-CAPS run introduces an OFFICE (`DEPARTMENT OF STATE`, `ELECTION
 *    LAW ENFORCEMENT COMMISSION`, `STATE ETHICS COMMISSION`);
 *  - a `-` prefixed phrase names a RECORD that office holds (`-Chief Election
 *    Officer`, `-State and Local Campaign Finance Reports`);
 *  - `URL`, `E-Mail:` and a `NNN/NNN-NNNN` phone are labelled.
 *
 * ## What is NOT inferred
 *
 * The parser does not decide which office is "the" filing authority, and does
 * not claim what any office publishes. The directory says who holds which
 * records; whether that office puts a candidate's email in a PDF is a question
 * only a walk answers, and the NJ Hunt's whole finding is that the answer
 * varies by state with no national floor.
 *
 * A zero-row parse is a FAILED parse naming the document, never an empty
 * directory.
 */

import { extracted, zeroRows, type ExtractResult } from "../extract/types.ts";

/** One office in one state, as the directory prints it. */
export interface DirectoryOffice {
  /** The state, territory or federal heading this office sits under. */
  state: string;
  /** The office name, as printed in capitals. */
  office: string;
  /** The record types the directory says this office holds, semicolon-joined. */
  recordsHeld: string;
  /** The office's URL, where one is printed. */
  url: string;
  /** The office's email, where one is printed. */
  email: string;
  /** The office's telephone, where one is printed. */
  phone: string;
  /** The page of the directory this was read from. */
  page: number;
}

/**
 * Every state and territory heading the directory uses.
 *
 * Named explicitly rather than detected: an ALL-CAPS run is also how the
 * document writes an OFFICE, so "which capitals are a state" cannot be answered
 * by shape. A hand list here is a small, checkable fact; a rule would silently
 * turn `DEPARTMENT OF STATE` into a state called Department.
 */
const JURISDICTIONS = [
  "ALABAMA", "ALASKA", "AMERICAN SAMOA", "ARIZONA", "ARKANSAS", "CALIFORNIA",
  "COLORADO", "CONNECTICUT", "DELAWARE", "DISTRICT OF COLUMBIA", "FLORIDA",
  "GEORGIA", "GUAM", "HAWAII", "IDAHO", "ILLINOIS", "INDIANA", "IOWA", "KANSAS",
  "KENTUCKY", "LOUISIANA", "MAINE", "MARYLAND", "MASSACHUSETTS", "MICHIGAN",
  "MINNESOTA", "MISSISSIPPI", "MISSOURI", "MONTANA", "NEBRASKA", "NEVADA",
  "NEW HAMPSHIRE", "NEW JERSEY", "NEW MEXICO", "NEW YORK", "NORTH CAROLINA",
  "NORTH DAKOTA", "NORTHERN MARIANA ISLANDS", "OHIO", "OKLAHOMA", "OREGON",
  "PENNSYLVANIA", "PUERTO RICO", "RHODE ISLAND", "SOUTH CAROLINA",
  "SOUTH DAKOTA", "TENNESSEE", "TEXAS", "UTAH", "VERMONT", "VIRGINIA",
  "VIRGIN ISLANDS", "WASHINGTON", "WEST VIRGINIA", "WISCONSIN", "WYOMING",
] as const;

const URL_RE = /URL\s+(https?:\/\/\S+?)(?:\s|\*|$)/i;
const EMAIL_RE = /E-?Mail:?\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
const PHONE_RE = /(\d{3}\/\d{3}-\d{4})/;

/**
 * @param pages The PDF's text layer, one entry per page, in order.
 * @param sourceLabel What the document is, for the result's `source` field.
 */
export function parseFecDirectory(
  pages: readonly { page: number; text: string }[],
  sourceLabel: string,
): ExtractResult<DirectoryOffice> {
  const chars = pages.reduce((n, p) => n + p.text.length, 0);
  if (chars === 0) {
    return zeroRows(
      "TEXT_LAYER",
      sourceLabel,
      0,
      "the directory's text layer was empty — a fact about the fetch, not about the directory",
      { pages: pages.length },
    );
  }

  const rows: DirectoryOffice[] = [];
  let currentState = "";

  for (const p of pages) {
    /*
     * A page's own heading names its state, and the TABLE OF CONTENTS pages
     * name every state at once. Reading the state from the FIRST jurisdiction
     * that appears near the start of the page is what keeps a contents page
     * from re-assigning the reader to Wyoming.
     */
    const head = p.text.slice(0, 200).toUpperCase();
    const stateHere = JURISDICTIONS.filter((j) => head.includes(j)).sort(
      (a, b) => head.indexOf(a) - head.indexOf(b) || b.length - a.length,
    )[0];
    const contents = /TABLE OF CONTENTS/i.test(p.text);
    if (stateHere && !contents) currentState = stateHere;
    if (contents || !currentState) continue;

    /*
     * Split on the `*` the layout uses as a cell break. Reading order puts the
     * office heading first, then the person, then the address block; every one
     * of them is a cell, so the delimiter is the only structure available and
     * it is the one the document actually has.
     */
    const cells = p.text.split("*").map((c) => c.replace(/\s+/g, " ").trim()).filter(Boolean);

    let office = "";
    let records: string[] = [];
    let url = "";
    let email = "";
    let phone = "";
    const flush = () => {
      if (!office) return;
      rows.push({
        state: currentState,
        office,
        recordsHeld: records.join("; "),
        url,
        email,
        phone,
        page: p.page,
      });
      records = [];
      url = "";
      email = "";
      phone = "";
    };

    for (const cell of cells) {
      /*
       * An office heading is a cell that is entirely capitals and is not one of
       * the record labels, which are `-` prefixed. The page number marker
       * (`-80-`) and the "(Continued)" banner are furniture and are dropped by
       * name rather than by a shape rule that might eat a real heading.
       */
      const bare = cell.replace(/^-\d+-\s*/, "").replace(/\(Continued\)/i, "").trim();
      const isHeading =
        bare.length > 3 &&
        !bare.startsWith("-") &&
        bare === bare.toUpperCase() &&
        /[A-Z]{3}/.test(bare) &&
        !/^\d/.test(bare) &&
        // Labelled phone continuations are contact cells, even in capitals.
        !PHONE_RE.test(bare);
      if (isHeading) {
        const withoutState = JURISDICTIONS.reduce(
          (acc, j) => (acc.startsWith(j) ? acc.slice(j.length).trim() : acc),
          bare,
        );
        if (withoutState) {
          flush();
          office = withoutState;
        }
        continue;
      }
      if (cell.startsWith("-")) {
        const record = cell.replace(/^-\s*/, "").trim();
        if (record) records.push(record);
      }
      if (!url) url = URL_RE.exec(cell)?.[1] ?? "";
      if (!email) email = EMAIL_RE.exec(cell)?.[1] ?? "";
      if (!phone) phone = PHONE_RE.exec(cell)?.[1] ?? "";
    }
    flush();
  }

  if (rows.length === 0) {
    return zeroRows(
      "TEXT_LAYER",
      sourceLabel,
      chars,
      "the text layer was read but no office heading matched — the directory's layout has changed, or this " +
        "is not the directory",
      { pages: pages.length, textChars: chars },
    );
  }

  return extracted("TEXT_LAYER", sourceLabel, chars, rows, {
    offices: rows.length,
    jurisdictions: new Set(rows.map((r) => r.state)).size,
    withUrl: rows.filter((r) => r.url).length,
    withPhone: rows.filter((r) => r.phone).length,
    withEmail: rows.filter((r) => r.email).length,
    textChars: chars,
  });
}
