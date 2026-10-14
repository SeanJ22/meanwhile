/**
 * **The state money-translation program** — tracker **D52**.
 *
 * ## What the program is
 *
 * Fifty states file campaign money in fifty vocabularies. "Qualifying
 * contribution", "in-kind", "independent expenditure", "surplus" — these are
 * legal terms of art, and a reader who has not read the statute cannot tell
 * from the words whether a number is money someone gave, money someone spent
 * on the candidate's behalf, or money moved between accounts.
 *
 * So each state gets an ADAPTER — one directory under `lib/sources/`, the
 * fetch/normalize/upsert contract, never editing shared ingestion logic — and
 * a MAPPING TABLE turning that state's filing vocabulary into words a
 * fifteen-year-old reads. The fiftieth state then costs what the second did.
 *
 * ## The gate, and it is encoded here rather than remembered
 *
 * **A state's mapping table is AUTHOR-APPROVED, per state, and that gate does
 * not move.** A state's own filing categories are not plain language, and
 * translating them without approval is this product generating meaning rather
 * than carrying it — which is the same failure as a generated candidate
 * position, arriving through a vocabulary instead of a sentence.
 *
 * The gate is not a note in a document. `renderableTerm()` returns the state's
 * OWN words for any table that is not approved, and `tests/state-vocabulary.
 * test.ts` asserts it: an unapproved table cannot reach a reader no matter who
 * calls it. A proposed translation is a proposal until a person says yes, and
 * until then the reader gets the filing's language with an honest note that we
 * have not translated it yet — which is worse reading and true.
 *
 * ## Why this file exists before any state adapter does
 *
 * The three covered states' filing systems are all walled from this egress
 * today (the field manual records each wall), so no adapter can be built against
 * live data yet. The SHAPE can, and building it first means the first state
 * that opens is a table and a fetch rather than a design.
 */

/** One filing term, and what it would say to a reader. */
export interface TermMapping {
  /** The state's own word, exactly as its filing writes it. Never edited. */
  filed: string;
  /** Plain words. One clause, fifteen-year-old test. */
  plain: string;
  /**
   * Where the state's own definition lives — the statute or the filing
   * instruction. A translation without one is a claim with nothing behind it.
   */
  definitionUrl: string;
}

export interface StateVocabulary {
  /** Two-letter postal code, upper case. */
  state: string;
  /** The body that publishes the filings. Never a vendor. */
  authority: string;
  /** The filing system this vocabulary came off. */
  sourceUrl: string;
  /** ISO date the vocabulary was read. Never a plausible date. */
  collectedAt: string;
  terms: TermMapping[];
  /**
   * **The gate.** Null until a person approves this table. While it is null
   * the table exists and does not translate.
   */
  approval: {
    /** Who said yes. A name, never "the session" and never "approved". */
    approvedBy: string;
    approvedAt: string;
  } | null;
  /**
   * Present when the state's filing system could not be reached, with every
   * rung. A wall never renders as an emptiness.
   */
  refusal: {
    wall: string;
    rungs: { rung: number; what: string; result: string; attemptedAt: string }[];
  } | null;
}

/**
 * What a reader sees for one filing term.
 *
 * **The whole gate lives in this function.** An unapproved table returns the
 * state's own word plus a named gap — never a plausible translation, and
 * never silence.
 */
export function renderableTerm(
  vocabulary: StateVocabulary,
  filed: string,
): { text: string; translated: boolean; note: string | null } {
  const mapping = vocabulary.terms.find((t) => t.filed === filed);
  if (!vocabulary.approval) {
    return {
      text: filed,
      translated: false,
      note: `This is ${vocabulary.authority}'s own filing term. We haven't translated ${vocabulary.state}'s filing vocabulary into plain words yet.`,
    };
  }
  if (!mapping) {
    return {
      text: filed,
      translated: false,
      note: `This is ${vocabulary.authority}'s own filing term. We haven't written a plain-words version of this one yet.`,
    };
  }
  return { text: mapping.plain, translated: true, note: null };
}

/** Counts, so a report states what it has rather than implying it. */
export function vocabularyCensus(vocabularies: StateVocabulary[]): {
  states: number;
  approved: number;
  proposed: number;
  walled: number;
  terms: number;
} {
  return {
    states: vocabularies.length,
    approved: vocabularies.filter((v) => v.approval !== null).length,
    proposed: vocabularies.filter((v) => v.approval === null && v.terms.length > 0)
      .length,
    walled: vocabularies.filter((v) => v.refusal !== null).length,
    terms: vocabularies.reduce((n, v) => n + v.terms.length, 0),
  };
}

/**
 * The three covered states, in the author's own order: NH, AZ, NJ.
 *
 * **Every one is walled from this egress today**, and each carries its rungs
 * rather than an empty table. `terms` is empty on all three on purpose: a
 * mapping table proposed from a vocabulary we could not read would be this
 * product inventing the very meaning the gate exists to stop it inventing.
 * The wall is the finding; the table is the next session's first move once a
 * rung clears.
 */
export const STATE_VOCABULARIES: StateVocabulary[] = [
  {
    state: "NH",
    authority: "New Hampshire Department of State",
    sourceUrl: "https://cfs.sos.nh.gov/",
    collectedAt: "2026-08-19",
    terms: [],
    approval: null,
    refusal: {
      wall: "The Campaign Finance System and its API refuse every client, including a real browser, from this egress.",
      rungs: [
        { rung: 2, what: "Plain fetch of cfs.sos.nh.gov", result: "HTTP 403, Akamai edge denial", attemptedAt: "2026-08-19" },
        { rung: 3, what: "Full browser header set", result: "HTTP 403", attemptedAt: "2026-08-19" },
        { rung: 4, what: "curl's TLS fingerprint", result: "HTTP 403", attemptedAt: "2026-08-19" },
        { rung: 6, what: "Live Chromium, JavaScript executed", result: "HTTP 403 — AND THIS CONTRADICTS THE PLAYBOOK, which recorded rung 6 clearing this host on 2026-08-19 earlier the same day. Recorded as a dated note beside that entry rather than a deletion.", attemptedAt: "2026-08-19" },
        { rung: 7, what: "The API host the SPA's lazy chunks name, cfsapi.sos.nh.gov", result: "HTTP 403 on /api, /swagger and /swagger/v1/swagger.json alike", attemptedAt: "2026-08-19" },
        { rung: 13, what: "The Department's public-records request path", result: "NOT YET WALKED — named as the next session's start", attemptedAt: "2026-08-19" },
      ],
    },
  },
  {
    state: "AZ",
    authority: "Arizona Secretary of State",
    sourceUrl: "https://seethemoney.az.gov/",
    collectedAt: "2026-08-19",
    terms: [],
    approval: null,
    refusal: {
      wall: "See The Money answers 200 and serves a single-page-app shell; its filing vocabulary is not in the served HTML.",
      rungs: [
        { rung: 2, what: "Plain fetch of seethemoney.az.gov", result: "HTTP 200, 109 KB, an SPA shell — no category vocabulary in the markup", attemptedAt: "2026-08-19" },
        { rung: 7, what: "A guessed report endpoint, /Reporting/GetNEWTableData", result: "HTTP 404 — and a guessed path is not a finding either way", attemptedAt: "2026-08-19" },
        { rung: 2, what: "apps.azsos.gov/apps/election/cfs/search/", result: "HTTP 404", attemptedAt: "2026-08-19" },
        { rung: 6, what: "The live browser, driving the app's own search and watching its calls", result: "NOT YET WALKED — the named next rung, and the one that worked on New Hampshire's equivalent in the g20 session", attemptedAt: "2026-08-19" },
      ],
    },
  },
  {
    state: "NJ",
    authority: "New Jersey Election Law Enforcement Commission",
    sourceUrl: "https://elec.nj.gov/",
    collectedAt: "2026-08-19",
    terms: [],
    approval: null,
    refusal: {
      wall: "ELEC sits behind an Imperva/Incapsula bot-detection interstitial; the served body is the challenge page, not the site.",
      rungs: [
        { rung: 2, what: "Plain fetch of elec.nj.gov", result: "HTTP 200, 1,154 bytes — an `_Incapsula_Resource` challenge page with NOINDEX,NOFOLLOW", attemptedAt: "2026-08-19" },
        { rung: 6, what: "The live browser", result: "NOT YET WALKED. NOTE FOR WHOEVER DOES: a bot-detection interstitial is a boundary, not a lock — a real browser passing it normally is fine, and defeating a CAPTCHA is not.", attemptedAt: "2026-08-19" },
      ],
    },
  },
];
