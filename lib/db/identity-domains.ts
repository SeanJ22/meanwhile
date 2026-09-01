/**
 * **A-001 · THE IDENTITY BOUNDARY IS PROVEN OVER VALUE SPACES, NOT COLUMN
 * NAMES.** (External correctness audit of `336a3eb`, remediated 2026-08-24.)
 *
 * ## The claim, and how the schema falsified it
 *
 * `CLAUDE.md` says it without qualification: *no store carries a column that
 * could join to another, and there is no mapping table between any pair; tests
 * assert the schemas share no key.* That is the sentence the whole data
 * business rests on.
 *
 * The test that was supposed to assert it — `tests/db-schema.test.ts` — checked
 * **column NAMES** against a list of forbidden fragments (`email`, `phone`,
 * `device`, …). `feedback.reply_to` holds a raw email address and does not
 * contain the letters `email`, so it was named as a deliberate exception and
 * waved through. `questionnaire_invitations.email` holds a raw email address
 * too. **Two tables, one value space, equality-joinable, no foreign key, and a
 * guard that could not see it** — because it was searching for the FORM the
 * thing is spelled in rather than for the thing (RULING 110, in a test).
 *
 * ## The scope correction, recorded rather than smoothed
 *
 * `questionnaire_invitations.email` is a candidate's address from the county
 * clerk's **certified public filing**. It is a public record about a public
 * person, held to send one questionnaire, and it is not reader data. Nothing
 * about it is wrong.
 *
 * The finding's force is the CLASS: a raw identity value persisted in a reader
 * store, the constitutional claim is absolute, and an absolute claim is
 * falsified by one counterexample regardless of how defensible the other side
 * of the join is.
 *
 * ## What this file is
 *
 * The registry the boundary test reads. Every column of every table is
 * classified by the VALUE SPACE it holds — what kind of thing the value IS —
 * and by which STORE CLASS its table belongs to. A column missing from here
 * fails the build, so a new column is a classification somebody has to make
 * rather than a name somebody has to get past a regex.
 */

/**
 * What kind of value a column holds.
 *
 * The distinction that matters is between a value that EXISTS IN THE WORLD
 * independently of us — an email address, a phone number, a street address —
 * and one this project MINTED, which is meaningless outside our own tables. A
 * world value is joinable to anything else holding the same world value,
 * including data we do not control. A minted handle is joinable only where we
 * put it, and we can say exactly where that is.
 */
export type ValueSpace =
  /** A value that identifies a person and exists independently of us. */
  | "EMAIL_ADDRESS"
  | "PHONE_NUMBER"
  | "POSTAL_ADDRESS"
  | "IP_ADDRESS"
  /** A handle this project minted. Meaningless outside our own tables. */
  | "OPAQUE_HANDLE"
  /** A one-way digest of something. Joinable to another digest of the same input. */
  | "DIGEST"
  /** A public-record identifier for a government, a body, or a candidacy. */
  | "CIVIC_IDENTIFIER"
  /** Free text a person typed. Scrubbed at the write path where it is a reader's. */
  | "PROSE"
  /** Anything that identifies nobody: a timestamp, a count, an enum, a URL. */
  | "NON_IDENTIFYING";

/**
 * What a table IS, which decides what it may hold.
 *
 * - `READER_COLLECTION` — the n-stores of `CLAUDE.md`. What a reader did or
 *   said. These are the stores whose aggregates are sold, and the whole
 *   neutrality claim is that they cannot be resolved to a person.
 * - `CIVIC_CONTENT` — public records this product republishes. A meeting, a
 *   candidate's filed contact, an agenda document. About public bodies and
 *   public people, not about readers.
 * - `OPERATIONAL` — machinery. Rate-limiter counters, a write alarm, a
 *   single-use token digest. Never sold, never exported.
 * - `CONTACT_DELIVERY` — the one place a reader-supplied address may live, so
 *   the author can answer somebody who asked to be answered. Holds an address
 *   and the opaque handle it was filed under, and nothing else about anybody.
 */
export type StoreClass =
  | "READER_COLLECTION"
  | "CIVIC_CONTENT"
  | "OPERATIONAL"
  | "CONTACT_DELIVERY";

export interface ColumnDomain {
  space: ValueSpace;
  /** Why, in one line. Read by a person, not by the test. */
  why?: string;
  /**
   * **BC-11 (2026-08-24) — WHICH DIGEST SPACE, for a `DIGEST` column.**
   *
   * The literal prefix the input is digested under, so `""` means the bare
   * key. Required on every `DIGEST` column and meaningless on any other.
   *
   * ## Why this had to exist before a fourth store could be added correctly
   *
   * The boundary test treated `DIGEST` as a joinable space outright: two
   * reader stores holding one were a failure, full stop. That was right about
   * the DEFAULT and wrong about the mechanism, and the difference only shows
   * up when a fourth store arrives.
   *
   * Two sha256 columns are equality-joinable if and only if they digest the
   * same INPUT. `sha256(key)` and `sha256("intake-limiter:" + key)` over one
   * browser key produce values that can never match — that is precisely why
   * the limiter was given a prefix in the first place (T08), and the registry
   * said so in prose that no test could read.
   *
   * So the classification descends one level. A `DIGEST` column now declares
   * its input space, and the guard asserts the spaces are DISTINCT rather than
   * asserting there is at most one digest. That is strictly stronger: the old
   * form would have passed a second store that reused the bare-key space, as
   * long as it was the only other one.
   */
  digestSpace?: string;
}

export interface TableDomain {
  storeClass: StoreClass;
  columns: Record<string, ColumnDomain>;
}

const nonIdentifying = (...names: string[]): Record<string, ColumnDomain> =>
  Object.fromEntries(names.map((n) => [n, { space: "NON_IDENTIFYING" as const }]));

/**
 * THE REGISTRY. Every table, every column.
 *
 * Kept as data rather than as assertions so the boundary test can compute over
 * it — the point of A-001 is that a rule expressed as a list of forbidden
 * names cannot see a value space, and a rule expressed as value spaces can.
 */
export const IDENTITY_DOMAINS: Record<string, TableDomain> = {
  search_log: {
    storeClass: "READER_COLLECTION",
    columns: {
      ...nonIdentifying(
        "id",
        "occurred_at",
        "event_type",
        "division_vintage",
        "detail",
        "run_class",
        "coverage_tier",
        "coverage_tier_distribution",
      ),
      approximate_location: {
        space: "NON_IDENTIFYING",
        why:
          "A ZCTA, stored as orientation only. It resolves a district, not a person, and " +
          "CLAUDE.md names it explicitly as the one geographic value permitted here.",
      },
      ocd_ids: { space: "CIVIC_IDENTIFIER", why: "Divisions, not people." },
      run_id: {
        space: "OPAQUE_HANDLE",
        why: "Names a synthetic WALK. Null on every organic row by construction.",
      },
    },
  },

  reactions: {
    storeClass: "READER_COLLECTION",
    columns: {
      ...nonIdentifying(
        "id",
        "occurred_at",
        "target_type",
        "target_id",
        "reaction",
        "scale_version",
        "division_vintage",
        "verification_tier",
        "suspect_reason",
        "run_class",
        "coverage_tier",
        "coverage_tier_distribution",
      ),
      ocd_ids: { space: "CIVIC_IDENTIFIER" },
      free_text: {
        space: "PROSE",
        why: "Scrubbed at the single write path (T09) before it is stored.",
      },
      reaction_key_hash: {
        space: "DIGEST",
        digestSpace: "",
        why:
          "sha256 of a RANDOM browser-minted key. Deliberately a different digest space " +
          "from the intake limiter's, and it exists on this table alone.",
      },
      run_id: { space: "OPAQUE_HANDLE" },
    },
  },

  feedback: {
    storeClass: "READER_COLLECTION",
    columns: {
      ...nonIdentifying("id", "received_at", "surface", "run_class", "suspect_reason"),
      message: { space: "PROSE", why: "Scrubbed at the write path (T09)." },
      run_id: { space: "OPAQUE_HANDLE" },
      contact_ref: {
        space: "OPAQUE_HANDLE",
        why:
          "A-001. A RANDOM handle minted per submission — never derived from the address, " +
          "because a shared deterministic hash is the same join key relocated. The address " +
          "itself lives in feedback_contact and this row cannot be resolved to it without " +
          "that table.",
      },
    },
  },

  feedback_contact: {
    storeClass: "CONTACT_DELIVERY",
    columns: {
      ...nonIdentifying("received_at"),
      contact_ref: {
        space: "OPAQUE_HANDLE",
        why: "The handle the feedback row carries. Random, minted by us, meaningless elsewhere.",
      },
      address: {
        space: "EMAIL_ADDRESS",
        why:
          "The one place a reader-supplied address lives. Never exported, never aggregated, " +
          "deleted on the same schedule as the message it came with.",
      },
    },
  },

  intake_limiter: {
    storeClass: "OPERATIONAL",
    columns: {
      ...nonIdentifying(
        "day_bucket",
        "day_count",
        "minute_bucket",
        "minute_count",
        "updated_at",
      ),
      digest: {
        space: "DIGEST",
        digestSpace: "intake-limiter:",
        why:
          'sha256("intake-limiter:" + key) — deliberately a different digest space from the ' +
          "reactions store's sha256(key), so the two cannot be equality-joined.",
      },
    },
  },

  write_alarm: {
    storeClass: "OPERATIONAL",
    columns: nonIdentifying("id", "raised_at", "store", "error_code", "error_message"),
  },

  questionnaire_invitations: {
    storeClass: "CIVIC_CONTENT",
    columns: {
      ...nonIdentifying(
        "id",
        "instrument_version",
        "office_class",
        "planned_invited_on",
        "planned_reminders_on",
        "deadline",
        "invited_on",
        "reminded_on",
        "contact_source_url",
        "contact_source_org",
        "contact_collected_at",
      ),
      candidacy_id: { space: "CIVIC_IDENTIFIER" },
      contest_id: { space: "CIVIC_IDENTIFIER" },
      email: {
        space: "EMAIL_ADDRESS",
        why:
          "A candidate's address from the county clerk's CERTIFIED PUBLIC FILING, held to " +
          "send one questionnaire. A public record about a public person — not reader data.",
      },
    },
  },

  questionnaire_responses: {
    storeClass: "CIVIC_CONTENT",
    columns: {
      ...nonIdentifying(
        "id",
        "version",
        "submitted_at",
        "instrument_version",
        "office_class",
        "withdrawn_at",
      ),
      candidacy_id: { space: "CIVIC_IDENTIFIER" },
      answers: {
        space: "PROSE",
        why: "A candidate's own words, published verbatim (RULING 112). Public by intent.",
      },
    },
  },

  questionnaire_tokens: {
    storeClass: "OPERATIONAL",
    columns: {
      ...nonIdentifying("id", "issued_at", "expires_at", "used_at"),
      candidacy_id: { space: "CIVIC_IDENTIFIER" },
      token_digest: {
        space: "DIGEST",
        digestSpace: "questionnaire-token:",
        why: "sha256 of a single-use token. The token itself is never stored.",
      },
    },
  },

  meetings: {
    storeClass: "CIVIC_CONTENT",
    columns: {
      ...nonIdentifying(
        "id",
        "division_vintage",
        "body_name",
        "title",
        "starts_at",
        "time_zone",
        "location_name",
        "location_lat",
        "location_lng",
        "online_label",
        "online_join_url",
        "agenda_url",
        "jurisdiction",
        "status",
        "source_url",
        "source_org",
        "collected_at",
        "verified_at",
      ),
      ocd_id: { space: "CIVIC_IDENTIFIER" },
      location_address: {
        space: "POSTAL_ADDRESS",
        why:
          "A public building's street address, published by the body on its own notice. It " +
          "identifies a town hall, not a person.",
      },
    },
  },

  agenda_documents: {
    storeClass: "CIVIC_CONTENT",
    columns: {
      ...nonIdentifying(
        "id",
        "meeting_id",
        "division_vintage",
        "document_url",
        "content_hash",
        "retrieved_at",
        "content_type",
        "extraction",
        "extraction_note",
        "source_url",
        "source_org",
        "collected_at",
        "verified_at",
      ),
      ocd_id: { space: "CIVIC_IDENTIFIER" },
      text: {
        space: "PROSE",
        why: "The body's own published agenda text, extracted verbatim.",
      },
    },
  },

  /**
   * **BC-11 — SPEAK YOUR MIND, the fourth reader-collection store.**
   * (The author's ruling, 2026-08-24.)
   *
   * Registered here in the same commit that creates the table, which is the
   * point of this registry: a column missing from it fails the build, so a new
   * store is a classification somebody made rather than a table that appeared.
   *
   * **This store was born UNDER the boundary test**, not retrofitted to it —
   * the brief asks the question explicitly, and the answer is that
   * `tests/identity-boundary.test.ts` (A-001, RULING 132) existed before this
   * table did and proves it over VALUE SPACES rather than column names.
   *
   * Nothing here is a world identity value. There is no email, no phone, no
   * address and no account reference, because the surface never asks for one.
   */
  speak_your_mind: {
    storeClass: "READER_COLLECTION",
    columns: {
      ...nonIdentifying(
        "id",
        "occurred_at",
        "subject_type",
        "division_vintage",
        "review_state",
        "review_reason",
        "suspect_reason",
        "run_class",
        "coverage_tier",
        "coverage_tier_distribution",
        // An enum list of WHICH KINDS of self-identifying content were found
        // and removed — never the content. Storing what was redacted beside
        // the redaction would defeat the redaction.
        "self_disclosure",
      ),
      subject_id: {
        space: "CIVIC_IDENTIFIER",
        why:
          "The public body, official or meeting that was spoken TO. It identifies who was " +
          "spoken about, never who spoke.",
      },
      ocd_ids: {
        space: "CIVIC_IDENTIFIER",
        why: "The reader's zip-resolved divisions. Districts, not a person and not an address.",
      },
      text: {
        space: "PROSE",
        why:
          "Scrubbed at the single write path (T09) AND passed through the BC-11 self-" +
          "disclosure redaction, which also FLAGS what it removed so a flagged row can " +
          "never export verbatim.",
      },
      speak_key_hash: {
        space: "DIGEST",
        digestSpace: "speak-your-mind:",
        why:
          "sha256('speak-your-mind:' + a RANDOM browser-minted key). The prefix is the " +
          "boundary: reactions hash the same kind of key as sha256(key) and the intake " +
          "limiter as sha256('intake-limiter:' + key), so without it three stores would " +
          "share one digest space and be equality-joinable on it.",
      },
      run_id: {
        space: "OPAQUE_HANDLE",
        why: "Names a synthetic RUN, hashed in its own space. Null on every organic row.",
      },
    },
  },
  /**
   * **ASK03 (2026-08-27) — classified the day the table is DECLARED, not the
   * day it is switched on.**
   *
   * `ripcord.askSignalCapture` ships PULLED, so no row exists yet. Classifying
   * it now is the whole difference between a store born under this boundary
   * and one retrofitted to it — which is how A-001 happened in the first place.
   */
  ask_interactions: {
    storeClass: "READER_COLLECTION",
    columns: {
      ...nonIdentifying(
        "id",
        "occurred_at",
        "division_vintage",
        "run_class",
        "coverage_tier",
        "coverage_tier_distribution",
        // WHAT THE PIPELINE UNDERSTOOD, not who asked: a closed enum of
        // question kinds and one of four tenses.
        "intent",
        "temporal_kind",
        "resolution_state",
        "answer_mode",
        "validation_passed",
        // Denominators. Small integers about how much evidence stood behind an
        // answer — a property of our corpus, never of a reader.
        "evidence_record_count",
        "evidence_source_count",
        "named_gap_count",
        // WHICH PAGE asked. Three values, shared by every reader on that page.
        "surface",
        // The two location AXES. Neither is a location: they say what kind of
        // claim the location is and how well it is evidenced. See
        // lib/ask/residency.ts for why one enum could not carry both.
        "residency_relation",
        "location_confidence",
        // Which model wrote the answer, for audit. A fact about us.
        "answer_model",
        // The reasoning EFFORT that model ran at. A fact about our own
        // configuration, exactly like `answer_model` beside it: pinned per
        // route in lib/ask/, identical for every reader who reaches that
        // route, and null on the deterministic paths that call no model at
        // all. It cannot vary with who asked, so it can carry nothing about
        // them.
        "answer_effort",
        // An enum list of WHICH KINDS of self-identifying content were found
        // and removed — never the content, for the same reason as Speak Your
        // Mind: storing what was redacted beside the redaction defeats it.
        "self_disclosure",
      ),
      approximate_location: {
        space: "NON_IDENTIFYING",
        why:
          "A zip the reader typed, stored as orientation exactly as the search log's is. The " +
          "author's rule of 2026-08-27 reads it as a SELF-DECLARED HOME zip, which is real " +
          "signal and is not an address: 85641 crosses school, legislative, fire and special-" +
          "district lines, so it establishes a zip COHORT and frequently not an exact " +
          "governing unit. `zipCohortOnly` is the mechanical gate between those two sentences.",
      },
      ocd_ids: {
        space: "CIVIC_IDENTIFIER",
        why: "The reader's zip-resolved divisions. Districts, not a person and not an address.",
      },
      subject_ids: {
        space: "CIVIC_IDENTIFIER",
        why:
          "The PUBLIC governments, officeholders or measures the question resolved to — a " +
          "school district, a governor. Facts about a government, never about the reader.",
      },
      question_scrubbed: {
        space: "PROSE",
        why:
          "The reader's own words, passed through the BC-11 self-disclosure redaction FIRST " +
          "(which strips self-naming and FLAGS what it found) and then the T09 scrub. The " +
          "order is load-bearing: the scrub replaces the very tokens detection needs, so " +
          "detecting afterwards reports nothing on every row. One write path, no second door.",
      },
      answer_text: {
        space: "PROSE",
        why:
          "The answer the reader actually received, so an aggregate can say what was " +
          "communicated rather than only what was asked. Generated from an evidence pack of " +
          "records we hold, so it contains no reader-supplied text at all.",
      },
      ask_key_hash: {
        space: "DIGEST",
        digestSpace: "ask-interaction:",
        why:
          "sha256('ask-interaction:' + a RANDOM browser-minted key). It counts DISTINCT " +
          "READERS for an aggregate and is never exported as a buyer-visible identifier. The " +
          "prefix is the boundary: reactions hash the same kind of key as sha256(key), speak " +
          "as sha256('speak-your-mind:' + key) and the limiter as sha256('intake-limiter:' + " +
          "key), so without a fourth distinct prefix these stores would be equality-joinable " +
          "on a value nobody would have to look up.",
      },
      run_id: {
        space: "OPAQUE_HANDLE",
        why: "Names a synthetic RUN, hashed in its own space. Null on every organic row.",
      },
      /*
       * **THE EVIDENCE PROVENANCE** (PR #212 follow-up, 2026-08-28). Four of
       * the five are CIVIC_IDENTIFIER and one is NON_IDENTIFYING, and the
       * distinction matters: an id of a public record is a fact about a
       * government, and a retrieval timestamp is a fact about our own machine.
       * None of the five is a fact about a reader, and none of them can be
       * joined to a person — the value space of a URL a county published is the
       * county's publication, not anybody's identity.
       */
      evidence_record_refs: {
        space: "CIVIC_IDENTIFIER",
        why:
          "`<kind>:<id>` for each PUBLIC record the answer was built from — a meeting id, a " +
          "contest id, an agenda document URL. Counts alone could never answer 'what evidence " +
          "supported the answer readers actually saw?', which is the only question this store " +
          "exists to be audited against. References, never the documents: a public agenda is " +
          "already public and copying it here would make a behavioural store a document archive.",
      },
      evidence_source_urls: {
        space: "CIVIC_IDENTIFIER",
        why:
          "The URLs of the public documents behind the delivered answer. A government's own " +
          "publication address, shared by every reader who was shown it.",
      },
      evidence_source_orgs: {
        space: "CIVIC_IDENTIFIER",
        why:
          "The publishers named on those records — 'Vail School District Governing Board'. An " +
          "organisation that published a public document, never a person.",
      },
      ...nonIdentifying(
        // The oldest and newest retrieval stamps behind the answer. Facts about
        // when OUR collection ran, for staleness audit — not about a reader and
        // not about when anybody asked anything.
        "evidence_retrieved_from",
        "evidence_retrieved_to",
      ),
    },
  },
  /**
   * **OWN-Q6 (2026-08-31) — THE DEMAND SIGNAL.**
   *
   * A reader tapping *"Want us to get this info sooner?"*. It is a
   * READER_COLLECTION store by construction — a reader wrote it — and it is
   * the thinnest one in the product: nine columns, no prose, and **no digest
   * column at all**.
   *
   * The absent digest is the load-bearing part. Every other reader store
   * carries a namespaced continuity hash so a browser's rows relate to each
   * other; the owner's instruction on this feature was no identity, so there
   * is nothing here to relate anything. A reader who taps twice writes two
   * unrelated rows.
   */
  demand_signals: {
    storeClass: "READER_COLLECTION",
    columns: {
      ...nonIdentifying(
        "id",
        "occurred_at",
        "division_vintage",
        "run_class",
        // WHAT KIND of card the pill was on, and the single-member enum the
        // pill can send. Two closed vocabularies, shared by every reader.
        "subject_type",
        "signal",
      ),
      subject_id: {
        space: "CIVIC_IDENTIFIER",
        why:
          "The PUBLIC body or candidate the reader was looking at — a registry body id, a " +
          "division OCD-ID, or a ballot candidate key. A fact about a government or a person " +
          "standing for office, never about the reader.",
      },
      ocd_ids: {
        space: "CIVIC_IDENTIFIER",
        why: "The reader's map-resolved divisions. Districts, not a person and not an address.",
      },
      run_id: {
        space: "OPAQUE_HANDLE",
        why:
          "Names a synthetic RUN, hashed as sha256('demand-run:' + id) in its own space, and " +
          "null on every organic row. The prefix is the boundary: the search log holds the raw " +
          "label and reactions hold sha256('reaction-run:' + id), so without a distinct prefix " +
          "these stores would be equality-joinable on a value nobody would have to look up.",
      },
    },
  },

};

/**
 * Value spaces that identify a PERSON and exist independently of us.
 *
 * These are the ones a join can be built on using data nobody here controls —
 * a mailing list, a voter file, a breach dump. A minted handle cannot.
 */
export const WORLD_IDENTITY_SPACES: readonly ValueSpace[] = [
  "EMAIL_ADDRESS",
  "PHONE_NUMBER",
  "IP_ADDRESS",
];

/**
 * Every (table, column) holding a given value space.
 *
 * This is the whole instrument: it answers *where does this KIND of value
 * live*, which is the question a name-based sweep cannot ask.
 */
export function columnsHolding(space: ValueSpace): string[] {
  const out: string[] = [];
  for (const [table, domain] of Object.entries(IDENTITY_DOMAINS)) {
    for (const [column, spec] of Object.entries(domain.columns)) {
      if (spec.space === space) out.push(`${table}.${column}`);
    }
  }
  return out.sort();
}

/** Every table declared with a given store class. */
export function tablesInClass(storeClass: StoreClass): string[] {
  return Object.entries(IDENTITY_DOMAINS)
    .filter(([, d]) => d.storeClass === storeClass)
    .map(([t]) => t)
    .sort();
}
