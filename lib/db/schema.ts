import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The persistence schema — tracker **D10**, landed 2026-08-13.
 *
 * Two shapes here are transcriptions of records that already exist in code
 * (`Meeting` in lib/sources/types.ts, `AgendaDocument` in
 * lib/meetings/agenda-documents.ts — both written as the tables they would
 * become); the third is the search log the transparency page describes.
 *
 * Conventions, non-negotiable:
 *
 * - **camelCase in TypeScript, snake_case in Postgres**, translated only at
 *   this boundary with explicit column names. Nothing else in the repo knows
 *   the snake_case names.
 * - **Every table that carries a division identifier carries a vintage**
 *   (§0e, recorded in docs/state.md §9). District identifiers are reused
 *   across redistricting cycles with different geometry, and a joined-but-
 *   wrong match is silent — it reports something rather than nothing. The
 *   vintage names the dataset the identifier was resolved against
 *   (`SourceDataset` in lib/registry/types.ts, e.g. TIGER_GENZ2025).
 *   `tests/db-schema.test.ts` asserts the pairing structurally.
 * - **The search log is permanently identifier-free** (CLAUDE.md, two
 *   stores that never join): no account key, no device ID, no fingerprint,
 *   no retained IP, no session key that survives the session, no foreign
 *   key to anything. It records what was asked and where — never who. When
 *   a subscription store is built it gets its own table with no behavioral
 *   history, and a test asserts the two schemas share no key.
 */

/**
 * One sitting of a public body, keyed by the source-namespaced id the
 * adapters already emit (`iqm2:morriscountynj:2242`). The snapshot file
 * remains the serving path for now; this is where meetings land when writes
 * begin, and the upsert strategy is ON CONFLICT (id) per D10's terms.
 */
export const meetings = pgTable(
  "meetings",
  {
    /** Source-namespaced: `<adapter>:<tenant>:<upstream id>`. */
    id: text("id").primaryKey(),
    ocdId: text("ocd_id").notNull(),
    /** Dataset vintage `ocdId` was resolved against — see header. */
    divisionVintage: text("division_vintage").notNull(),
    bodyName: text("body_name").notNull(),
    title: text("title").notNull(),
    /** Instant of the meeting's start; wall-clock lives with timeZone. */
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "string" }).notNull(),
    timeZone: text("time_zone").notNull(),
    locationName: text("location_name").notNull(),
    locationAddress: text("location_address"),
    locationLat: doublePrecision("location_lat").notNull(),
    locationLng: doublePrecision("location_lng").notNull(),
    agendaUrl: text("agenda_url"),
    /** Display only — join on ocdId, never on this. */
    jurisdiction: text("jurisdiction").notNull(),
    status: text("status", { enum: ["SCHEDULED", "CONCLUDED", "CANCELED"] }).notNull(),
    /** Provenance, flattened; never dropped in a transform. */
    sourceUrl: text("source_url"),
    sourceOrg: text("source_org").notNull(),
    collectedAt: timestamp("collected_at", { withTimezone: true, mode: "string" }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("meetings_ocd_id_idx").on(table.ocdId),
    index("meetings_starts_at_idx").on(table.startsAt),
  ],
);

/**
 * Agenda documents, append-only — one row per distinct version, id
 * `<meetingId>@<contentHash>`. Revisions are appended beside their prior
 * versions, never overwritten: a silently revised agenda is itself news.
 * Transcribed from AgendaDocumentStore, which keeps the same contract in
 * memory.
 */
export const agendaDocuments = pgTable(
  "agenda_documents",
  {
    id: text("id").primaryKey(),
    meetingId: text("meeting_id").notNull(),
    ocdId: text("ocd_id").notNull(),
    divisionVintage: text("division_vintage").notNull(),
    /** Where the document was fetched from. Observed, never constructed. */
    documentUrl: text("document_url").notNull(),
    /** SHA-256 of the raw bytes — the revision detector. */
    contentHash: text("content_hash").notNull(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true, mode: "string" }).notNull(),
    contentType: text("content_type").notNull(),
    /** Extracted text; null means extraction failed and the note says why. */
    text: text("text"),
    extraction: text("extraction", { enum: ["html", "pdf", "failed"] }).notNull(),
    extractionNote: text("extraction_note"),
    sourceUrl: text("source_url").notNull(),
    sourceOrg: text("source_org").notNull(),
    collectedAt: timestamp("collected_at", { withTimezone: true, mode: "string" }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [index("agenda_documents_meeting_id_idx").on(table.meetingId)],
);

/**
 * The search log — what was asked and where, never who.
 *
 * Deliberately no relation to any other table: no foreign keys, no account
 * or device column, nothing that could resolve a row to a person. The zip
 * is `approximate_location` per the entry-experience rule — orientation,
 * never district truth. It is honest to sell aggregates of this table only
 * because it cannot be resolved to anyone; that property is load-bearing
 * and guarded in tests, not just described here.
 */
export const searchLog = pgTable(
  "search_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    /** What happened: a search, an open, a filter. */
    eventType: text("event_type", {
      enum: [
        "SEARCH",
        "BODY_OPENED",
        "MEETING_OPENED",
        "DISTRICT_SELECTED",
        "FILTER_APPLIED",
        "OFFICIAL_OPENED",
        // The ask box (5, 2026-08-19) — routed asks carry the topic id;
        // refusals carry the capped question text. Same identifier-free
        // row as every other event.
        "QUESTION_ASKED",
      ],
    }).notNull(),
    /** Zip as entered. Orientation only — never resolved to a person. */
    approximateLocation: text("approximate_location"),
    /**
     * Divisions the event touched, as OCD-IDs. One event resolves against
     * one geometry dataset, so the vintage is a row column, not per entry.
     */
    ocdIds: jsonb("ocd_ids").$type<string[]>().notNull(),
    divisionVintage: text("division_vintage").notNull(),
    /**
     * Event-shaped facts with no identifier in them: the radius asked for,
     * the cascade tier answered, the filter values, the body or meeting id
     * opened. Never free text a person typed.
     */
    detail: jsonb("detail").$type<Record<string, string | number | boolean>>(),
  },
  (table) => [index("search_log_occurred_at_idx").on(table.occurredAt)],
);

/**
 * Reactions — the third collection store, and the first user-writable one.
 *
 * The n-stores rule (CLAUDE.md): search log, reactions, and the future
 * subscription store never join. Like the search log, this table is
 * permanently identifier-free — no account, no device ID, no retained IP,
 * no foreign key to anything. It records what a reader thought of a public
 * record and roughly where they were looking, never who they are.
 *
 * The one engineering wrinkle, solved without identity: "changeable
 * reaction" needs continuity. `reactionKeyHash` is the SHA-256 of a random
 * key the reader's browser invented on its first reaction
 * (`wtp.reaction_key` in localStorage). It relates a browser's reactions to
 * each other — enabling overwrite-on-change — and to nothing else: it joins
 * no other table, appears in no export, and clearing the browser's storage
 * simply means prior rows can no longer be edited (they remain anonymous
 * rows). Disclosed in exactly these terms on /transparency.
 *
 * `verificationTier` is present from row one so aggregates are tier-shaped
 * from the first export: everything today is ANONYMOUS; LOCALITY_VERIFIED
 * and VOTER_MATCHED are designed future tiers (T02), never claimed early.
 */
export const reactions = pgTable(
  "reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    /**
     * What kind of record the reaction attaches to. CANDIDATE joined
     * 2026-08-16 (3d) — the enum here is type-level on a text column, so no
     * migration is generated by widening it.
     */
    targetType: text("target_type", {
      // 2026-08-18 (D34) — the two funding classes join. The type doubles as
      // the ripcord provenance tag: FUNDING_TOTAL_REACTION and
      // CONTRIBUTOR_REACTION rows are excluded from aggregation while
      // ripcord.fundingReactionsInAggregates is pulled (it ships pulled).
      enum: ["FEDERAL_VOTE", "CANDIDATE", "FUNDING_TOTAL_REACTION", "CONTRIBUTOR_REACTION"],
    }).notNull(),
    /** The roll-call key (`house:119-2:283`) — validated against the votes snapshot. */
    targetId: text("target_id").notNull(),
    /**
     * The one-tap answer. There is deliberately no free-text column yet.
     *
     * SOMEONE_ELSE (M63) is accepted only on a candidate in a contest with
     * exactly one candidate; the write path enforces that, and a stored row
     * carrying it against a contested race would be a bug. The column is a
     * plain text enum, so widening it needs no destructive migration.
     */
    reaction: text("reaction", {
      enum: [
        "YES",
        "NO",
        "UNSURE",
        "SOMEONE_ELSE",
        // The five-point funding scale (2026-08-15). Accepted only on the
        // two funding target types; the write path enforces it in both
        // directions, so a yes/no/unsure row against a funding target is a
        // bug and not a legacy shape.
        "LOVE",
        "LIKE",
        "DISLIKE",
        "HATE",
        "DONT_CARE",
      ],
    }).notNull(),
    /**
     * **Which instrument produced this row** (2026-08-15).
     *
     * 1 = yes/no/unsure (+ SOMEONE_ELSE), the original scale and still the
     * one votes and candidates use. 2 = the five-point funding scale.
     *
     * Rows on different scales are never combined: the aggregator groups by
     * this column, and an export that put a v1 funding row and a v2 funding
     * row under one denominator would be reporting a trend caused by the
     * question changing. Server-derived from the target type on write —
     * never sent by the client, because the client does not get to say what
     * question it asked. Existing rows backfill to 1, which is what they
     * are: answers to the question we asked then.
     *
     * `SCALE_BREAKS` in lib/signal/reactions.ts dates the break and says why,
     * so a buyer holding both columns can read the reason.
     */
    scaleVersion: integer("scale_version").notNull().default(1),
    /**
     * Where the reader was looking, on the same approximate-location basis
     * as the search log: divisions resolved from the map view, zip-level at
     * finest. Never an address, never district truth.
     */
    ocdIds: jsonb("ocd_ids").$type<string[]>().notNull(),
    divisionVintage: text("division_vintage").notNull(),
    /** ANONYMOUS today; future tiers exist in the enum so no migration reshapes aggregates. */
    verificationTier: text("verification_tier", {
      enum: ["ANONYMOUS", "LOCALITY_VERIFIED", "VOTER_MATCHED"],
    }).notNull(),
    /** See header — browser continuity, not identity. Stored only hashed. */
    reactionKeyHash: text("reaction_key_hash").notNull(),
    /**
     * Quarantine, not deletion (T08). Rows that tripped an intake limit but
     * landed anyway are marked with WHY — never with any identifier — and
     * excluded from every aggregate and export (the clean pool is what the
     * business draws from; see lib/signal/aggregate.ts). Nothing is ever
     * auto-deleted; the author reviews and decides. Sticky on overwrite: a
     * burst cannot launder itself clean by re-submitting slowly
     * (lib/db/reactions.ts).
     */
    suspectReason: text("suspect_reason", {
      enum: ["VELOCITY", "LIMITER_UNAVAILABLE"],
    }),
  },
  (table) => [
    // One reaction per browser key per target: a changed answer overwrites
    // the prior one (upsert on this index), never accumulates.
    uniqueIndex("reactions_key_target_unq").on(
      table.reactionKeyHash,
      table.targetType,
      table.targetId,
    ),
    index("reactions_target_idx").on(table.targetType, table.targetId),
  ],
);

/**
 * Transient intake-limiter state (T08) — NOT a collection store, and never
 * to become one. This table exists so the per-device rate limit and daily
 * ceiling count across every serverless instance, which in-memory windows
 * cannot.
 *
 * The n-stores rule under load (CLAUDE.md): limiter state lives in its OWN
 * space and never joins the stores it protects. Enforced structurally:
 *
 * - `digest` is sha256 of "intake-limiter:" + the browser's raw continuity
 *   key — a DELIBERATELY DIFFERENT digest than reactions.reaction_key_hash
 *   (sha256 of the raw key alone). Two hashes of a secret nobody stores
 *   cannot be joined to each other; the guard in tests/db-schema.test.ts
 *   asserts no shared column ever appears.
 * - Counters only: no zip, no divisions, no reaction content, no IP, no
 *   foreign key. It records how OFTEN an anonymous device wrote — never
 *   what, never where, never who.
 * - Expires on its own schedule: rows untouched for 48 hours are purged by
 *   the daily tripwire run (scripts/intake-tripwire.mts). It appears in no
 *   export and no aggregate.
 */
export const intakeLimiter = pgTable("intake_limiter", {
  /** sha256("intake-limiter:" + raw key) — see header; joins nothing. */
  digest: text("digest").primaryKey(),
  /** UTC day (YYYY-MM-DD) the day counter belongs to. */
  dayBucket: text("day_bucket").notNull(),
  dayCount: integer("day_count").notNull(),
  /** UTC minute (YYYY-MM-DDTHH:MM) the minute counter belongs to. */
  minuteBucket: text("minute_bucket").notNull(),
  minuteCount: integer("minute_count").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
});
