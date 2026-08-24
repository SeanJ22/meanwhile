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
