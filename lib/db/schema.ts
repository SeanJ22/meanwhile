import {
  doublePrecision,
  index,
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
    targetType: text("target_type", { enum: ["FEDERAL_VOTE", "CANDIDATE"] }).notNull(),
    /** The roll-call key (`house:119-2:283`) — validated against the votes snapshot. */
    targetId: text("target_id").notNull(),
    /** The one-tap answer. There is deliberately no free-text column yet. */
    reaction: text("reaction", { enum: ["YES", "NO", "UNSURE"] }).notNull(),
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
