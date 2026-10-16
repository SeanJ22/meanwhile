import { extracted, zeroRows, type ExtractResult } from "../extract/types.ts";
import { isMorrisGeneralCandidatesDocument, isMorrisSchoolCandidatesDocument } from "../civic-data/morris-filing-documents.ts";

export interface FiledCandidate {

  jurisdiction: string;

  office: string;

  familyName: string;

  givenName: string;

  party: string | null;

  slogan: string | null;

  address: string | null;

  email: string | null;

  termYears: number | null;

  voteFor: number | null;

  district: string | null;
}

export interface FiledNoElection {
  jurisdiction: string;
  statement: string;
}

export interface FiledUnfilledSeat {
  jurisdiction: string;
  office: string;

  party: string | null;
  statement: string;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

const OFFICE_RE =
  /((?:MEMBER OF THE|DOVER BOARD OF EDUCATION CANDIDATES|NO LOCAL ELECTION)(?:\s*-\s*WARD\s\d+|\sWARD\s\d+|[A-Z.'\-/]+(?![a-z])|\s(?!\d))*|MAYOR(?=\s+\d{1,2}\s+\d{1,2}\s))/;

const TERM_SEATS_RE = /^\s*(\d{1,2})\s+(\d{1,2})\b/;

const JURISDICTION_TAIL_RE =
  /((?:[A-Z][a-z]+(?:[-/][A-Z][a-z]+)*|[0-9]+(?:st|nd|rd|th)|of|the)(?:\s+(?:[A-Z][a-z]+(?:[-/][A-Z][a-z]+)*|[0-9]+(?:st|nd|rd|th)|of|the)){0,3})\s*$/;

const NAME_RE =
  /([A-Z][A-Za-zÀ-ÿ'’.\- ]*?(?:"[^"]+"\s+|\([^)]+\)\s+)?)([A-ZÀ-Ÿ][A-ZÀ-Ÿ'’\-]+(?:\s+[A-ZÀ-Ÿ'’\-]+)*(?:,\s*(?:JR|SR|II|III|IV)\.?)?)\s*$/;

const UNFILLED_PHRASE = "(?:No Nomination Made|NO PETITION FILED)";

const HEADER_RUN_RE = /^[\s\S]*?CONTEST TITLE[\s\S]*?\bEmail\b/i;

const DISTRICT_COLUMN = "(?:(?:[A-Z][A-Za-z]+\\s+){0,3}Regional|Town|Township|Borough|City|Village)";

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

  const unfilled: FiledUnfilledSeat[] = [];
  let previousJurisdiction = "";
  let previousHeading = "";


  const parts = text.split(OFFICE_RE);

  let carriedJurisdiction = "";

  for (let i = 1; i < parts.length; i += 2) {
    const heading = (parts[i] ?? "").trim().replace(/\s+/g, " ");
    const before = parts[i - 1] ?? "";
    const body = parts[i + 1] ?? "";


    const cleanedBefore = before
      .trimEnd()

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


    let rest = ts ? body.slice(ts[0].length) : body;

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


    const tail = rest.replace(/\s+/g, " ").trim();
    if (tail && !new RegExp(UNFILLED_PHRASE, "i").test(tail)) {
      const row = parseCandidateChunk(tail, jurisdiction, heading, termYears, voteFor);
      if (row) candidates.push({ ...row, district, email: null });
    }
  }


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


  const addrMatch =
    /((?:P\.?\s?O\.?\s+Box\s+\d+|\d)[^,]*?(?:,\s*[^,]*?)?\s+(?:NJ|New Jersey)\s+\d{5}(?:-\d{4})?)\s*$/i.exec(
      flat,
    );
  const address = addrMatch ? addrMatch[1].replace(/\s+/g, " ").trim() : null;
  let head = addrMatch ? flat.slice(0, addrMatch.index).trim() : flat;


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


  head = head.replace(/\s+/g, " ").trim();
  const nm = NAME_RE.exec(head);
  let givenName = "";
  let familyName = "";
  let slogan: string | null = null;

  if (nm) {
    givenName = nm[1].trim();
    familyName = nm[2].trim();
  } else {

    const caps = /([A-ZÀ-Ÿ][A-ZÀ-Ÿ'’\-]{1,}(?:\s+[A-ZÀ-Ÿ'’\-]{2,})*(?:,\s*(?:JR|SR|II|III|IV)\.?)?)/g;
    let last: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    while ((m = caps.exec(head))) {

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


  const sloganMatch = /^(.*?)\s*("[^"]+"|[A-Z][A-Za-z]+(?:[ ,!]+[A-Za-z][A-Za-z]*)*[!]?)$/.exec(
    givenName,
  );
  if (!slogan && sloganMatch && /^["']/.test(sloganMatch[2] ?? "")) {

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

export const NJ_FILING_SOURCES = {

  stateHub:
    "https://www.nj.gov/state/elections/election-information-2026.shtml",

  morrisClerkCandidates:
    "https://www.morriscountyclerk.org/Elections/Current-Election-Candidates",
} as const;

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

  readonly assetVersion: number | null;

  readonly date: string | null;
}

function filingRevision(url: string): FilingRevision {
  const version = /\/v\/(\d+)\//.exec(url);
  const stamp = /-(\d{6,8})\.pdf(?:$|[?#])/i.exec(url)?.[1] ?? null;
  return { assetVersion: version ? Number(version[1]) : null, date: stamp ? stampDate(stamp) : null };
}

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

interface MorrisCurrentFilingDocumentSet {
  readonly generalCandidatesUrl: string;
  readonly schoolCandidatesUrl: string;
}

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
