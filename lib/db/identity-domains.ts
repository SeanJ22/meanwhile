/**
 * Classifies every column of every table by the value space it holds and
 * every table by its store class. The identity boundary test reads this; a
 * column missing from here fails the build.
 */

/**
 * What kind of value a column holds. A world value (email, phone, address)
 * is joinable to outside data; a minted handle is joinable only where we put it.
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
 * What a table is, which decides what it may hold.
 * - READER_COLLECTION: what a reader did or said; must not resolve to a person.
 * - CIVIC_CONTENT: public records about public bodies and people.
 * - OPERATIONAL: machinery; never sold or exported.
 * - CONTACT_DELIVERY: the one place a reader-supplied address may live.
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
   * For a DIGEST column only: the literal prefix the input is digested under
   * ("" means the bare key). Two digests are joinable only when they share it.
   */
  digestSpace?: string;
}

export interface TableDomain {
  storeClass: StoreClass;
  columns: Record<string, ColumnDomain>;
}

const nonIdentifying = (...names: string[]): Record<string, ColumnDomain> =>
  Object.fromEntries(names.map((n) => [n, { space: "NON_IDENTIFYING" as const }]));

/** Every table, every column. */
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
      ...nonIdentifying("id", "received_at", "surface", "site", "run_class", "suspect_reason"),
      message: { space: "PROSE", why: "Scrubbed at the write path (T09)." },
      about: { space: "PROSE", why: "Reported card label, scrubbed; Sean authorized report context on 2026-09-30." },
      zip: { space: "NON_IDENTIFYING", why: "The reported card's approximate place, shared by every reader of that card; never a home address." },
      record_id: { space: "CIVIC_IDENTIFIER", why: "The public record being reported, never a reader identifier." },
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
        // Which kinds of self-identifying content were removed, never the content.
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
        "intent",
        "temporal_kind",
        "resolution_state",
        "answer_mode",
        "validation_passed",
        "evidence_record_count",
        "evidence_source_count",
        "named_gap_count",
        "surface",
        // Neither axis is a location; see lib/ask/residency.ts.
        "residency_relation",
        "location_confidence",
        "answer_model",
        "answer_effort",
        // Which kinds of self-identifying content were removed, never the content.
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
        // When our collection ran, not when anybody asked.
        "evidence_retrieved_from",
        "evidence_retrieved_to",
      ),
    },
  },
  /** Deliberately has no digest column: two taps from one reader are unrelated rows. */
  demand_signals: {
    storeClass: "READER_COLLECTION",
    columns: {
      ...nonIdentifying(
        "id",
        "occurred_at",
        "division_vintage",
        "run_class",
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

  reader_event_batches: {
    storeClass: "OPERATIONAL",
    columns: {
      ...nonIdentifying("archive_key", "payload_sha256", "event_count"),
      batch_id: { space: "DIGEST", digestSpace: "reader-event-batch:", why: "Internal retry key for an immutable event batch; never exported." },
    },
  },
  reader_event_members: {
    storeClass: "OPERATIONAL",
    columns: {
      ...nonIdentifying("period", "period_start", "zip", "topic", "event_type"),
      district: { space: "CIVIC_IDENTIFIER" },
      reader_hash: { space: "DIGEST", digestSpace: "reader-event:", why: "Internal anonymous distinct-user membership; no identity or export." },
    },
  },
  reader_event_totals: {
    storeClass: "READER_COLLECTION",
    columns: {
      ...nonIdentifying("period", "period_start", "zip", "topic", "event_type", "events", "users"),
      district: { space: "CIVIC_IDENTIFIER" },
    },
  },

  civic_data_payload_parts: {
    storeClass: "OPERATIONAL",
    columns: {
      hash: { space: "NON_IDENTIFYING", why: "The content hash of an immutable civic payload fragment, never a reader identity." },
      payload: { space: "CIVIC_IDENTIFIER", why: "Part of the existing civic candidate/read model, containing public officials and geographies." },
    },
  },

  civic_data_candidates: {
    storeClass: "OPERATIONAL",
    columns: {
      ...nonIdentifying(
        "source_id",
        "record_class",
        "scope",
        "state",
        "acquisition_succeeded",
        "raw_hash",
        "normalized_hash",
        "retrieved_at",
        "source_through",
        "parser_version",
        "failure_code",
      ),
      id: { space: "OPAQUE_HANDLE", why: "A source/scope/content/version handle minted by the routine data plane." },
      identity: { space: "CIVIC_IDENTIFIER", why: "Exact public-record identifiers for the officials or geographies in the candidate." },
      candidate: { space: "CIVIC_IDENTIFIER", why: "The authoritative civic candidate envelope; public officials and public geographies, never readers." },
      validation_receipt: { space: "NON_IDENTIFYING", why: "Machine verdicts, hashes, source routes and check details about one candidate." },
      promoted_version_id: { space: "OPAQUE_HANDLE" },
      last_known_good_version_id: { space: "OPAQUE_HANDLE" },
      failure_detail: { space: "PROSE", why: "Operational acquisition or validation detail, never reader-authored text." },
    },
  },

  civic_data_candidate_events: {
    storeClass: "OPERATIONAL",
    columns: {
      ...nonIdentifying("sequence", "state", "at"),
      id: { space: "OPAQUE_HANDLE" },
      candidate_id: { space: "OPAQUE_HANDLE" },
      detail: { space: "PROSE", why: "Append-only transition detail about public-source processing." },
    },
  },

  civic_data_promotions: {
    storeClass: "OPERATIONAL",
    columns: {
      ...nonIdentifying("source_id", "record_class", "scope", "promoted_at", "validation_receipt"),
      key: { space: "OPAQUE_HANDLE", why: "A record-class/scope projection key minted by the routine data plane." },
      current_version_id: { space: "OPAQUE_HANDLE" },
      last_known_good_version_id: { space: "OPAQUE_HANDLE" },
      payload: { space: "CIVIC_IDENTIFIER", why: "The promoted public civic read model; it contains no reader data." },
    },
  },

  civic_data_reader_projections: {
    storeClass: "OPERATIONAL",
    columns: {
      ...nonIdentifying(
        "record_class",
        "scope",
        "sequence",
        "composed_from",
        "fact_sha256",
        "generated_at",
        "composed_at",
        "source_through",
        "retrieved_at",
        "promoted_through",
      ),
      key: { space: "OPAQUE_HANDLE", why: "A record-class/scope projection key minted by the routine data plane." },
      payload: { space: "CIVIC_IDENTIFIER", why: "The prepared public civic serving copy composed from the promoted partitions; it contains no reader data." },
    },
  },

};

/** Value spaces that identify a person and exist independently of us. */
export const WORLD_IDENTITY_SPACES: readonly ValueSpace[] = [
  "EMAIL_ADDRESS",
  "PHONE_NUMBER",
  "IP_ADDRESS",
];

/** Every (table, column) holding a given value space. */
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
