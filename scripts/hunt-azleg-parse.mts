/**
 * **THE ARIZONA LEGISLATURE'S TWO INDEXES, PARSED AGAINST THE MARKUP THEY
 * ACTUALLY SHIP.** (AZ04, 2026-08-28.)
 *
 * ## Why this is a module and not three regexes inside the hunter
 *
 * `www.azleg.gov` publishes two indexes that between them are the only
 * PERMITTED machine-readable record of what the Governor did with the
 * legislature's bills:
 *
 *   - `/governors-letters/`  — one row per bill the Governor wrote a letter
 *     about, linking a PDF under `/govlettr/<leg>leg/<sess>/<billno>.pdf`.
 *   - `/sessionlaws/`        — one row per CHAPTER of session law, linking the
 *     chaptered version under `/legtext/<Leg>Leg/<Sess>/laws/<NNNN>.pdf`.
 *
 * The modern bill-status application lives on `apps.azleg.gov`, which publishes
 * `User-agent: * / Disallow: /`. No path there is requested by anything in this
 * repository, and its URLs appear in the store as CROSS-REFERENCE STRINGS only.
 *
 * ## The markup trap, which is why a parser had to be written rather than reused
 *
 * Three separate deviations from well-formed HTML, all measured on the live
 * bytes, each of which silently produces a WRONG COUNT rather than an error:
 *
 *  1. **`<tr>` is never closed.** A parser that splits on `</tr>` — or any DOM
 *     shim that expects one — returns TWO rows for a 151-row table. Two rows
 *     is not an error; it is a plausible small number, and it would have been
 *     recorded as the whole index. Rows are therefore cut on the OPENING `<tr`.
 *  2. **Cells close as `</td >`, with a space before the `>`.** A `</td>`
 *     literal matches nothing at all, and the whole table reads as empty.
 *  3. **Short titles carry `&nbsp` with NO SEMICOLON** — a malformed entity
 *     that every strict decoder passes through as literal text, so a title
 *     renders to a reader as `SCHOOLS&nbsp;FUNDING`.
 *
 * Each is covered by a test against recorded bytes, because each is the kind
 * of defect that reports success.
 *
 * ## What this module refuses to do
 *
 * It never decides that a bill was VETOED. The lettered set and the chaptered
 * set are disjoint — 151 ∩ 264 = 0, measured — and that is CONSISTENT with
 * "every letter is a veto" without being evidence for it. An inference from
 * letter-minus-chapter would be a manufactured claim about a governmental act,
 * which is the one thing this product may never do. A letter's disposition is
 * read out of the letter's own words, by `parseGovernorLetter`, or it is left
 * unread and SAID to be unread.
 */

/** The one host that is permitted, and the only one this module builds URLs on. */
export const AZLEG_BASE = "https://www.azleg.gov";

/**
 * Text out of an azleg table cell.
 *
 * `&nbsp` without its semicolon is decoded FIRST and deliberately: it is the
 * malformed form this publisher actually emits, and the well-formed branch
 * would otherwise never be reached. Nothing here rewrites a title — the
 * publisher's words are the record — it only undoes their encoding.
 */
export function decodeCell(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;?/gi, " ")
    .replace(/&#0?39;|&apos;|&rsquo;|&#8217;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#0?45;|&ndash;|&mdash;/gi, "-")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The table rows of an azleg index page, as raw cell HTML.
 *
 * Split on the OPENING `<tr` (see the markup trap above) and match cells with
 * `</td\s*>` so the space-before-bracket close is caught. `rowsSeen` travels
 * back with the rows because a parser that finds nothing has told you about
 * itself, and the caller needs both numbers to tell "the table changed" from
 * "the page was not the page".
 */
export function tableRows(html: string): { rowsSeen: number; cells: string[][] } {
  const chunks = html.split(/<tr\b/i).slice(1);
  const cells: string[][] = [];
  for (const chunk of chunks) {
    const row = [...chunk.matchAll(/<td[^>]*>([\s\S]*?)<\/td\s*>/gi)].map((m) => m[1]);
    if (row.length > 0) cells.push(row);
  }
  return { rowsSeen: chunks.length, cells };
}

const href = (cellHtml: string): string | null =>
  cellHtml.match(/href\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;

const absolute = (url: string): string =>
  url.startsWith("http") ? url : `${AZLEG_BASE}${url.startsWith("/") ? "" : "/"}${url}`;

/** A bill designation, normalised to the publisher's own compact form. */
export function normaliseBillNumber(raw: string): string | null {
  const m = /\b([HS]\.?\s?[BCMJR]\.?\s?[A-Z]*)\s*\.?\s*(\d{3,4})\b/i.exec(raw.replace(/\s+/g, " "));
  if (!m) return null;
  const prefix = m[1].replace(/[.\s]/g, "").toUpperCase();
  return `${prefix}${m[2]}`;
}

export interface LetterRow {
  /** `HB2003`, the publisher's own designation for the bill. */
  billNumber: string;
  /** The PDF of the Governor's letter. Lowercase path, as published. */
  letterUrl: string;
  /** `57leg/2r`, read out of the letter path rather than assumed. */
  sessionId: string | null;
}

export interface LetterIndex {
  rowsSeen: number;
  rows: LetterRow[];
  /** Rows the parser saw and could not turn into a bill + letter pair. */
  rejected: { cells: string[]; why: string }[];
}

/**
 * `/governors-letters/` — `[Bill #][View Letter]`.
 *
 * A rejected row is KEPT and reported. A row this parser cannot read is a fact
 * about the parser; dropping it silently would let a markup change shrink the
 * index without anything saying so.
 */
export function parseLetterIndex(html: string): LetterIndex {
  const { rowsSeen, cells } = tableRows(html);
  const rows: LetterRow[] = [];
  const rejected: { cells: string[]; why: string }[] = [];
  const seen = new Set<string>();

  for (const row of cells) {
    const text = row.map(decodeCell);
    const link = row.map(href).find((h) => h && /\/govlettr\//i.test(h)) ?? null;
    const billNumber = normaliseBillNumber(text[0] ?? "") ?? normaliseBillNumber(text.join(" "));
    if (!billNumber || !link) {
      /* A header row has no link and no bill number; it is not a defect. */
      if (billNumber || link) rejected.push({ cells: text, why: !link ? "no /govlettr/ link" : "no bill number" });
      continue;
    }
    if (seen.has(billNumber)) {
      rejected.push({ cells: text, why: `duplicate bill ${billNumber}` });
      continue;
    }
    seen.add(billNumber);
    const url = absolute(link);
    rows.push({
      billNumber,
      letterUrl: url,
      sessionId: url.match(/\/govlettr\/(\d+leg\/\d+[a-z]?)\//i)?.[1]?.toLowerCase() ?? null,
    });
  }
  return { rowsSeen, rows, rejected };
}

export interface ChapterRow {
  /** The chapter number as an integer, for ordering and for gap detection. */
  chapter: number;
  /** The chaptered-version PDF, `/legtext/<Leg>Leg/<Sess>/laws/<NNNN>.pdf`. */
  chapteredVersionUrl: string;
  billNumber: string;
  /** The publisher's own short title. Never rewritten, only decoded. */
  shortTitle: string;
  sessionId: string | null;
}

export interface ChapterIndex {
  rowsSeen: number;
  rows: ChapterRow[];
  rejected: { cells: string[]; why: string }[];
  /**
   * Chapter numbers between 1 and the highest seen that the index did NOT
   * carry. Reported so "264 chapters" can be checked against "1..264 with no
   * holes" rather than asserted.
   */
  missingChapters: number[];
}

/** `/sessionlaws/` — `[Chapter #][Chaptered Version][Bill #][Short Title]`. */
export function parseSessionLawIndex(html: string): ChapterIndex {
  const { rowsSeen, cells } = tableRows(html);
  const rows: ChapterRow[] = [];
  const rejected: { cells: string[]; why: string }[] = [];

  for (const row of cells) {
    const text = row.map(decodeCell);
    const chapter = Number(text[0]?.replace(/[^0-9]/g, ""));
    const link = row.map(href).find((h) => h && /\/legtext\//i.test(h)) ?? null;
    const billNumber = normaliseBillNumber(text[2] ?? "") ?? normaliseBillNumber(text.join(" "));
    if (!Number.isInteger(chapter) || chapter <= 0 || !link || !billNumber) {
      if (link || billNumber) {
        rejected.push({
          cells: text,
          why: !link ? "no /legtext/ link" : !billNumber ? "no bill number" : "no chapter number",
        });
      }
      continue;
    }
    const url = absolute(link);
    rows.push({
      chapter,
      chapteredVersionUrl: url,
      billNumber,
      shortTitle: text[3] ?? "",
      sessionId: url.match(/\/legtext\/(\d+leg)\/(\d+[a-z]?)\//i)
        ? `${url.match(/\/legtext\/(\d+leg)\//i)![1].toLowerCase()}/${url.match(/\/legtext\/\d+leg\/(\d+[a-z]?)\//i)![1].toLowerCase()}`
        : null,
    });
  }

  const held = new Set(rows.map((r) => r.chapter));
  const highest = rows.reduce((max, r) => Math.max(max, r.chapter), 0);
  const missingChapters: number[] = [];
  for (let n = 1; n <= highest; n += 1) if (!held.has(n)) missingChapters.push(n);

  return { rowsSeen, rows, rejected, missingChapters };
}

/**
 * **HOW A BILL BECAME LAW, READ OFF THE ENROLLED ACT'S OWN STAMP.**
 * (AZ04, 2026-08-28 — and it overturns what this session was briefed.)
 *
 * The brief said an enacted bill's signing date had no permitted
 * machine-readable source, on the evidence that grepping a chaptered version
 * for `approved|governor|filed` returned nothing. **That measurement was of
 * the PDF's BYTES, not of its text.** These are born-digital PDFs and their
 * text lives inside compressed content streams, so a byte grep finds nothing
 * on a document that says it plainly. Extracted with the repo's own text-layer
 * instrument, chapter 1 ends:
 *
 *     APPROVED BY THE GOVERNOR FEBRUARY 6, 2026.
 *     FILED IN THE OFFICE OF THE SECRETARY OF STATE FEBRUARY 6, 2026.
 *
 * That is a signing date, published by the state, in the primary document. The
 * gap was ours, and it was a measurement artefact.
 *
 * ## Why the ROUTE is parsed and not just the date
 *
 * A chapter proves enactment, and enactment has three roads in Arizona:
 * signature, lapse into law without signature, and passage over a veto. The
 * stamp says which. Reading only the date and calling every chapter "signed"
 * would reintroduce, one layer down, exactly the false claim this session was
 * sent to remove. `UNDETERMINED` is returned when no stamp is found, and it
 * never degrades into `APPROVED_BY_GOVERNOR`.
 *
 * **Both dates are date-anchored.** A marker phrase with no parseable date
 * beside it yields a route and a NULL date, never a borrowed one.
 */
export type EnactmentRoute =
  | "APPROVED_BY_GOVERNOR"
  | "WITHOUT_SIGNATURE"
  | "OVER_VETO"
  | "UNDETERMINED";

export interface ChapterStamp {
  route: EnactmentRoute;
  /** The date on the Governor's approval stamp. Null unless one was read. */
  approvedAt: string | null;
  /** The date the act was filed with the Secretary of State. */
  filedAt: string | null;
  evidenceLine: string | null;
}

/** `FEBRUARY 6, 2026` -> `2026-02-06`. Null for anything it cannot read. */
function isoDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(raw.trim());
  const month = m ? MONTHS[m[1].toLowerCase()] : undefined;
  if (!m || !month) return null;
  return `${m[3]}-${month}-${String(Number(m[2])).padStart(2, "0")}`;
}

export function parseChapterStamp(text: string): ChapterStamp {
  const flat = text.replace(/\s+/g, " ").trim();

  const approved = /APPROVED BY THE GOVERNOR\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i.exec(flat);
  const filed = /FILED IN THE OFFICE OF THE SECRETARY OF STATE\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i.exec(flat);
  const unsigned = /BECAME LAW WITHOUT (?:THE )?GOVERNOR'?S? SIGNATURE|WITHOUT THE SIGNATURE OF THE GOVERNOR/i.exec(flat);
  const overVeto = /OVER (?:THE )?GOVERNOR'?S? VETO/i.exec(flat);

  /* Order matters: an act passed over a veto or left unsigned may still carry
     a FILED stamp, and only the approval stamp evidences a signature. */
  let route: EnactmentRoute = "UNDETERMINED";
  let hit: RegExpExecArray | null = null;
  if (overVeto) [route, hit] = ["OVER_VETO", overVeto];
  else if (unsigned) [route, hit] = ["WITHOUT_SIGNATURE", unsigned];
  else if (approved) [route, hit] = ["APPROVED_BY_GOVERNOR", approved];
  else if (filed) [route, hit] = ["UNDETERMINED", filed];

  return {
    route,
    approvedAt: route === "APPROVED_BY_GOVERNOR" ? isoDate(approved?.[1]) : null,
    filedAt: isoDate(filed?.[1]),
    evidenceLine: hit
      ? flat.slice(Math.max(0, hit.index - 20), Math.min(flat.length, hit.index + 190)).trim()
      : null,
  };
}

/**
 * How the Governor disposed of a bill, READ OUT OF HER OWN SENTENCE.
 *
 * `UNREAD` is the value when nobody has looked, and it is a different fact
 * from every other value here. It is what a scanned letter with no OCR engine
 * produces, and it is what travels to the reader as *"we have not read this
 * document yet"* — a statement about US.
 */
export type LetterDisposition = "VETOED" | "SIGNED" | "ALLOWED_WITHOUT_SIGNATURE" | "UNDETERMINED" | "UNREAD";

export interface ParsedLetter {
  disposition: LetterDisposition;
  /** `YYYY-MM-DD` if the letter's own dateline was read. Never inferred. */
  date: string | null;
  /** Every bill the letter's own text says it covers, including the subject. */
  coveredBills: string[];
  /** The sentence the disposition was read from, for a human to check. */
  evidenceLine: string | null;
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

/**
 * A Governor's transmittal letter, from its extracted or OCR'd text.
 *
 * Reads THREE things and asserts nothing else: the dateline, the disposition
 * verb in the Governor's own sentence, and the list of bills the letter says
 * it covers. One letter can cover many bills — SB1002's reads *"Today I vetoed
 * the following bills:"* and then lists several — so the covered set is parsed
 * from the RE: line and from the enumerated bills in the body, and the STORE
 * keys on the bill rather than on the letter.
 *
 * A letter whose verb cannot be found returns `UNDETERMINED`, which is a
 * finding about this parser on this text. It is never `SIGNED` by default: a
 * default disposition would be a manufactured claim about a governmental act.
 */
export function parseGovernorLetter(text: string): ParsedLetter {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length === 0) {
    return { disposition: "UNREAD", date: null, coveredBills: [], evidenceLine: null };
  }

  let date: string | null = null;
  const dm = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(flat);
  if (dm) {
    date = `${dm[3]}-${MONTHS[dm[1].toLowerCase()]}-${String(Number(dm[2])).padStart(2, "0")}`;
  }

  const verbs: [RegExp, LetterDisposition][] = [
    [/\bI\s+(?:have\s+)?vetoed\b|\bveto(?:ing)?\s+(?:of\s+)?[HS]/i, "VETOED"],
    [/\bwithout\s+my\s+signature\b|\ballow(?:ed|ing)?\s+.{0,40}\bbecome\s+law\b/i, "ALLOWED_WITHOUT_SIGNATURE"],
    [/\bI\s+(?:have\s+)?signed\b|\bI\s+am\s+signing\b/i, "SIGNED"],
  ];
  let disposition: LetterDisposition = "UNDETERMINED";
  let evidenceLine: string | null = null;
  for (const [re, value] of verbs) {
    const hit = re.exec(flat);
    if (!hit) continue;
    disposition = value;
    const at = hit.index;
    evidenceLine = flat.slice(Math.max(0, at - 60), Math.min(flat.length, at + 160)).trim();
    break;
  }

  /* Every bill designation the letter names, de-duplicated in reading order.
     The RE: line and the enumerated list both land here; which one a bill came
     from does not change that the letter says it is covered. */
  const coveredBills: string[] = [];
  for (const m of flat.matchAll(/\b[HS]\.?\s?[BCMJR]\.?\s?\d{3,4}\b/gi)) {
    const bill = normaliseBillNumber(m[0]);
    if (bill && !coveredBills.includes(bill)) coveredBills.push(bill);
  }

  return { disposition, date, coveredBills, evidenceLine };
}
