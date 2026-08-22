/**
 * **NEW JERSEY'S FILED-CANDIDATE LISTS, PARSED** (built 2026-08-22, NJ Hunt,
 * item 5 — the branch that answers the session's headline question).
 *
 * ## What this is, and why it is a finding rather than a convenience
 *
 * New Hampshire's manifest walk (NH Hunt 6) found ONE contact for THIRTEEN
 * county candidates, because `filing-state` in New Hampshire publishes a name,
 * a town and a party and nothing a reader can reach a person with. Twenty-eight
 * of the thirty-five `contact` routes needed a human.
 *
 * **New Jersey publishes the contact itself.** Two documents, both born-digital
 * PDFs with a real text layer, both answering a plain rung-2 fetch:
 *
 *   1. **The county clerk's filed-candidate list** — every candidate for every
 *      office in the county, with the FILED STREET ADDRESS and the FILED EMAIL.
 *      Morris County's carries all fifteen 07866 candidates, school board
 *      included, in one 85 KB file.
 *   2. **The Division of Elections' `-emails-` list** — the state's own list
 *      for federal office, published as a SEPARATE PDF from the candidate list
 *      precisely because it is the contact document.
 *
 * That is not a better parser. It is a different publishing practice, and it is
 * the whole of the difference the NJ Hunt was run to measure. The route ids are
 * `filing-county` and `filing-state`, both already in the manifest as
 * human-only routes; this moves them to mechanical **in New Jersey**, and
 * RULING 60 governs the rest — proven for this SHAPE, not for everywhere.
 *
 * ## The parse, and why it is positional rather than line-based
 *
 * The text layer arrives as ONE run of text per page with no row structure —
 * `pdfjs` gives back reading order, not a grid. So the grammar is anchored on
 * the two things the document guarantees: an office heading in capitals, and an
 * email address at the end of each candidate's run. Between them sit the name,
 * an optional slogan, and the address. Splitting on the EMAIL is what makes the
 * record boundary reliable, because an address contains capitals, a slogan
 * contains capitals, and a name contains capitals, but only one field per
 * candidate matches an email.
 *
 * ## Every parse reports its counts
 *
 * `ExtractResult` is the shared contract and a ZERO-ROW parse is a FAILED parse
 * with a reason, never an empty document. A run that finds no candidates for a
 * municipality that the document itself says has `NO LOCAL ELECTION` is a
 * different fact from a run that found nothing because the grammar broke, and
 * the two are returned differently.
 */

import { extracted, zeroRows, type ExtractResult } from "../extract/types.ts";

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
}

/**
 * A jurisdiction the document explicitly says has no contest.
 *
 * **This is why the parser cannot just return rows.** "Rockaway Township NO
 * LOCAL ELECTION" is a POSITIVE statement by the county clerk, and it is the
 * only evidence that would ever justify rendering a municipality with no
 * contests. Dropping it and returning zero rows for that town would turn the
 * clerk's statement into our silence, which is the render-default defect one
 * layer down.
 */
export interface FiledNoElection {
  jurisdiction: string;
  statement: string;
}

export interface FilingParse {
  candidates: FiledCandidate[];
  noElection: FiledNoElection[];
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/**
 * Office headings are printed in capitals and are the only all-caps runs of
 * more than one word that repeat. `MEMBER OF THE BOARD OF EDUCATION UNEXPIRED
 * TERM` and `MEMBER OF THE BOROUGH COUNCIL` are the shapes; a ward suffix
 * (`- WARD 1`) rides along and is kept, because it is part of the office.
 */
/*
 * **The heading must STOP before the term/seat digits, and that is not a
 * cosmetic point.** A greedy `[A-Z0-9 ]*` swallows the ` 3 2 ` that follows and
 * then eats the first letter of the district-type token behind it, so
 * `Township Lisa MEZIK` parses as a candidate named `ownship Lisa`. The first
 * run of this parser produced exactly that for all six Rockaway candidates —
 * a name this product would have printed next to a real person's face.
 *
 * So a space is only part of the heading when a digit does NOT follow it, with
 * one exception the corpus requires: `- WARD 1` is part of the office.
 */
const OFFICE_RE =
  /((?:MEMBER OF THE|DOVER BOARD OF EDUCATION CANDIDATES|NO LOCAL ELECTION)(?:\s*-\s*WARD\s\d+|\sWARD\s\d+|[A-Z.'\-/]+|\s(?!\d))*)/;

/** `3 2` after an office heading is term-years then seats. */
const TERM_SEATS_RE = /^\s*(\d{1,2})\s+(\d{1,2})\b/;

/**
 * The jurisdiction is the run of Title-Case words immediately before an office
 * heading — `Rockaway Township`, `Victory Gardens Borough`, `Morris County`,
 * `11th Congressional`.
 */
const JURISDICTION_TAIL_RE =
  /((?:[A-Z][a-z]+|[0-9]+(?:st|nd|rd|th)|of|the)(?:\s+(?:[A-Z][a-z]+|[0-9]+(?:st|nd|rd|th)|of|the)){0,3})\s*$/;

/**
 * The surname is filed in CAPITALS and the given name is not, which is what
 * makes a name findable in an unstructured run. A quoted nickname
 * (`Munir "Monir" MAMOUN`) and a comma suffix (`Clifford D. DAWKINS, JR.`) both
 * occur in the real corpus and are both handled here rather than in a caller.
 */
const NAME_RE =
  /([A-Z][A-Za-zÀ-ÿ'’.\- ]*?(?:"[^"]+"\s+|\([^)]+\)\s+)?)([A-ZÀ-Ÿ][A-ZÀ-Ÿ'’\-]+(?:\s+[A-ZÀ-Ÿ'’\-]+)*(?:,\s*(?:JR|SR|II|III|IV)\.?)?)\s*$/;

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
 * @param text The PDF's text layer, pages joined. Pass what
 *   `extractTextLayer` returned — this does no fetching and no extraction of
 *   its own, so a caller can hand it a fixture and get the identical answer.
 * @param sourceLabel What the document is, for the result's `source` field.
 */
export function parseNjFiling(
  text: string,
  sourceLabel: string,
): ExtractResult<FiledCandidate | FiledNoElection> {
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

    const jm = JURISDICTION_TAIL_RE.exec(before.trimEnd());
    const jurisdiction = (jm?.[1] ?? carriedJurisdiction).trim();
    if (jurisdiction) carriedJurisdiction = jurisdiction;

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
     * Split the body on emails. Each chunk ENDS with the email belonging to the
     * candidate named in it, which is the only boundary this document offers
     * that a slogan or an address cannot forge.
     */
    let rest = ts ? body.slice(ts[0].length) : body;
    /* A district-type token (`Township`, `Borough`, `W1`, `Morris Hills Regional`) sits between the seat count and the first name. */
    for (;;) {
      const em = EMAIL_RE.exec(rest);
      if (!em) break;
      const chunk = rest.slice(0, em.index);
      const email = em[0];
      rest = rest.slice(em.index + em[0].length);

      const row = parseCandidateChunk(chunk, jurisdiction, heading, termYears, voteFor);
      if (row) candidates.push({ ...row, email });
    }

    /*
     * A candidate with no email still exists. `No Nomination Made` is one of
     * them and is deliberately NOT recorded as a person — it is the filing
     * authority saying a party filed nobody, which is a fact about the contest.
     */
    const tail = rest.replace(/\s+/g, " ").trim();
    if (tail && !/^No Nomination Made/i.test(tail)) {
      const row = parseCandidateChunk(tail, jurisdiction, heading, termYears, voteFor);
      if (row) candidates.push({ ...row, email: null });
    }
  }

  const rows: (FiledCandidate | FiledNoElection)[] = [...candidates, ...noElection];
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
    textChars: text.length,
  });
}

function parseCandidateChunk(
  chunk: string,
  jurisdiction: string,
  office: string,
  termYears: number | null,
  voteFor: number | null,
): Omit<FiledCandidate, "email"> | null {
  const flat = chunk.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (/^No Nomination Made/i.test(flat)) return null;

  /*
   * The address ends the chunk and is recognisable by its state-and-zip tail.
   * Cutting it off first is what leaves a name-plus-slogan run behind; trying
   * to find the name first fails, because an address contains capitals too.
   */
  /*
   * **THE ADDRESS MAY START WITH `P.O. Box`, AND REQUIRING A LEADING DIGIT
   * TRUNCATED IT INTO A LIE.**
   *
   * The first version anchored on `\d`, so `P.O. Box 999 Edison NJ 08818`
   * matched from the `999` and was stored as `999 Edison NJ 08818` — a PO box
   * number rendered as a street number, which is a specific, checkable, wrong
   * address for a named candidate. Two of the fifteen 07866 candidates file a
   * PO box, so this was not an edge case; it was a sixth of the down-ballot
   * tier.
   */
  const addrMatch =
    /((?:P\.?\s?O\.?\s+Box\s+\d+|\d)[^,]*?(?:,\s*[^,]*?)?\s+(?:NJ|New Jersey)\s+\d{5}(?:-\d{4})?)\s*$/i.exec(
      flat,
    );
  const address = addrMatch ? addrMatch[1].replace(/\s+/g, " ").trim() : null;
  let head = addrMatch ? flat.slice(0, addrMatch.index).trim() : flat;

  /*
   * A leading district-type token is structure, not content. `Township`,
   * `Borough`, `Town`, `City`, `W1`, and a regional district's name all appear
   * between the seat count and the first candidate; they are dropped only when
   * they LEAD, so a surname that happens to be `Town` is untouched.
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
   * What remains is `[given] [SURNAME] [slogan]` — the slogan follows the name
   * and is Title Case or quoted. Anchoring the name match to the END of a
   * name-only run means the slogan has to come off first, and the only reliable
   * cut is the surname's trailing capital run.
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
 * The two documents this branch reads, per county and per state.
 *
 * **These are TEMPLATES, not a hand-kept list of URLs.** A hand-kept registry of
 * fourteen state URLs is exactly the class defect this repo swept in F-series,
 * and a county clerk's asset path carries a version segment (`/v/9/`) that
 * changes every time the clerk revises the document. So the discovery step is
 * always: fetch the clerk's candidates PAGE, read its own `.pdf` hrefs, and take
 * the newest. `pnpm nj:filing` does that; nothing here hardcodes a version.
 */
export const NJ_FILING_SOURCES = {
  /** The Division of Elections' 2026 hub, whose own hrefs name the current PDFs. */
  stateHub:
    "https://www.nj.gov/state/elections/election-information-2026.shtml",
  /** Morris County's clerk page, whose own hrefs name the current PDFs. */
  morrisClerkCandidates:
    "https://www.morriscountyclerk.org/Elections/Current-Election-Candidates",
} as const;

/**
 * Pick the freshest revision of each document from a page's own hrefs.
 *
 * The clerk publishes `2026-general-candidates-080726.pdf` and later
 * `...-082126.pdf` at a NEW version path, leaving the old one reachable. Taking
 * the last-dated one is the difference between reading the ballot and reading a
 * two-week-old draft of it — and a stale filing read as current is a claim about
 * who is running, which is the one class of claim this product cannot survive
 * getting wrong.
 */
export function newestFilingPdfs(html: string, origin: string): string[] {
  const hrefs = [...html.matchAll(/href="([^"]+\.pdf)"/gi)].map((m) => m[1]!);
  const byStem = new Map<string, { url: string; stamp: string }>();
  for (const href of hrefs) {
    const url = href.startsWith("http") ? href : new URL(href, origin).toString();
    const file = url.split("/").pop() ?? "";
    const dm = /-(\d{6})\.pdf$/.exec(file);
    const stem = file.replace(/-\d{6}\.pdf$/, "").replace(/\.pdf$/, "");
    const stamp = dm?.[1] ?? "";
    const prev = byStem.get(stem);
    /* MMDDYY sorts wrong across a year boundary; reorder to YYMMDD before comparing. */
    const key = stamp ? stamp.slice(4) + stamp.slice(0, 4) : "";
    const prevKey = prev?.stamp ? prev.stamp.slice(4) + prev.stamp.slice(0, 4) : "";
    if (!prev || key > prevKey) byStem.set(stem, { url, stamp });
  }
  return [...byStem.values()].map((v) => v.url);
}
