/**
 * **THE ARIZONA SECRETARY OF STATE'S 2026 CANDIDATE FILING LIST, AS A CORPUS.**
 * (Session C final, lane 1, 2026-09-01. RULING 229, RULING 205, RULING 207.)
 *
 * ## The defect this closes, stated as the number it was hiding
 *
 * Every Arizona candidate artifact in this repository was derived from ONE
 * COUNTY'S CERTIFIED BALLOT — `data/states/az/ballot/az-pima-2026.json`, 15 candidacy
 * contests and 55 candidacies. The identity registry, the candidate universe
 * and the 1,087 candidate-enrichment obligations were all keyed off that
 * population, and every one of them was labelled STATEWIDE.
 *
 * The Secretary of State's own statewide filing list was already CITED by that
 * file — `provenance.sourceUrl` on all 55 rows is
 * `azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf`
 * — and it had been read for the Pima projection and never acquired as a
 * corpus. `data/states/az/jurisdictions/az.json` recorded that as `DISCOVERY_OWED`:
 *
 * > acquire the Secretary of State's full 2026 candidate-filing list as DATA.
 * > The 2026 filings PDF was read for the Pima projection only; the statewide
 * > list is the acquisition denominator and is not held as a corpus.
 *
 * **This adapter is that acquisition.** 76 contests and 266 candidacies, from
 * the authority that certifies them, with no ZIP and no county anywhere in the
 * derivation.
 *
 * ## WHAT THE CORPUS IS, AND — because R-C9 binds this file — WHAT IT IS NOT
 *
 * It is the Secretary of State's **PARTISAN CANDIDATE FILING FOR THE 2026
 * PRIMARY ELECTION**, complete: every candidate the Secretary lists as
 * qualified for the July 21, 2026 primary ballot, for every office the
 * Secretary is the filing officer for. That is federal congressional,
 * statewide, and legislative. It is the authority's COMPLETE APPLICABLE
 * UNIVERSE for the offices it is the authority over, which is what licenses
 * the word "statewide" on anything derived from it.
 *
 * It is **not** every 2026 Arizona candidate, and nothing built on it may say
 * that it is. Named, so no later session has to rediscover them:
 *
 * ```
 *   COUNTY AND BELOW      the county officer in charge of elections is the
 *                         filing authority, not the Secretary. 15 counties,
 *                         each already a DISCOVERY_OWED row in
 *                         data/states/az/jurisdictions/az.json
 *   INDEPENDENT / NO-PARTY  file by nomination petition on a later deadline and
 *                         do not appear on a PARTISAN filing list
 *   WRITE-IN NOMINEES     never on a filing list; they appear starred in the
 *                         certified primary canvass, which is a 19 MB SCAN with
 *                         no text layer (recorded in az-general-lineup-2026.json)
 *   NONPARTISAN / JUDICIAL  retention and nonpartisan offices are not this list
 * ```
 *
 * Each of those is an ABSENCE FROM THIS DOCUMENT and never an absence from the
 * ballot. The corpus states them on its own record so the derived denominator
 * cannot be mistaken for the whole.
 *
 * ## THE EXTRACTION IS RECONCILED, BECAUSE A PARTIAL THAT PARSES IS A WRONG
 * ANSWER (RULING 100)
 *
 * The filing list is a column-aligned PDF. `extractTables` recovers it from
 * text-item POSITION, which is the only thing a PDF actually carries — and a
 * table extractor that silently drops a run of rows returns a shorter table,
 * not an error. So the row count is established TWICE by independent means and
 * the two must agree or nothing is written:
 *
 * ```
 *   POSITIONAL   extractTables -> 8 pages x 8 columns, header rows removed
 *   TEXTUAL      extractTextLayer -> count filing-date tokens, minus the two
 *                the page subtitle spends and the one the footer spends
 * ```
 *
 * Both said 266 on 2026-09-01. `reconcileExtraction` refuses any run where they
 * disagree, and refuses a zero outright: a zero-row extraction is a FAILED
 * extraction and never an election with no candidates.
 *
 * ## THE NAME JOIN IS EXACT-FORM, NEVER FUZZY
 *
 * Two Arizona authorities publish one person under two splits. The Secretary
 * writes `Ruiz, Teresa Leyba`; the Pima certified ballot writes given
 * `Teresa`, family `Leyba Ruiz`. Both display as `Teresa Leyba Ruiz`, and if
 * the corpus kept its own split the derivation would mint a SECOND canonical
 * identity for one candidate and re-hunt everything already found for her.
 *
 * The join is `sharedNameForm` from `lib/identity/name-forms.ts` — string
 * equality over EXACT expanded forms, each labelled with the annotation rule
 * that produced it. **There is no edit distance, no token-subset test and no
 * similarity score here**, and a name that resolves to more than one held
 * candidacy in the same contest is a COLLISION that refuses the write rather
 * than picking one. Where a unique shared form exists, the corpus adopts the
 * held split and records BOTH authorities' published strings and the rule that
 * fired, so the join is inspectable rather than assumed.
 */

import { extractTables } from "../../extract/tables.ts";
import { extractTextLayer } from "../../extract/text-layer.ts";
import { sharedNameForm } from "../../identity/name-forms.ts";

export const SOURCE_NAME = "az-sos-candidate-filings";
export const CYCLE = 2026;

/**
 * The Secretary of State's published filing list for the 2026 primary.
 *
 * Permission was read BEFORE this route was built. `https://azsos.gov/robots.txt`,
 * read 2026-09-01, carries `User-agent: *` with `Disallow:` on `/core/`,
 * `/profiles/`, `/admin/`, `/comment/reply/`, `/filter/tips`, `/node/add/`,
 * `/search/`, `/user/*`, `/media/oembed` and `/README.txt` — and no rule that
 * covers `/sites/default/files/`. The path is ALLOWED.
 */
export const FILING_LIST_URL =
  "https://azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf";

/**
 * The page the list is published from — recorded because a URL is not a record
 * (RULING 206) and this one moved. `azsos.gov/elections/results-data/candidate-filings`,
 * the URL `data/states/az/jurisdictions/az.json` carries, answered **HTTP 404** on
 * 2026-09-01. `azsos.gov/elections/candidates` answers 200. The document itself
 * answers 200 either way, which is exactly why the record is the document and
 * never the navigation path to it.
 */
export const FILING_LIST_LANDING = "https://azsos.gov/elections/candidates";
export const FILING_LIST_LANDING_SUPERSEDED =
  "https://azsos.gov/elections/results-data/candidate-filings";

export const AUTHORITY = "Arizona Secretary of State";

const AZ_STATE_DIVISION = "ocd-division/country:us/state:az";

/** Identification the host serves. A person and a purpose, never evasion. */
function identifiedHeaders(): Record<string, string> {
  const from = process.env.INGEST_CONTACT_EMAIL;
  return {
    "user-agent": "we-the-people/1.0 (civic data for a public-records product)",
    accept: "application/pdf,*/*",
    ...(from ? { from } : {}),
  };
}

/* ------------------------------------------------------------------ fetch */

export interface FetchedDocument {
  readonly url: string;
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly sha256: string;
  readonly httpStatus: number;
  readonly contentType: string | null;
  readonly lastModified: string | null;
  readonly etag: string | null;
  readonly retrievedAt: string;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Retrieve the filing list from the Secretary of State.
 *
 * A non-200, or a body that is not a PDF, is returned as the FAILURE it is.
 * The one thing this may never do is hand back an empty document that a caller
 * could mistake for a state with no candidates.
 */
export async function fetchFilingList(
  input: { readonly url?: string; readonly retrievedAt: string } & {
    readonly fetchImpl?: typeof globalThis.fetch;
  },
): Promise<FetchedDocument> {
  const url = input.url ?? FILING_LIST_URL;
  const doFetch = input.fetchImpl ?? globalThis.fetch;
  const response = await doFetch(url, { headers: identifiedHeaders(), redirect: "follow" });
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(
      `${SOURCE_NAME}: ${url} answered HTTP ${response.status} (${buffer.length} B). That is a fact ` +
        "about this route on this date and never a fact about Arizona's candidates.",
    );
  }
  const magic = new TextDecoder("latin1").decode(buffer.slice(0, 5));
  if (!magic.startsWith("%PDF")) {
    throw new Error(
      `${SOURCE_NAME}: ${url} answered HTTP 200 with ${buffer.length} B that do not begin with %PDF ` +
        `(saw ${JSON.stringify(magic)}). A challenge or error page served at 200 parses to a document ` +
        "that says nothing, which would be recorded as an election with no candidates.",
    );
  }
  return {
    url,
    bytes: buffer,
    byteLength: buffer.length,
    sha256: await sha256Hex(buffer),
    httpStatus: response.status,
    contentType: response.headers.get("content-type"),
    lastModified: response.headers.get("last-modified"),
    etag: response.headers.get("etag"),
    retrievedAt: input.retrievedAt,
  };
}

/* -------------------------------------------------------------- the office */

export interface OfficeIdentity {
  /** The office as this project titles it, matching the certified ballots. */
  readonly title: string;
  readonly ocdId: string;
  /** The contest id inside the corpus document. */
  readonly contestId: string;
  readonly level: "FEDERAL" | "STATE";
}

/** The seven offices the Secretary of State is the filing officer for statewide. */
const STATEWIDE_OFFICES: Record<string, string> = {
  Governor: "governor",
  "Secretary of State": "secretary-of-state",
  "Attorney General": "attorney-general",
  "State Treasurer": "state-treasurer",
  "Superintendent of Public Instruction": "superintendent",
  "State Mine Inspector": "mine-inspector",
  "Corporation Commissioner": "corporation-commissioner",
};

/**
 * The Secretary's contest name, resolved to this project's office identity.
 *
 * The Secretary writes `U.S. Representative - District No. 6`. Every certified
 * ballot in this repository writes `U.S. Representative, District 6` at
 * `ocd-division/country:us/state:az/cd:6`. **Those are two publishers' names
 * for ONE office**, and mapping them is what keeps one candidate from becoming
 * two canonical identities.
 *
 * An unrecognised contest name returns null and the caller REFUSES THE WHOLE
 * RUN. Skipping it would drop real candidates and report a smaller universe as
 * a complete one — which is the failure this adapter exists to end.
 */
export function officeFor(contestName: string): OfficeIdentity | null {
  const districted =
    /^(U\.S\. Representative|State Senator|State Representative) - District No\. (\d+)$/.exec(
      contestName.trim(),
    );
  if (districted) {
    const n = districted[2];
    switch (districted[1]) {
      case "U.S. Representative":
        return {
          title: `U.S. Representative, District ${n}`,
          ocdId: `${AZ_STATE_DIVISION}/cd:${n}`,
          contestId: `az-sos-${CYCLE}:us-house-${n}`,
          level: "FEDERAL",
        };
      case "State Senator":
        return {
          title: `State Senator, District ${n}`,
          ocdId: `${AZ_STATE_DIVISION}/sldu:${n}`,
          contestId: `az-sos-${CYCLE}:state-senate-${n}`,
          level: "STATE",
        };
      default:
        return {
          title: `State Representative, District ${n}`,
          ocdId: `${AZ_STATE_DIVISION}/sldl:${n}`,
          contestId: `az-sos-${CYCLE}:state-house-${n}`,
          level: "STATE",
        };
    }
  }
  const slug = STATEWIDE_OFFICES[contestName.trim()];
  if (!slug) return null;
  return {
    title: contestName.trim(),
    ocdId: AZ_STATE_DIVISION,
    contestId: `az-sos-${CYCLE}:${slug}`,
    level: "STATE",
  };
}

/* ------------------------------------------------------------- extraction */

export interface FilingRow {
  /** `Ruiz, Teresa Leyba`, exactly as the Secretary printed it. */
  readonly publishedName: string;
  /** `Superintendent of Public Instruction`, exactly as the Secretary printed it. */
  readonly publishedContest: string;
  readonly partyLabel: string;
  readonly minimumSignatures: string;
  readonly filingDate: string;
  readonly finalTotalEQual: string;
  readonly finalTotalPaper: string;
  readonly finalTotals: string;
}

const HEADER_FIRST_CELL = "Candidate Name";

export interface ExtractionReconciliation {
  readonly positionalRows: number;
  readonly textualRows: number;
  readonly agree: boolean;
  readonly pages: number;
  readonly headerRowsRemoved: number;
  readonly method: string;
}

/**
 * Count the filing rows a second time, from the TEXT layer, without the table
 * extractor's help.
 *
 * Every filing row carries exactly one filing date. Every page's subtitle
 * carries two (`February 23, 2026, to March 23, 2026`) and every page's footer
 * carries one (`July 21, 2026`). Subtract the furniture and what remains is the
 * row count — established by a mechanism that shares nothing with the
 * positional one, which is the only reason its agreement means anything.
 */
export function countRowsFromText(pageTexts: readonly string[]): number {
  const DATE =
    /(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}/g;
  let total = 0;
  for (const text of pageTexts) {
    const dates = text.match(DATE)?.length ?? 0;
    const subtitles = text.match(/February 23, 2026, to March 23, 2026/g)?.length ?? 0;
    const footers = text.match(/July 21, 2026/g)?.length ?? 0;
    total += dates - subtitles * 2 - footers;
  }
  return total;
}

/**
 * Read the filing list out of the PDF, twice, and refuse a disagreement.
 *
 * @throws when either extraction fails, when the two counts disagree, or when
 * the count is zero. All three are FAILED EXTRACTIONS. None of them is an
 * election with no candidates, and the difference is the whole point of the
 * function.
 */
export async function extractFilingRows(
  bytes: Uint8Array,
  source: string,
): Promise<{ readonly rows: readonly FilingRow[]; readonly reconciliation: ExtractionReconciliation }> {
  /*
   * **EACH EXTRACTOR GETS ITS OWN COPY, AND THAT IS NOT TIDINESS.**
   *
   * `pdfjs.getDocument({ data })` takes OWNERSHIP of the buffer it is handed and
   * detaches it. Passing the same `Uint8Array` to both layers made the second
   * one read ZERO BYTES and report `CANNOT_RUN: the input is zero bytes` — a
   * true statement about the buffer that would have been read as a document
   * with no text layer. Measured here on 2026-09-01, on a PDF that has one.
   */
  const tables = await extractTables(bytes.slice(), source);
  if (tables.outcome !== "EXTRACTED") {
    throw new Error(
      `${SOURCE_NAME}: positional table extraction did not run on ${source} — ` +
        `${tables.outcome}: ${tables.reason || "no reason recorded"}`,
    );
  }
  const text = await extractTextLayer(bytes.slice(), source);
  if (text.outcome !== "EXTRACTED") {
    throw new Error(
      `${SOURCE_NAME}: text-layer extraction did not run on ${source} — ` +
        `${text.outcome}: ${text.reason || "no reason recorded"}`,
    );
  }

  const rows: FilingRow[] = [];
  let headerRowsRemoved = 0;
  const items = tables.items;
  for (const table of items) {
    for (const cells of table.rows) {
      if (cells[0] === HEADER_FIRST_CELL) {
        headerRowsRemoved += 1;
        continue;
      }
      if (cells.length !== 8) {
        throw new Error(
          `${SOURCE_NAME}: page ${table.page} produced a ${cells.length}-cell row ` +
            `(${JSON.stringify(cells)}). The filing list has eight columns; a row with a different ` +
            "count is a misread table and reading it would put one column's value under another's name.",
        );
      }
      rows.push({
        publishedName: cells[0],
        publishedContest: cells[1],
        partyLabel: cells[2],
        minimumSignatures: cells[3],
        filingDate: cells[4],
        finalTotalEQual: cells[5],
        finalTotalPaper: cells[6],
        finalTotals: cells[7],
      });
    }
  }

  const textualRows = countRowsFromText(text.items.map((p) => p.text));
  const reconciliation: ExtractionReconciliation = {
    positionalRows: rows.length,
    textualRows,
    agree: rows.length === textualRows,
    pages: items.length,
    headerRowsRemoved,
    method:
      "POSITIONAL: lib/extract/tables.ts, eight-column runs recovered from text-item x/y, one header " +
      "row per page removed. TEXTUAL: lib/extract/text-layer.ts, filing-date tokens per page minus " +
      "two spent by the page subtitle and one spent by the page footer. The two mechanisms share " +
      "nothing, which is why their agreement is evidence.",
  };

  if (rows.length === 0) {
    throw new Error(
      `${SOURCE_NAME}: ${source} produced ZERO filing rows. A zero-row extraction is a FAILED ` +
        "extraction (RULING 100). It is never a state with no candidates, and nothing is written.",
    );
  }
  if (!reconciliation.agree) {
    throw new Error(
      `${SOURCE_NAME}: the two extractions disagree — positional ${rows.length}, textual ${textualRows}. ` +
        "A partial extraction that parses cleanly is still a wrong answer (RULING 100), and the wrong " +
        "answer here is a candidate universe missing people. Nothing is written.",
    );
  }
  return { rows, reconciliation };
}

/* ------------------------------------------------------------- normalize */

export interface CorpusContest {
  readonly id: string;
  readonly ocdId: string;
  readonly title: string;
  readonly level: "FEDERAL" | "STATE";
  /** The Secretary's own name for it, kept verbatim. */
  readonly publishedTitle: string;
  readonly provenance: { readonly sourceUrl: string; readonly sourceOrg: string; readonly collectedAt: string };
}

export interface CorpusCandidacy {
  readonly id: string;
  readonly contestId: string;
  readonly familyName: string;
  readonly givenName: string;
  readonly partyLabel: string;
  /** `Ruiz, Teresa Leyba` — the Secretary's own string, never reconstructed. */
  readonly publishedName: string;
  readonly filingDate: string;
  readonly signaturesFiled: number | null;
  /** Non-null only where a held candidacy was joined; names the rule that fired. */
  readonly heldIdentityJoin: {
    readonly heldCandidacyId: string;
    readonly heldPublishedName: string;
    readonly rule: string;
    readonly matchedForm: string;
  } | null;
  readonly provenance: { readonly sourceUrl: string; readonly sourceOrg: string; readonly collectedAt: string };
}

/** A held ballot document offered to the normalizer for the name join. */
export interface HeldCandidacy {
  readonly id: string;
  readonly ocdId: string;
  readonly officeTitle: string;
  readonly familyName: string;
  readonly givenName: string;
}

export interface NameJoinCollision {
  readonly publishedName: string;
  readonly contestTitle: string;
  readonly heldCandidacyIds: readonly string[];
}

export interface NormalizedCorpus {
  readonly contests: readonly CorpusContest[];
  readonly candidacies: readonly CorpusCandidacy[];
  readonly reconciliation: ExtractionReconciliation;
  readonly nameJoin: {
    readonly heldCandidaciesOffered: number;
    readonly joined: number;
    readonly joinedUnderADifferentSplit: number;
    readonly collisions: readonly NameJoinCollision[];
  };
}

/**
 * The candidacy-key slug.
 *
 * `lib/hunt/candidate-universe.ts` derives the canonical id with a slug that
 * does NOT strip diacritics — `Galán-Woods` becomes `gal-n-woods` there. This
 * one must produce the same string or the union would mint two identities for
 * one person, so it deliberately does not normalise accents either. Matching
 * the existing derivation is the requirement; being a better slug is not.
 */
const SLUG = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Split the Secretary's `Last, First` into family and given.
 *
 * The comma is the AUTHORITY'S OWN separator, printed by the authority. This
 * is a read of the publisher's format, not an inference about a person's name —
 * and a row without one is refused rather than guessed at.
 */
export function splitPublishedName(published: string): { family: string; given: string } {
  const comma = published.indexOf(",");
  if (comma === -1) {
    throw new Error(
      `${SOURCE_NAME}: "${published}" carries no comma. The Secretary prints every candidate as ` +
        "`Family, Given`; a row without the separator is a misread cell, and splitting it on a guess " +
        "would file a person under the wrong name.",
    );
  }
  const family = published.slice(0, comma).trim();
  const given = published.slice(comma + 1).trim();
  if (!family || !given) {
    throw new Error(`${SOURCE_NAME}: "${published}" split to an empty family or given name`);
  }
  return { family, given };
}

export function displayNameOf(family: string, given: string): string {
  return `${given} ${family}`.replace(/\s+/g, " ").trim();
}

/**
 * Turn the Secretary's rows into a corpus document, joining held identities.
 *
 * @throws on an unrecognised contest name, on a duplicate candidacy key, and
 * on a name that resolves to more than one held candidacy in one contest.
 */
export function normalizeFilingRows(input: {
  readonly rows: readonly FilingRow[];
  readonly reconciliation: ExtractionReconciliation;
  readonly sourceUrl: string;
  readonly collectedAt: string;
  readonly held: readonly HeldCandidacy[];
}): NormalizedCorpus {
  const provenance = {
    sourceUrl: input.sourceUrl,
    sourceOrg: AUTHORITY,
    collectedAt: input.collectedAt,
  } as const;

  const contests = new Map<string, CorpusContest>();
  const candidacies: CorpusCandidacy[] = [];
  const seen = new Set<string>();
  const collisions: NameJoinCollision[] = [];
  let joined = 0;
  let joinedUnderADifferentSplit = 0;

  /* The held population, indexed by the DIVISION AND OFFICE it belongs to.
     A name is only ever compared inside one contest: two people with one name
     in two different races are two people, and a cross-contest comparison
     would be inventing a relationship the authorities never published. */
  const heldByOffice = new Map<string, HeldCandidacy[]>();
  for (const h of input.held) {
    const key = `${h.ocdId}|${h.officeTitle}`;
    heldByOffice.set(key, [...(heldByOffice.get(key) ?? []), h]);
  }

  for (const row of input.rows) {
    const office = officeFor(row.publishedContest);
    if (!office) {
      throw new Error(
        `${SOURCE_NAME}: the Secretary lists a contest this adapter does not recognise — ` +
          `"${row.publishedContest}". Skipping it would drop every candidate in that race and report ` +
          "the smaller universe as the complete one. Nothing is written; add the office and re-run.",
      );
    }
    if (!contests.has(office.contestId)) {
      contests.set(office.contestId, {
        id: office.contestId,
        ocdId: office.ocdId,
        title: office.title,
        level: office.level,
        publishedTitle: row.publishedContest,
        provenance,
      });
    }

    const sosSplit = splitPublishedName(row.publishedName);
    let family = sosSplit.family;
    let given = sosSplit.given;
    let heldIdentityJoin: CorpusCandidacy["heldIdentityJoin"] = null;

    const pool = heldByOffice.get(`${office.ocdId}|${office.title}`) ?? [];
    const sosDisplay = displayNameOf(sosSplit.family, sosSplit.given);
    const matches = pool
      .map((h) => ({ held: h, form: sharedNameForm(sosDisplay, displayNameOf(h.familyName, h.givenName)) }))
      .filter((m): m is { held: HeldCandidacy; form: NonNullable<ReturnType<typeof sharedNameForm>> } =>
        m.form !== null,
      );
    if (matches.length > 1) {
      collisions.push({
        publishedName: row.publishedName,
        contestTitle: office.title,
        heldCandidacyIds: matches.map((m) => m.held.id),
      });
    } else if (matches.length === 1) {
      const m = matches[0];
      joined += 1;
      const differs = m.held.familyName !== sosSplit.family || m.held.givenName !== sosSplit.given;
      if (differs) joinedUnderADifferentSplit += 1;
      /* THE HELD SPLIT WINS, and only the SPLIT. The Secretary is the authority
         on WHO FILED; the held ballot is what every enrichment finding in this
         repository is already keyed to. Adopting the held split is what makes
         this one identity instead of two, and both published strings are
         recorded so the join can be read rather than trusted. */
      family = m.held.familyName;
      given = m.held.givenName;
      heldIdentityJoin = {
        heldCandidacyId: m.held.id,
        heldPublishedName: displayNameOf(m.held.familyName, m.held.givenName),
        rule: m.form.rules.join(" then "),
        matchedForm: m.form.form,
      };
    }

    const id = `${office.contestId}:${SLUG(family)}-${SLUG(given)}`;
    if (seen.has(id)) {
      throw new Error(
        `${SOURCE_NAME}: two filing rows produce the candidacy key ${id}. One key for two people ` +
          "would render one candidate's record on the other's card. Nothing is written.",
      );
    }
    seen.add(id);

    const signatures = Number.parseInt(row.finalTotals.replace(/,/g, ""), 10);
    candidacies.push({
      id,
      contestId: office.contestId,
      familyName: family,
      givenName: given,
      partyLabel: row.partyLabel,
      publishedName: row.publishedName,
      filingDate: row.filingDate,
      signaturesFiled: Number.isFinite(signatures) ? signatures : null,
      heldIdentityJoin,
      provenance,
    });
  }

  if (collisions.length > 0) {
    throw new Error(
      `${SOURCE_NAME}: ${collisions.length} published name(s) resolved to more than one held candidacy ` +
        `in the same contest — ${collisions
          .map((c) => `${c.publishedName} (${c.contestTitle}) -> ${c.heldCandidacyIds.join(", ")}`)
          .join("; ")}. Picking one would put a person's record under another person's name. ` +
        "Nothing is written.",
    );
  }

  return {
    contests: [...contests.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    candidacies: candidacies.sort((a, b) => (a.id < b.id ? -1 : 1)),
    reconciliation: input.reconciliation,
    nameJoin: {
      heldCandidaciesOffered: input.held.length,
      joined,
      joinedUnderADifferentSplit,
      collisions,
    },
  };
}

/* ---------------------------------------------------------------- upsert */

export interface CorpusDocument {
  readonly formatVersion: 1;
  readonly stateCode: "AZ";
  readonly cycle: number;
  readonly generatedBy: string;
  readonly generatedOn: string;
  readonly _note: readonly string[];
  readonly authority: {
    readonly name: string;
    readonly documentTitle: string;
    readonly landingUrl: string;
    readonly supersededLandingUrl: { readonly url: string; readonly observed: string };
  };
  readonly retrieval: {
    readonly url: string;
    readonly httpStatus: number;
    readonly contentType: string | null;
    readonly byteLength: number;
    readonly sha256: string;
    readonly lastModified: string | null;
    readonly etag: string | null;
    readonly retrievedAt: string;
    readonly permission: string;
  };
  readonly extraction: ExtractionReconciliation;
  readonly nameJoin: NormalizedCorpus["nameJoin"];
  readonly applicableUniverse: {
    readonly describes: string;
    readonly contests: number;
    readonly candidacies: number;
    readonly notInThisDocument: readonly string[];
  };
  readonly contests: readonly CorpusContest[];
  readonly candidacies: readonly CorpusCandidacy[];
}

export const NOT_IN_THIS_DOCUMENT: readonly string[] = [
  "COUNTY AND BELOW — the county officer in charge of elections is the filing authority for county, " +
    "municipal, school-district and special-district offices, not the Secretary of State. All 15 " +
    "Arizona counties are already carried as DISCOVERY_OWED rows in data/states/az/jurisdictions/az.json.",
  "INDEPENDENT AND NO-PARTY candidates — they qualify by nomination petition on a later deadline and " +
    "are not on a PARTISAN filing list.",
  "WRITE-IN NOMINEES — never on a filing list. They appear starred in the certified primary canvass, " +
    "which is a 19,111,993-byte SCAN with no text layer (apps.azsos.gov/election/2026/canvass/" +
    "20260806_Primary_Canvass.pdf). OCR is the next rung and it has not been run.",
  "NONPARTISAN AND JUDICIAL offices, including retention questions.",
  "Every line above is an absence from THIS DOCUMENT. None of them is an absence from the ballot, and " +
    "nothing derived from this corpus may render one as the other.",
];

export function buildCorpusDocument(input: {
  readonly document: FetchedDocument;
  readonly normalized: NormalizedCorpus;
  readonly generatedBy: string;
  readonly generatedOn: string;
}): CorpusDocument {
  return {
    formatVersion: 1,
    stateCode: "AZ",
    cycle: CYCLE,
    generatedBy: input.generatedBy,
    generatedOn: input.generatedOn,
    _note: [
      "GENERATED ARTIFACT — never hand-edited (RULING 92). Regenerate with `pnpm acquire:az-sos-candidates`.",
      "",
      "THE ARIZONA SECRETARY OF STATE'S COMPLETE PARTISAN CANDIDATE FILING LIST FOR THE 2026 PRIMARY.",
      "This is the AUTHORITATIVE SOURCE UNIVERSE for the offices the Secretary is the filing officer",
      "for — federal congressional, statewide and legislative. No ZIP and no county appears anywhere",
      "in the derivation (RULING 229).",
      "",
      "R-C9: `applicableUniverse.describes` states exactly which population this is, and",
      "`applicableUniverse.notInThisDocument` names every class of 2026 Arizona candidate it does NOT",
      "carry. A denominator derived from this file is the Secretary's universe, not the state's.",
      "",
      "THE ROW COUNT WAS ESTABLISHED TWICE BY INDEPENDENT MEANS and the run refuses a disagreement.",
      "See `extraction`.",
    ],
    authority: {
      name: AUTHORITY,
      documentTitle:
        "Arizona Secretary of State Partisan Candidate Filing for 2026 Primary Election, " +
        "February 23, 2026, to March 23, 2026 — official list of candidates who qualified for the " +
        "July 21, 2026 Primary Ballot pending any court-ordered removal, ARS § 16-351",
      landingUrl: FILING_LIST_LANDING,
      supersededLandingUrl: {
        url: FILING_LIST_LANDING_SUPERSEDED,
        observed:
          "HTTP 404 on 2026-09-01 — the URL data/states/az/jurisdictions/az.json recorded. The document itself " +
          "answers 200. A URL is not a record (RULING 206).",
      },
    },
    retrieval: {
      url: input.document.url,
      httpStatus: input.document.httpStatus,
      contentType: input.document.contentType,
      byteLength: input.document.byteLength,
      sha256: input.document.sha256,
      lastModified: input.document.lastModified,
      etag: input.document.etag,
      retrievedAt: input.document.retrievedAt,
      permission:
        "ALLOWED. https://azsos.gov/robots.txt read 2026-09-01: `User-agent: *` disallows /core/, " +
        "/profiles/, /admin/, /comment/reply/, /filter/tips, /node/add/, /search/, /user/*, " +
        "/media/oembed, /README.txt and /web.config. No rule covers /sites/default/files/.",
    },
    extraction: input.normalized.reconciliation,
    nameJoin: input.normalized.nameJoin,
    applicableUniverse: {
      describes:
        "Every candidate the Arizona Secretary of State lists as qualified for the July 21, 2026 " +
        "primary ballot, for every office the Secretary is the filing officer for: federal " +
        "congressional, statewide executive, and legislative. Complete for those offices.",
      contests: input.normalized.contests.length,
      candidacies: input.normalized.candidacies.length,
      notInThisDocument: NOT_IN_THIS_DOCUMENT,
    },
    contests: input.normalized.contests,
    candidacies: input.normalized.candidacies,
  };
}
