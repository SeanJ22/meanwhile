/**
 * New Jersey's filed-candidate lists, parsed: born-digital PDFs with a text
 * layer that publish each candidate's filed address and email.
 *
 *   1. A county clerk's filed-candidate list: every candidate for every office
 *      in the county.
 *   2. The Division of Elections' `-emails-` list for federal office.
 *
 * The text layer is one run per page with no row structure, so the grammar is
 * anchored on an office heading in capitals and the email that ends each
 * candidate's run; the email is the only record boundary a slogan or an
 * address cannot forge.
 *
 * A zero-row parse is a failed parse with a reason. A jurisdiction the
 * document says has `NO LOCAL ELECTION` is returned as such, separately.
 */

import { extracted, zeroRows, type ExtractResult } from "../extract/types.ts";
import { isMorrisGeneralCandidatesDocument, isMorrisSchoolCandidatesDocument } from "../civic-data/morris-filing-documents.ts";

/** One candidate, as the filing itself states them. */
export interface FiledCandidate {
  /** The municipality or jurisdiction heading the row sits under. */
  jurisdiction: string;
  /** The office, in the document's own words, capitals normalised. */
  office: string;
  /** Surname as filed — the clerk prints it in capitals. */
  familyName: string;
  /** Given name(s) as filed, including any quoted nickname. */
  givenName: string;
  /** Party or, for a school election, the designation. Null where none is printed. */
  party: string | null;
  /** The ballot slogan, where the candidate filed one. */
  slogan: string | null;
  /** The filed address, as one line. */
  address: string | null;
  /** The filed email. */
  email: string | null;
  /** Term length in years, where the document states it. */
  termYears: number | null;
  /** Seats to be filled, where the document states it. */
  voteFor: number | null;
  /**
   * The document's own DISTRICT column, where it prints one (`Town`,
   * `Township`, `Borough`, or a named regional district). Needed because the
   * municipality alone resolves a regional board seat to the wrong board.
   */
  district: string | null;
}

/**
 * A jurisdiction the document explicitly says has no contest: a positive
 * statement by the clerk, the only evidence that justifies rendering a
 * municipality with no contests.
 */
export interface FiledNoElection {
  jurisdiction: string;
  statement: string;
}

/**
 * A seat in a real contest that a party filed nobody for (`No Nomination
 * Made <Party>`): the filing authority's own statement, not a candidate.
 */
export interface FiledUnfilledSeat {
  jurisdiction: string;
  office: string;
  /** The party that filed nobody, where the document names one. */
  party: string | null;
  statement: string;
}

export interface FilingParse {
  candidates: FiledCandidate[];
  noElection: FiledNoElection[];
  unfilled: FiledUnfilledSeat[];
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/**
 * Office headings are the all-caps runs of more than one word that repeat
 * (`MEMBER OF THE BOARD OF EDUCATION UNEXPIRED TERM`, `MEMBER OF THE BOROUGH
 * COUNCIL`); a ward suffix (`- WARD 1`) is part of the office. Bare `MAYOR` is
 * a heading too, safe because the term and seat digits follow it.
 *
 * - A space is part of the heading only when a digit does not follow it
 *   (except `- WARD 1`), so the heading stops before the term/seat digits.
 * - `(?![a-z])` ends an all-caps run where the capitals end, so it never eats
 *   the next word's capital.
 */
const OFFICE_RE =
  /((?:MEMBER OF THE|DOVER BOARD OF EDUCATION CANDIDATES|NO LOCAL ELECTION)(?:\s*-\s*WARD\s\d+|\sWARD\s\d+|[A-Z.'\-/]+(?![a-z])|\s(?!\d))*|MAYOR(?=\s+\d{1,2}\s+\d{1,2}\s))/;

/** `3 2` after an office heading is term-years then seats. */
const TERM_SEATS_RE = /^\s*(\d{1,2})\s+(\d{1,2})\b/;

/**
 * The jurisdiction is the run of Title-Case words immediately before an
 * office heading. Hyphenated names (`Parsippany-Troy Hills Township`) and a
 * slash joining two municipalities into one filing jurisdiction
 * (`Chester Borough/Township`) are part of it.
 */
const JURISDICTION_TAIL_RE =
  /((?:[A-Z][a-z]+(?:[-/][A-Z][a-z]+)*|[0-9]+(?:st|nd|rd|th)|of|the)(?:\s+(?:[A-Z][a-z]+(?:[-/][A-Z][a-z]+)*|[0-9]+(?:st|nd|rd|th)|of|the)){0,3})\s*$/;

/**
 * The surname is filed in capitals and the given name is not. A quoted
 * nickname (`Given "Nick" SURNAME`) and a comma suffix (`Given D. SURNAME, JR.`)
 * are handled here.
 */
const NAME_RE =
  /([A-Z][A-Za-zÀ-ÿ'’.\- ]*?(?:"[^"]+"\s+|\([^)]+\)\s+)?)([A-ZÀ-Ÿ][A-ZÀ-Ÿ'’\-]+(?:\s+[A-ZÀ-Ÿ'’\-]+)*(?:,\s*(?:JR|SR|II|III|IV)\.?)?)\s*$/;

/**
 * The two ways a seat goes unclaimed: `No Nomination Made <Party>` in the
 * general-election document, `NO PETITION FILED` (no party) in the school
 * document. Recorded the same way.
 */
const UNFILLED_PHRASE = "(?:No Nomination Made|NO PETITION FILED)";

/**
 * Column headers sit right before the first office heading, where the
 * jurisdiction rule looks. Anchored on `CONTEST TITLE`, which both documents
 * print, and stopping at `Email`, the header's last column, so the first
 * municipality is kept.
 */
const HEADER_RUN_RE = /^[\s\S]*?CONTEST TITLE[\s\S]*?\bEmail\b/i;

/**
 * The school document's DISTRICT column sits between the seat count and the
 * first name; on an unclaimed-seat row nothing follows it, so it is consumed
 * together with the unclaimed-seat phrase.
 */
const DISTRICT_COLUMN = "(?:(?:[A-Z][A-Za-z]+\\s+){0,3}Regional|Town|Township|Borough|City|Village)";

/**
 * The district cell, read off the head of a contest body. Real district names
 * are matched before the bare type words, so a regional district's full name
 * is captured. A ward marker (`W1`) is accepted too.
 */
const DISTRICT_CELL_RE = new RegExp(
  "^\\s*(" +
    [
      "School District of the [A-Z][A-Za-z]+",
      "(?:[A-Z][A-Za-z]+\\s+){1,3}(?:Regional|School District)",
      "Town|Township|Borough|City|Village|Regional",
      "At Large",
      "W\\d+",
    ].join("|") +
    ")(?=\\s+[A-Z])",
);

const PARTIES = [
  "Democratic",
  "Republican",
  "Democrat",
  "Independent",
  "Green Party",
  "Libertarian Party",
  "Socialist Workers Party",
  "Conservative Party",
];

/**
 * Parse one county-clerk or Division-of-Elections filed-candidate document.
 *
 * @param text The PDF's text layer, pages joined (what `extractTextLayer`
 *   returned). No fetching or extraction here.
 * @param sourceLabel What the document is, for the result's `source` field.
 */
export function parseNjFiling(
  text: string,
  sourceLabel: string,
): ExtractResult<FiledCandidate | FiledNoElection | FiledUnfilledSeat> {
  if (!text.trim()) {
    return zeroRows(
      "TEXT_LAYER",
      sourceLabel,
      0,
      "the document's text layer was empty — nothing to parse, and this is a fact about the fetch rather than about the filing",
      { pages: 0 },
    );
  }

  const candidates: FiledCandidate[] = [];
  const noElection: FiledNoElection[] = [];
  /** Seats a party filed nobody for, as the clerk records them. */
  const unfilled: FiledUnfilledSeat[] = [];
  let previousJurisdiction = "";
  let previousHeading = "";

  /*
   * Walk the office headings in order. Everything between one heading and the
   * next belongs to that office, and the jurisdiction is the Title-Case tail of
   * whatever preceded the heading.
   */
  const parts = text.split(OFFICE_RE);
  /* parts[0] is the preamble; then [heading, body] pairs. */
  let carriedJurisdiction = "";

  for (let i = 1; i < parts.length; i += 2) {
    const heading = (parts[i] ?? "").trim().replace(/\s+/g, " ");
    const before = parts[i - 1] ?? "";
    const body = parts[i + 1] ?? "";

    /*
     * The Title-Case run before a heading may also hold an unclaimed-seat
     * phrase or the page-one table header:
     *
     *   ...No Nomination Made <Party> | <Jurisdiction> | MEMBER OF THE...
     *   ...Street Address City State Zip Email | MEMBER OF THE UNITED STATES...
     *
     * The unclaimed seat is recorded for the previous contest; the header is cut.
     */
    const cleanedBefore = before
      .trimEnd()
      /*
       * Removed globally, not anchored to the end: the unfilled-seat phrase
       * comes before the next contest's jurisdiction.
       */
      .replace(
        new RegExp(
          `(?:\\s+${DISTRICT_COLUMN})?\\s*${UNFILLED_PHRASE}(?:\\s+(?:${PARTIES.join("|")}))?`,
          "g",
        ),
        " ",
      )
      .replace(HEADER_RUN_RE, "")
      .replace(/\bFirst Name and Middle Initial\b.*$/i, "")
      .replace(/\bStreet Address\s+City\s+State\s+Zip\s+Email\s*$/i, "")
      .trimEnd();
    const jm = JURISDICTION_TAIL_RE.exec(cleanedBefore);
    const jurisdiction = (jm?.[1] ?? carriedJurisdiction).trim();
    if (jurisdiction) carriedJurisdiction = jurisdiction;

    /*
     * Every `No Nomination Made` in the run before this heading belongs to the
     * previous contest, whose jurisdiction is still carried.
     */
    for (const nm of before.matchAll(
      new RegExp(`${UNFILLED_PHRASE}(?:\\s+(${PARTIES.join("|")}))?`, "gi"),
    )) {
      unfilled.push({
        jurisdiction: previousJurisdiction || carriedJurisdiction,
        office: previousHeading,
        party: nm[1] ?? null,
        statement:
          `${previousJurisdiction || carriedJurisdiction}, ${previousHeading}: ` +
          `${nm[1] ?? "a party"} filed no candidate for a seat — stated by the filing authority in this document.`,
      });
    }
    previousJurisdiction = jurisdiction;
    previousHeading = heading;

    if (heading.startsWith("NO LOCAL ELECTION")) {
      noElection.push({
        jurisdiction,
        statement: `${jurisdiction}: NO LOCAL ELECTION — stated by the filing authority in this document.`,
      });
      continue;
    }

    const ts = TERM_SEATS_RE.exec(body);
    const termYears = ts ? Number(ts[1]) : null;
    const voteFor = ts ? Number(ts[2]) : null;

    /*
     * Split the body on emails. Each chunk ends with the email of the candidate
     * named in it.
     */
    let rest = ts ? body.slice(ts[0].length) : body;
    /*
     * A district-type token sits between the seat count and the first name and
     * is read, not skipped (see `FiledCandidate.district`).
     */
    const dm = DISTRICT_CELL_RE.exec(rest);
    const district = dm ? dm[1]!.trim() : null;
    if (dm) rest = rest.slice(dm[0].length);
    for (;;) {
      const em = EMAIL_RE.exec(rest);
      if (!em) break;
      const chunk = rest.slice(0, em.index);
      const email = em[0];
      rest = rest.slice(em.index + em[0].length);

      const row = parseCandidateChunk(chunk, jurisdiction, heading, termYears, voteFor);
      if (row) candidates.push({ ...row, district, email });
    }

    /*
     * `No Nomination Made` is not recorded as a person; it is a fact about the
     * contest.
     */
    const tail = rest.replace(/\s+/g, " ").trim();
    if (tail && !new RegExp(UNFILLED_PHRASE, "i").test(tail)) {
      const row = parseCandidateChunk(tail, jurisdiction, heading, termYears, voteFor);
      if (row) candidates.push({ ...row, district, email: null });
    }
  }

  /*
   * The last contest's trailing rows have no heading after them, so they are
   * scanned here.
   */
  for (const nm of (parts[parts.length - 1] ?? "").matchAll(
    new RegExp(`${UNFILLED_PHRASE}(?:\\s+(${PARTIES.join("|")}))?`, "gi"),
  )) {
    unfilled.push({
      jurisdiction: previousJurisdiction,
      office: previousHeading,
      party: nm[1] ?? null,
      statement:
        `${previousJurisdiction}, ${previousHeading}: ${nm[1] ?? "a party"} filed no candidate for a seat — ` +
        "stated by the filing authority in this document.",
    });
  }

  const rows: (FiledCandidate | FiledNoElection | FiledUnfilledSeat)[] = [
    ...candidates,
    ...noElection,
    ...unfilled,
  ];
  if (rows.length === 0) {
    return zeroRows(
      "TEXT_LAYER",
      sourceLabel,
      text.length,
      "the text layer was read but no office heading matched — the document's grammar has changed, or this is not a filed-candidate list",
      { textChars: text.length },
    );
  }

  return extracted("TEXT_LAYER", sourceLabel, text.length, rows, {
    candidates: candidates.length,
    withEmail: candidates.filter((c) => c.email).length,
    withAddress: candidates.filter((c) => c.address).length,
    noElection: noElection.length,
    unfilledSeats: unfilled.length,
    textChars: text.length,
  });
}

function parseCandidateChunk(
  chunk: string,
  jurisdiction: string,
  office: string,
  termYears: number | null,
  voteFor: number | null,
): Omit<FiledCandidate, "email" | "district"> | null {
  const flat = chunk.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (new RegExp(`^${UNFILLED_PHRASE}`, "i").test(flat)) return null;

  /*
   * The address ends the chunk and is recognised by its state-and-zip tail, so
   * it is cut first. It may start with `P.O. Box`; a PO box number is never
   * read as a street number.
   */
  const addrMatch =
    /((?:P\.?\s?O\.?\s+Box\s+\d+|\d)[^,]*?(?:,\s*[^,]*?)?\s+(?:NJ|New Jersey)\s+\d{5}(?:-\d{4})?)\s*$/i.exec(
      flat,
    );
  const address = addrMatch ? addrMatch[1].replace(/\s+/g, " ").trim() : null;
  let head = addrMatch ? flat.slice(0, addrMatch.index).trim() : flat;

  /*
   * A leading district-type token (`Township`, `Borough`, `Town`, `City`, `W1`,
   * a regional district's name) is structure; dropped only when it leads.
   */
  head = head.replace(
    /^(?:Township|Borough|Town|City|Village|W\d+|At Large|[A-Z][a-z]+(?: [A-Z][a-z]+)* Regional)\s+/,
    "",
  );

  let party: string | null = null;
  for (const p of PARTIES) {
    const re = new RegExp(`\\s${p}\\b`);
    if (re.test(head)) {
      party = p === "Democrat" ? "Democratic" : p;
      head = head.replace(re, " ");
      break;
    }
  }

  /*
   * What remains is `[given] [SURNAME] [slogan]`; the slogan is cut at the
   * surname's trailing capital run.
   */
  head = head.replace(/\s+/g, " ").trim();
  const nm = NAME_RE.exec(head);
  let givenName = "";
  let familyName = "";
  let slogan: string | null = null;

  if (nm) {
    givenName = nm[1].trim();
    familyName = nm[2].trim();
  } else {
    /*
     * The surname run is followed by a slogan. Find the LAST all-caps token run
     * and treat everything after it as the slogan.
     */
    const caps = /([A-ZÀ-Ÿ][A-ZÀ-Ÿ'’\-]{1,}(?:\s+[A-ZÀ-Ÿ'’\-]{2,})*(?:,\s*(?:JR|SR|II|III|IV)\.?)?)/g;
    let last: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    while ((m = caps.exec(head))) {
      /* Skip runs that are plainly a slogan in caps rather than a surname. */
      if (m[0].split(/\s+/).length > 3) continue;
      last = m;
    }
    if (!last) return null;
    givenName = head.slice(0, last.index).trim();
    familyName = last[1].trim();
    const after = head.slice(last.index + last[1].length).trim();
    if (after) slogan = after;
  }

  if (!familyName) return null;

  /* A quoted or parenthesised nickname belongs to the given name, not a slogan. */
  const sloganMatch = /^(.*?)\s*("[^"]+"|[A-Z][A-Za-z]+(?:[ ,!]+[A-Za-z][A-Za-z]*)*[!]?)$/.exec(
    givenName,
  );
  if (!slogan && sloganMatch && /^["']/.test(sloganMatch[2] ?? "")) {
    /* leave it — a quoted nickname stays with the given name */
  }

  return {
    jurisdiction,
    office: office.replace(/\s+/g, " ").trim(),
    familyName,
    givenName: givenName.replace(/\s+/g, " ").trim(),
    party,
    slogan: slogan?.replace(/\s+/g, " ").trim() || null,
    address,
    termYears,
    voteFor,
  };
}

/**
 * The two documents this branch reads, per county and per state. Templates,
 * not URLs: a clerk's asset path carries a version segment that changes with
 * every revision, so discovery reads the page's own `.pdf` hrefs and takes the
 * newest.
 */
export const NJ_FILING_SOURCES = {
  /** The Division of Elections' 2026 hub, whose own hrefs name the current PDFs. */
  stateHub:
    "https://www.nj.gov/state/elections/election-information-2026.shtml",
  /** The county clerk's page, whose own hrefs name the current PDFs. */
  morrisClerkCandidates:
    "https://www.morriscountyclerk.org/Elections/Current-Election-Candidates",
} as const;

/**
 * Pick the freshest revision of each document from a page's own hrefs; older
 * revisions stay reachable at older version paths. The filename stamp may be
 * MMDDYY, MDDYYYY or absent, so between two revisions of one document the
 * clerk's asset version (`/v/<n>/`) decides first and the date second.
 */
export function newestFilingPdfs(html: string, origin: string): string[] {
  const hrefs = [...html.matchAll(/href="([^"]+\.pdf)"/gi)].map((m) => m[1]!);
  const byStem = new Map<string, { url: string; revision: FilingRevision }>();
  for (const href of hrefs) {
    const url = href.startsWith("http") ? href : new URL(href, origin).toString();
    const file = url.split("/").pop() ?? "";
    const stem = file.replace(/-\d{6,8}\.pdf$/, "").replace(/\.pdf$/, "");
    const revision = filingRevision(url);
    const prev = byStem.get(stem);
    if (!prev || newerRevision(revision, prev.revision)) byStem.set(stem, { url, revision });
  }
  return [...byStem.values()].map((v) => v.url);
}

interface FilingRevision {
  /** The clerk CMS's asset version from a `/v/<n>/` path segment, when there is one. */
  readonly assetVersion: number | null;
  /** The filename stamp as YYYYMMDD, when there is one. */
  readonly date: string | null;
}

function filingRevision(url: string): FilingRevision {
  const version = /\/v\/(\d+)\//.exec(url);
  const stamp = /-(\d{6,8})\.pdf(?:$|[?#])/i.exec(url)?.[1] ?? null;
  return { assetVersion: version ? Number(version[1]) : null, date: stamp ? stampDate(stamp) : null };
}

/** MMDDYY, MDDYYYY or MMDDYYYY as YYYYMMDD; anything else is no date. */
function stampDate(stamp: string): string | null {
  const [month, day, year] =
    stamp.length === 6 ? [stamp.slice(0, 2), stamp.slice(2, 4), `20${stamp.slice(4)}`]
    : stamp.length === 7 ? [`0${stamp.slice(0, 1)}`, stamp.slice(1, 3), stamp.slice(3)]
    : [stamp.slice(0, 2), stamp.slice(2, 4), stamp.slice(4)];
  const m = Number(month);
  const d = Number(day);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${year}${month}${day}` : null;
}

function newerRevision(candidate: FilingRevision, held: FilingRevision): boolean {
  if (candidate.assetVersion !== null && held.assetVersion !== null && candidate.assetVersion !== held.assetVersion) {
    return candidate.assetVersion > held.assetVersion;
  }
  return (candidate.date ?? "") > (held.date ?? "");
}

export interface MorrisCurrentFilingDocumentSet {
  readonly generalCandidatesUrl: string;
  readonly schoolCandidatesUrl: string;
}

/**
 * Resolve the clerk page's two-document 2026 general-election filing horizon:
 * the general candidate document and the school candidate document. Either
 * alone is a partial acquisition.
 */
/**
 * One current document of a class: its strictly newest revision. With no
 * strictly newest, every tie is returned and the caller refuses the set.
 */
function currentOfClass(urls: readonly string[]): string[] {
  if (urls.length <= 1) return [...urls];
  const ranked = urls.map((url) => ({ url, revision: filingRevision(url) }));
  const newest = ranked.filter((row) =>
    ranked.every((other) => other === row || newerRevision(row.revision, other.revision)),
  );
  return newest.length === 1 ? [newest[0]!.url] : [...urls];
}

export function morrisCurrentFilingDocumentSet(
  discoveredUrls: readonly string[],
): MorrisCurrentFilingDocumentSet {
  const eligible = discoveredUrls.filter((url) => {
    if (/candidate-order/i.test(url)) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && parsed.hostname.toLowerCase() === "www.morriscountyclerk.org";
    } catch {
      return false;
    }
  });
  // The date stamp is optional. One naming rule for this selector and the
  // candidate validator: lib/civic-data/morris-filing-documents.ts.
  const general = currentOfClass(eligible.filter(isMorrisGeneralCandidatesDocument));
  const school = currentOfClass(eligible.filter(isMorrisSchoolCandidatesDocument));
  if (general.length !== 1 || school.length !== 1) {
    throw new Error(
      "MORRIS_CURRENT_FILING_DOCUMENT_SET_INCOMPLETE: " +
        `expected exactly one current general-candidate PDF and one current school-candidate PDF; ` +
        `found general=${general.length}, school=${school.length}.`,
    );
  }
  if (general[0] === school[0]) {
    throw new Error("MORRIS_CURRENT_FILING_DOCUMENT_SET_INCOMPLETE: the two required document classes resolved to one URL.");
  }
  return {
    generalCandidatesUrl: general[0]!,
    schoolCandidatesUrl: school[0]!,
  };
}
