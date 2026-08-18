import { sql } from "drizzle-orm";
import {
  check,
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
    /**
     * The division whose government is meeting — **nullable** (D31, g10).
     *
     * It was NOT NULL, and that made this table unable to hold a meeting of a
     * government the Census does not enumerate: Pima Community College's
     * board, an authority, any of the seven special districts the D19
     * attribution pass found inside Pima County's own agendas. Those meetings
     * are in the served snapshot today with `ocdId: null`, so the constraint
     * would have failed the first adapter that tried to persist one — and the
     * available repairs were both worse than a nullable column: drop the
     * meeting (the D18 failure, again), or mint a canonical identifier for a
     * division that does not exist (the fabrication rule, again).
     *
     * A curated key may be stored here instead of a null once one has been
     * minted; see `lib/ocd/curated.ts` for what makes ours distinguishable
     * from opencivicdata's at a glance.
     */
    ocdId: text("ocd_id"),
    /**
     * Dataset vintage `ocdId` was resolved against — see header. Nullable
     * with it, and for the same reason: a vintage on a null division would be
     * stating which release of a dataset an absent identifier came from.
     */
    divisionVintage: text("division_vintage"),
    bodyName: text("body_name").notNull(),
    title: text("title").notNull(),
    /** Instant of the meeting's start; wall-clock lives with timeZone. */
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "string" }).notNull(),
    timeZone: text("time_zone").notNull(),
    /**
     * Where the meeting is held — **all four nullable together** (D18, g10).
     *
     * A meeting held online has no building, no address and no coordinates,
     * and it is a real public meeting. These were NOT NULL, so persisting one
     * meant either dropping it or inventing a place; the served snapshot now
     * carries twelve of them. Null here means the same thing it means in
     * `Meeting.location`: there is nothing to place, and `online_label`
     * says what there is instead.
     */
    locationName: text("location_name"),
    locationAddress: text("location_address"),
    locationLat: doublePrecision("location_lat"),
    locationLng: doublePrecision("location_lng"),
    /**
     * The published location string for a meeting held online, verbatim
     * ("Virtual Meeting", "Via Zoom Webinar") — D18. Present exactly when
     * the location columns are null.
     */
    onlineLabel: text("online_label"),
    /**
     * The join link the body published, or null when it published none. A
     * null is rendered as the named gap and never filled with the body's
     * homepage or a portal URL.
     */
    onlineJoinUrl: text("online_join_url"),
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
    /*
     * THE VINTAGE PAIRING, restated for a nullable identifier (D31, g10).
     *
     * The rule has not weakened. A division identifier without the dataset
     * vintage it was resolved against is a silent wrong-match waiting for the
     * next redistricting cycle — it joins successfully and reports something,
     * which is worse than nothing. What changed is that a meeting may now
     * legitimately have NO identifier, and NOT NULL on both columns was the
     * only way the old schema could say "these two travel together".
     *
     * So the pairing is enforced directly, by the DATABASE, across both
     * columns: either both are present or neither is. That is what the two
     * NOT NULLs were reaching for, said exactly, and it is the assertion
     * tests/db-schema.test.ts now makes.
     */
    check(
      "meetings_division_vintage_pairing",
      sql`(${table.ocdId} is null) = (${table.divisionVintage} is null)`,
    ),
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
    /**
     * WHOSE TRAFFIC THIS ROW IS (C05, 2026-08-17).
     *
     * Roughly 537 rows on production are OURS — written by local and CI
     * Playwright runs against the production database, because `.env.local`
     * holds the production `DATABASE_URL` and every `/api/meetings` GET
     * writes a row. Each walk adds about 28 more. The number only grows, and
     * nothing sold may ever contain it.
     *
     * The obvious fix — stop writing to production — was REJECTED by the
     * author and the rejection is recorded so nobody re-proposes it: it would
     * delete the only end-to-end proof that the write path works, and a
     * silently broken write path is how we would discover months from now
     * that reactions had stopped recording.
     *
     * So the row says which it is:
     *
     * - `ORGANIC` — a reader. The only class any aggregate may count.
     * - `SYNTHETIC` — an automated run, declared BY THE RUNNER at write time
     *   from its own environment. Never inferred later, never a user-agent
     *   guess: a heuristic applied to rows already written is exactly the
     *   investigation this column exists to make unnecessary.
     * - `UNKNOWN` — cannot be attributed either way. Excluded from every
     *   aggregate alongside the synthetic ones. **An unknown row is never
     *   counted as organic**, which is the whole discipline: every row
     *   written before this column existed is UNKNOWN, and that is an honest
     *   statement about what we can and cannot sell.
     * - `AUTHOR` — the author using his own product (added 2026-08-17). Not a
     *   robot and not a reader, and collapsing it into either would be a lie
     *   in a different direction each way: `SYNTHETIC` would call a human
     *   session a script, and `ORGANIC` would sell the author's own clicks
     *   back to a buyer as district signal. It is excluded from every
     *   aggregate exactly as `SYNTHETIC` and `UNKNOWN` are, and it exists so
     *   the exclusion can be stated with its reason rather than hidden inside
     *   a bucket that means something else. It is attributed ONLY on the
     *   author's own statement about his own traffic — never inferred, which
     *   is the same rule the other classes carry.
     *
     * Adding a value costs no migration: the column is `text`, with no CHECK
     * constraint (`lib/db/migrations/0004_blushing_zarda.sql`), so the enum is
     * a TypeScript-level union. The reads are the thing to keep honest, and
     * they are safe by construction — every sold query filters on
     * `run_class = 'ORGANIC'` (an allowlist in `lib/signal/search-log-reads.ts`),
     * so a new class is excluded the moment it exists rather than the moment
     * someone remembers to exclude it.
     */
    runClass: text("run_class", { enum: ["ORGANIC", "SYNTHETIC", "UNKNOWN", "AUTHOR"] })
      .notNull()
      .default("ORGANIC"),
    /**
     * Which automated run wrote this row — a run identity, never a person's.
     *
     * It is null on every `ORGANIC` row BY CONSTRUCTION (asserted in
     * `tests/db-schema.test.ts`), so it can never become a session key that
     * relates two readers' rows to each other. It relates a robot's rows to
     * the robot, and to nothing else: no other store carries it, and the
     * n-stores-never-join rule is unaffected.
     */
    runId: text("run_id"),
  },
  (table) => [
    index("search_log_occurred_at_idx").on(table.occurredAt),
    // Every aggregate reads through the exclusion filter (C05), so the class
    // is on the hot path of every sold query.
    index("search_log_run_class_idx").on(table.runClass),
  ],
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
 * **Reader feedback** — R40, 2026-08-17, the author's ruling (1A: in-app).
 *
 * The product used to put the author's personal email address on three
 * surfaces. It is gone, and this is what replaced it: an in-app form whose
 * submissions land here and nowhere else.
 *
 * ## It is a collection store, and it obeys the n-stores rule
 *
 * Four stores now, same rule for every n. This one holds what the reader
 * typed and nothing about the reader:
 *
 * - **No continuity key.** Unlike reactions, there is nothing to change
 *   later, so there is no engineering reason for a key — and where there is
 *   no reason there is no key. The rate limiter still counts this path, in
 *   its OWN digest space (`feedback-limiter:`), and that state lives in
 *   `intake_limiter` and expires on its own schedule.
 * - **No zip, no divisions, no IP, no email, no foreign key.** The reader
 *   cannot be located, contacted, or joined to a search-log row or a
 *   reaction. `tests/db-schema.test.ts` holds all four stores to that.
 * - **Scrubbed before storage.** The message runs through `lib/log/scrub.ts`
 *   (T09) at the single write path, so a reader who types their own phone
 *   number into a complaint does not make "identifier-free" false. The
 *   consequence is stated to the reader ON the form rather than buried: this
 *   is one-way, and we cannot write back.
 *
 * ## And it is never sold
 *
 * Feedback is read by the author and enters no aggregate and no export.
 * That is a sentence on /transparency, shipped in the same commit as this
 * table per the coupling rule, and it is also a property of the code: there
 * is no read path from `lib/signal/`, only `scripts/read-feedback.mts`.
 */
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" }).notNull(),
    /** What the reader wrote, scrubbed (T09). Capped at the route. */
    message: text("message").notNull(),
    /**
     * WHICH ENTRY POINT this came through — a closed enum, never a URL.
     *
     * The author reading a queue of reports needs to know whether someone was
     * looking at a coverage gap or at the site as a whole; a free-form
     * referrer would carry query strings and therefore whatever a reader had
     * typed. SIDEBAR ships now; COVERAGE is H02's missing-body link, which is
     * this same surface with a second entry point.
     */
    surface: text("surface", { enum: ["SIDEBAR", "TRANSPARENCY", "COVERAGE"] }).notNull(),
    /** Same declaration and the same meanings as the search log's (C05). */
    runClass: text("run_class", { enum: ["ORGANIC", "SYNTHETIC", "UNKNOWN", "AUTHOR"] })
      .notNull()
      .default("ORGANIC"),
    /** Null on every ORGANIC row by construction — a run identity, never a person's. */
    runId: text("run_id"),
    /**
     * Quarantine, not deletion, exactly as reactions (T08). A submission past
     * the soft threshold lands marked with WHY and is skipped by the author's
     * read path unless he asks for it. Nothing auto-deletes.
     */
    suspectReason: text("suspect_reason", {
      enum: ["VELOCITY", "LIMITER_UNAVAILABLE"],
    }),
  },
  (table) => [index("feedback_received_at_idx").on(table.receivedAt)],
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
