import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
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
    /**
     * **THE COVERAGE TIER AT THE MOMENT THIS ROW WAS WRITTEN** (RULING 6,
     * Prompt B item 8, 2026-08-20).
     *
     * The business sells aggregate civic-interest signal. Interest from a
     * Tier 3 zip with forty candidate cards and interest from a Tier 1 zip
     * with none are NOT the same measurement — the first is a reader
     * responding to what they read, the second is a reader responding to an
     * empty page. If the tier is not on the row, no buyer can weight them
     * and neither can we.
     *
     * Stamped from the ledger at write time, never inferred at read time: a
     * tier recomputed when a buyer runs an export would describe today’s
     * coverage rather than the coverage the reader actually saw, which is
     * the one thing the number is for.
     *
     * NOT NULLABLE AND NOT DEFAULTED. A write that cannot state a tier fails
     * (item 8.3) rather than silently producing a row a buyer will read as
     * Tier 0. `UNKNOWN` is the honest value for a row whose tier genuinely
     * cannot be recovered — the backfill of rows written before this column
     * existed — and it is never ordered against the four tiers.
     *
     * WHY THIS DOES NOT BREAK n-STORES-NEVER-JOIN: it is a five-value enum
     * describing a PLACE’s research depth, identical for every reader in
     * that place. A column that can hold "TIER_1" cannot single anyone out,
     * exactly as `suspect_reason` cannot. `tests/db-schema.test.ts` carries
     * it as an allowed shared column with this reasoning.
     */
    coverageTier: text("coverage_tier", {
      enum: ["TIER_0", "TIER_1", "TIER_2", "TIER_3", "UNKNOWN"],
    }).notNull(),
    /**
     * THE PER-GOVERNMENT TIER DISTRIBUTION (Prompt C item 3, 2026-08-20).
     *
     * The floor above is the honest public headline and it does not move. It
     * is also `TIER_0` for 97.88% of zips nationally — no special district
     * anywhere has resolved territory and nearly every zip contains one — so
     * as a FIELD on a sold row it separates almost nothing. A buyer weighting
     * a row cannot tell a place with a fully enumerated county and one
     * unresolved fire district from a place where nothing at all is known,
     * and those are not the same measurement.
     *
     * So the same stamped values are also carried COUNTED rather than
     * floored: `T0:24,T1:0,T2:3,T3:0`. Written at write time from the stamped
     * ledger, never inferred at read time and never recomputed.
     *
     * STORED ONLY. It appears on no reader-facing surface, in no headline
     * figure, in no report summary and in no national distribution. The floor
     * tier remains the only tier stated publicly.
     *
     * NOT NULLABLE AND NOT DEFAULTED, for the same reason as the tier: a write
     * that cannot state it FAILS rather than landing as a plausible zero.
     * `UNKNOWN` is the honest value where it genuinely cannot be recovered —
     * four zeros would be a claim that we counted and found none.
     *
     * WHY THIS DOES NOT BREAK n-STORES-NEVER-JOIN: it is four small integers
     * describing a PLACE's research depth, identical for every reader in that
     * place, exactly as `coverage_tier` is. It singles nobody out, and
     * `tests/db-schema.test.ts` carries it as an allowed shared column with
     * this reasoning.
     */
    coverageTierDistribution: text("coverage_tier_distribution").notNull(),
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
      // MEASURE_PROVISION joined 2026-08-18 (P03): reactions attach to a
      // contested PROVISION of a measure, never to the measure as a whole,
      // which is what CLAUDE.md's reaction-capture section asks for. The
      // target id is the provision's own `<contestId>#<slug>` key.
      enum: [
        "FEDERAL_VOTE",
        "CANDIDATE",
        "FUNDING_TOTAL_REACTION",
        "CONTRIBUTOR_REACTION",
        "MEASURE_PROVISION",
      ],
    }).notNull(),
    /** The roll-call key (`house:119-2:283`) — validated against the votes snapshot. */
    targetId: text("target_id").notNull(),
    /**
     * The one-tap answer. The free-text column below carries the colour;
     * this carries the volume, and it is the only one an aggregate reads.
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
    /**
     * **The optional verbatim** (P03, 2026-08-18; free text unblocked by the
     * author for the testing window, and shipped behind
     * `ripcord.reactionFreeText`).
     *
     * "Binary carries volume; text carries color. Never require the text."
     * — CLAUDE.md. Nullable, and null is the ordinary case.
     *
     * ## It never reaches an aggregate, and the type system is the guarantee
     *
     * `ReactionRowForAggregation` in lib/signal/aggregate.ts has NO field
     * for this and never will. That is deliberate and it is stronger than a
     * filter: a filter can be forgotten, a missing field cannot be summed.
     * Free text leaves this table only through moderation, which is a human
     * path — CLAUDE.md: "Moderation runs before any export."
     *
     * ## It is still identifier-free, and that is not automatic
     *
     * A reader can type their own name into a text box, and no schema stops
     * them. What the n-stores rule requires is that this COLUMN carries no
     * key to anything: it sits on the reactions row beside the same hashed
     * continuity key the binary uses, joins nothing, and appears in no
     * export. The moderation path is where a self-identifying verbatim is
     * caught, and `docs/abuse-policy.md` owns that.
     */
    freeText: text("free_text"),
    /**
     * **WHOSE TRAFFIC THIS ROW IS** (F01-continued session 2, item 0D,
     * 2026-08-19). The same column the search log has carried since C05, on
     * the table where it matters most.
     *
     * The search log got this in August and reactions did not, so for three
     * days the product could say which SEARCHES were ours and could not say
     * which REACTIONS were. That is the wrong way round. A search-log row is
     * a lookup; a reaction row is the thing the business sells, and the whole
     * claim a buyer is paying for is that synthetic traffic is separable from
     * real traffic. **This table could not make that claim.** The only
     * attribution it carried was a timestamp and a key hash, and attributing
     * by timestamp is precisely the retrospective heuristic the search log's
     * column exists to make unnecessary — RULING 9 in this session's brief
     * closes the same question for the organic census for the same reason.
     *
     * Semantics are the search log's, unchanged, because two tables meaning
     * different things by one column name would be worse than no column:
     *
     * - `ORGANIC` — a reader. The only class any aggregate may count.
     * - `SYNTHETIC` — an automated run, declared BY THE RUNNER at write time.
     * - `UNKNOWN` — cannot be attributed. Excluded from every aggregate, and
     *   **never counted as organic**. Every row written before this column
     *   existed is UNKNOWN and stays UNKNOWN.
     * - `AUTHOR` — the author using his own product. Excluded too, with its
     *   reason stated rather than hidden in a bucket meaning something else.
     *
     * **The default differs from the search log's, deliberately.** There the
     * column defaults to `ORGANIC`, and the cost of that decision is written
     * into this repository's history: a `curl` deploy check landed four rows
     * in the sold store labelled as readers, and `pnpm overlaps` landed one,
     * on a single day. Here the write path REQUIRES the declaration —
     * `writeReaction` will not insert without one — so a caller that says
     * nothing gets an error rather than a reader. The database default is
     * `UNKNOWN` for the backfill's sake, and no code path relies on it.
     *
     * It joins nothing. It is a run identity, never a person's, and the
     * n-stores-never-join rule is unaffected: no other store carries a
     * `run_id`, and `tests/db-schema.test.ts` asserts the schemas share no key.
     */
    runClass: text("run_class", { enum: ["ORGANIC", "SYNTHETIC", "UNKNOWN", "AUTHOR"] })
      .notNull()
      .default("UNKNOWN"),
    /**
     * Which automated run wrote this row — **as a namespaced digest, not the
     * raw label**, and that difference from the search log is the whole of
     * the n-stores-never-join rule surviving this column.
     *
     * `sha256("reaction-run:" + runId)`. The search log holds the raw id, so
     * the two columns share a NAME and never a VALUE SPACE: no query can
     * relate a run's searches to that run's reactions. The precedent is
     * `intake_limiter`, which `CLAUDE.md` describes doing exactly this
     * against this same table's continuity hash, for exactly this reason.
     *
     * Null on every `ORGANIC` row by construction, exactly as on the search
     * log, so it can never become a session key relating two readers' rows.
     *
     * A session finds its own rows by computing the digest of the run id it
     * already knows — `hashRunId` in `lib/db/reactions.ts`.
     */
    runId: text("run_id"),
    /**
     * **THE COVERAGE TIER AT THE MOMENT THIS ROW WAS WRITTEN** (RULING 6,
     * Prompt B item 8, 2026-08-20).
     *
     * The business sells aggregate civic-interest signal. Interest from a
     * Tier 3 zip with forty candidate cards and interest from a Tier 1 zip
     * with none are NOT the same measurement — the first is a reader
     * responding to what they read, the second is a reader responding to an
     * empty page. If the tier is not on the row, no buyer can weight them
     * and neither can we.
     *
     * Stamped from the ledger at write time, never inferred at read time: a
     * tier recomputed when a buyer runs an export would describe today’s
     * coverage rather than the coverage the reader actually saw, which is
     * the one thing the number is for.
     *
     * NOT NULLABLE AND NOT DEFAULTED. A write that cannot state a tier fails
     * (item 8.3) rather than silently producing a row a buyer will read as
     * Tier 0. `UNKNOWN` is the honest value for a row whose tier genuinely
     * cannot be recovered — the backfill of rows written before this column
     * existed — and it is never ordered against the four tiers.
     *
     * WHY THIS DOES NOT BREAK n-STORES-NEVER-JOIN: it is a five-value enum
     * describing a PLACE’s research depth, identical for every reader in
     * that place. A column that can hold "TIER_1" cannot single anyone out,
     * exactly as `suspect_reason` cannot. `tests/db-schema.test.ts` carries
     * it as an allowed shared column with this reasoning.
     */
    coverageTier: text("coverage_tier", {
      enum: ["TIER_0", "TIER_1", "TIER_2", "TIER_3", "UNKNOWN"],
    }).notNull(),
    /**
     * THE PER-GOVERNMENT TIER DISTRIBUTION (Prompt C item 3, 2026-08-20).
     *
     * The floor above is the honest public headline and it does not move. It
     * is also `TIER_0` for 97.88% of zips nationally — no special district
     * anywhere has resolved territory and nearly every zip contains one — so
     * as a FIELD on a sold row it separates almost nothing. A buyer weighting
     * a row cannot tell a place with a fully enumerated county and one
     * unresolved fire district from a place where nothing at all is known,
     * and those are not the same measurement.
     *
     * So the same stamped values are also carried COUNTED rather than
     * floored: `T0:24,T1:0,T2:3,T3:0`. Written at write time from the stamped
     * ledger, never inferred at read time and never recomputed.
     *
     * STORED ONLY. It appears on no reader-facing surface, in no headline
     * figure, in no report summary and in no national distribution. The floor
     * tier remains the only tier stated publicly.
     *
     * NOT NULLABLE AND NOT DEFAULTED, for the same reason as the tier: a write
     * that cannot state it FAILS rather than landing as a plausible zero.
     * `UNKNOWN` is the honest value where it genuinely cannot be recovered —
     * four zeros would be a claim that we counted and found none.
     *
     * WHY THIS DOES NOT BREAK n-STORES-NEVER-JOIN: it is four small integers
     * describing a PLACE's research depth, identical for every reader in that
     * place, exactly as `coverage_tier` is. It singles nobody out, and
     * `tests/db-schema.test.ts` carries it as an allowed shared column with
     * this reasoning.
     */
    coverageTierDistribution: text("coverage_tier_distribution").notNull(),
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
    // Every aggregate reads through the exclusion filter, so the class is on
    // the hot path of every sold query — same reason as the search log's.
    index("reactions_run_class_idx").on(table.runClass),
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
     * typed. SIDEBAR ships now; COVERAGE is HUNT02's missing-body link, which is
     * this same surface with a second entry point.
     */
    surface: text("surface", { enum: ["SIDEBAR", "TRANSPARENCY", "COVERAGE"] }).notNull(),
    /**
     * THE HANDLE, NOT THE ADDRESS — A-001 (external correctness audit of
     * `336a3eb`, remediated 2026-08-24).
     *
     * R41 (2026-08-17, the author's ruling A) established that a reader may
     * deliberately hand over a reply address, and that decision stands
     * unchanged: the field is optional, blank is the default, blank submits,
     * it is filled only from its own labelled field, and it is stored
     * unscrubbed because scrubbing a deliberate act deletes it.
     *
     * What R41 got wrong was WHERE the value lives. Its own note argued the
     * n-stores rule was "unaffected... held to that structurally" because
     * `reply_to` existed on this table alone. **Being on one table is not the
     * test.** The test is whether a value space is shared, and an email
     * address is shared with the whole world: a mailing list, a voter file, a
     * breach dump, and — inside this very schema —
     * `questionnaire_invitations.email`. Two tables, one value space,
     * equality-joinable, and the guard that was supposed to catch it was
     * looking for columns NAMED `email` (RULING 110, in a test).
     *
     * So the reader collection store now carries a RANDOM handle and nothing
     * else. The address lives in `feedback_contact`, keyed by that handle.
     *
     * **The handle is minted, never derived**, and that is the load-bearing
     * half: hashing the address on both sides would be the same join key
     * relocated — two parties holding `sha256(address)` can still match rows,
     * and one of them would be this table again.
     *
     * Null when the reader left the field blank, which is most of the time.
     */
    contactRef: text("contact_ref"),
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
 * **THE CONTACT-DELIVERY STORE** — A-001, 2026-08-24.
 *
 * The one place a reader-supplied address lives, and a store class of its own:
 * not a reader collection store, not civic content, not machinery.
 *
 * It exists because a reader who types an address into a field labelled *we
 * will reply here* has asked to be replied to, and the alternative to holding
 * the address is not holding it — which would silently drop the thing they
 * asked for. R41 settled that question and this does not reopen it.
 *
 * What it changes is which table the value sits in. A raw email address in
 * `feedback` made the constitutional claim false: *no store carries a column
 * that could join to another*. It could join to
 * `questionnaire_invitations.email`, and to anything outside this database
 * holding the same address.
 *
 * ## What is here and what is deliberately not
 *
 * - The **address**, as the reader typed it.
 * - The **handle** it was filed under — random, minted per submission, never
 *   derived from the address. A deterministic hash on both sides would be the
 *   same join key wearing a different name.
 * - **When it arrived**, so it can be deleted on the same schedule as the
 *   message it came with.
 *
 * There is **no message**, no zip, no division, no surface, no run class and
 * no foreign key. Reading this table tells you that somebody asked to be
 * replied to and gives you no way to know what they said, where they were, or
 * what they searched for — that requires the handle, and the handle is in the
 * other table.
 *
 * It enters no export and no aggregate, and `tests/identity-boundary.test.ts`
 * asserts by VALUE SPACE — not by column name — that no reader collection
 * store holds an address again.
 */
export const feedbackContact = pgTable(
  "feedback_contact",
  {
    /** The random handle the feedback row carries. Not a foreign key. */
    contactRef: text("contact_ref").primaryKey(),
    /** As the reader typed it. Unscrubbed, for the reason R41 gives. */
    address: text("address").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [index("feedback_contact_received_at_idx").on(table.receivedAt)],
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
 *   the standing intake-runtime child (`scripts/intake-tripwire.mts`). Its
 *   result is a durable operations receipt; no GitHub cron or Git report is
 *   involved. It appears in no export and no aggregate.
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

/**
 * **THE WRITE ALARM — D73's second half** (Prompt D item 6.2, 2026-08-20).
 *
 * A failed write to a sold store raises HERE, on a path separate from the
 * reader-facing catch. RULING 25 governs the split and it is the whole design:
 * the reader-facing catch stays exactly as it is — a search still answers, a
 * reaction still returns — and NOTHING a visitor sees changes. This is a second
 * path, for us.
 *
 * D73 is why. Both sold stores stopped recording for four hours and every
 * instrument stayed green, because the only place the failure existed was a
 * `console.error` in a serverless function log this repo cannot read. A log
 * nobody can reach is not an alarm; it is a diary.
 *
 * **IT IS ITS OWN SPACE, and the n-stores-never-join rule is why.** The same
 * discipline `intake_limiter` carries: no zip, no division, no reaction
 * content, no continuity key, no run id, no IP, no foreign key, no column that
 * could join to any store. It records THAT a write to a named store failed, and
 * the database's own words about why. Nothing about who was writing.
 * `tests/db-schema.test.ts` asserts it shares no joinable column with any
 * store.
 *
 * **What it may hold, exactly.** The store name (a closed enum of two), the
 * Postgres error code, the error message TRUNCATED, and when. A message is the
 * database describing its own schema — `column "coverage_tier" does not exist`
 * is the sentence that would have closed D73 in a minute — and it is capped so
 * a driver that echoes a parameter cannot spill a value into this table.
 *
 * It appears in no export and no aggregate. `scripts/read-alarms.mts` reads it
 * and `pnpm walk:all` asserts it is empty, which is where "loudly" actually
 * happens.
 */
export const writeAlarm = pgTable("write_alarm", {
  id: uuid("id").primaryKey().defaultRandom(),
  raisedAt: timestamp("raised_at", { withTimezone: true, mode: "string" }).notNull(),
  /** Which sold store refused the write. Closed enum, checked below. */
  store: text("store").notNull(),
  /** The Postgres SQLSTATE, where the driver gave one. */
  errorCode: text("error_code"),
  /** The database's own words, truncated at the call site. Never a value. */
  errorMessage: text("error_message"),
}, (t) => [
  check("write_alarm_store_known", sql`${t.store} IN ('search_log', 'reactions')`),
  index("write_alarm_raised_at_idx").on(t.raisedAt),
]);

/* ===================================================================== *
 * THE CANDIDATE QUESTIONNAIRE — A CONTENT STORE, NOT A COLLECTION STORE.
 * (2026-08-23, the questionnaire-and-corpora brief, item 1. RULING 112.)
 *
 * ## Why these three tables are not governed by the n-stores rule
 *
 * The n-stores rule governs the SEARCH LOG, the REACTIONS store and the future
 * subscription store — the things that describe READERS and that are sold.
 * `tests/db-schema.test.ts` names them in `COLLECTION_STORES` and asserts they
 * share no joinable column.
 *
 * **A candidate's answers are none of those.** They are published civic content
 * that a public candidate wrote FOR publication, in the same class as a
 * roll-call vote, a filing or a campaign finance report — and they key on
 * `candidacy_id`, which is a row in a county clerk's certified filing rather
 * than anything about a person who reads this site. So they live beside the
 * ballot content, and:
 *
 * - **No column is added to `search_log` or to `reactions` by this feature**,
 *   and nothing here reads either. Asserted by name in
 *   `tests/questionnaire.test.ts` rather than left to be noticed.
 * - **These tables must never be added to `COLLECTION_STORES`.** Doing so would
 *   be claiming a candidate's published words are reader data, which is the
 *   opposite mistake but still a mistake.
 * - **The token digest is not an identifier for a person.** It is the SHA-256
 *   of a single-use link keyed to a public candidacy id, it expires, and the
 *   token itself is never stored — a leaked database hands nobody a working
 *   link.
 * ===================================================================== */

/**
 * One invitation. Generated symmetrically per contest; **`invited_on` is NULL
 * until the send path stamps it** (RULING 107 — a date is written only by the
 * code that performed the act, and a plan is not an act).
 */
export const questionnaireInvitations = pgTable(
  "questionnaire_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The public ballot candidacy. Content key, never a reader key. */
    candidacyId: text("candidacy_id").notNull(),
    contestId: text("contest_id").notNull(),
    /** The filed email from the certified record. Held to send; never rendered. */
    email: text("email").notNull(),
    instrumentVersion: text("instrument_version").notNull(),
    officeClass: text("office_class").notNull(),
    /** The schedule. Identical for every candidate in the contest. */
    plannedInvitedOn: text("planned_invited_on").notNull(),
    plannedRemindersOn: jsonb("planned_reminders_on").$type<string[]>().notNull(),
    deadline: text("deadline").notNull(),
    /** Stamped by the send path only. */
    invitedOn: text("invited_on"),
    remindedOn: jsonb("reminded_on").$type<string[]>().notNull(),
    /** Provenance of the email, so the record can be checked. */
    contactSourceUrl: text("contact_source_url").notNull(),
    contactSourceOrg: text("contact_source_org").notNull(),
    contactCollectedAt: text("contact_collected_at").notNull(),
  },
  (t) => [
    uniqueIndex("questionnaire_invitations_candidacy_idx").on(t.candidacyId),
    index("questionnaire_invitations_contest_idx").on(t.contestId),
  ],
);

/**
 * One submitted version. **Append-only** — an edit writes a new row, and the
 * highest `version` for a candidacy renders. Earlier versions are retained for
 * the same reason signal snapshots are immutable: a record that can be silently
 * rewritten cannot prove what it said.
 *
 * `answers` holds the candidate's own words, verbatim. **There is deliberately
 * no summary, excerpt, abstract or preview column**, and there never may be.
 */
export const questionnaireResponses = pgTable(
  "questionnaire_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidacyId: text("candidacy_id").notNull(),
    version: integer("version").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }).notNull(),
    instrumentVersion: text("instrument_version").notNull(),
    officeClass: text("office_class").notNull(),
    /** `[{ questionId, text }]`. **Verbatim. Never truncated, never summarised.** */
    answers: jsonb("answers").$type<Array<{ questionId: string; text: string }>>().notNull(),
    /**
     * Set when the candidate withdraws. **Internal only** — the card renders the
     * neutral invited state and never says a withdrawal happened.
     */
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    uniqueIndex("questionnaire_responses_candidacy_version_idx").on(t.candidacyId, t.version),
  ],
);

/**
 * One single-use link. **The token itself is never stored** — only
 * `sha256("questionnaire-token:" + token)`, minted in `lib/questionnaire/auth.ts`.
 */
export const questionnaireTokens = pgTable(
  "questionnaire_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenDigest: text("token_digest").notNull(),
    candidacyId: text("candidacy_id").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "string" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [uniqueIndex("questionnaire_tokens_digest_idx").on(t.tokenDigest)],
);

/* ==========================================================================
 * BC-11 — SPEAK YOUR MIND
 *
 * The author's ruling of 2026-08-24: this is the collection point for VERBATIM
 * CONSTITUENT SENTIMENT — product infrastructure, not a comment box. The
 * framing on the surface is what you would say if this person were standing in
 * front of you.
 *
 * ## It is a NEW SIBLING STORE, and the n-stores rule is untouched
 *
 * `CLAUDE.md`: *the collection stores never join — n stores, same rule for
 * every n.* This is the fourth. It carries no email, no account reference, no
 * address, and no key that resolves to any other table:
 *
 *  - `speakKeyHash` is `sha256("speak-your-mind:" + key)` over a RANDOM
 *    browser-minted key. The prefix is not decoration — the reactions store
 *    hashes the same kind of key as `sha256(key)` and the intake limiter as
 *    `sha256("intake-limiter:" + key)`, so three tables would otherwise share
 *    a digest space and be equality-joinable on it. Different prefix,
 *    different space, and `tests/identity-boundary.test.ts` proves it over the
 *    VALUES rather than over the column names (A-001, RULING 132).
 *  - `ocdIds` is the reader's zip-resolved DISTRICT — divisions, never an
 *    address and never district truth, on the same approximate-location basis
 *    the search log and the reactions store already use.
 *  - `subjectId` is a public-record identifier for a public body, official or
 *    meeting. It identifies who was SPOKEN ABOUT, never who spoke.
 *
 * ## NOT RENDERED PUBLICLY, and that is the default rather than a limitation
 *
 * `CLAUDE.md`'s no-user-to-user rule: reactions are write-only from the
 * reader's perspective, and showing aggregates anchors later respondents and
 * corrupts the data being sold. The same reasoning governs this. **The author
 * recorded the default as REVERSIBLE** — it is his call to make later, and
 * nothing here forecloses it.
 * ========================================================================== */
export const speakYourMind = pgTable(
  "speak_your_mind",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    /** What kind of public thing this was said to. */
    subjectType: text("subject_type", {
      /*
       * **`CANDIDATE` added 2026-08-25 (`BAL-19`).** Sean asked for Speak Your
       * Mind on the ballot battlecard, and a person standing for an office they
       * do not hold is not an `OFFICIAL` — recording them as one would be a
       * false claim about a named person, in the store itself.
       *
       * **NO MIGRATION IS OWED, and that is checked rather than assumed.** The
       * column is plain `text NOT NULL` in `0019_next_scarlet_witch.sql` with
       * no CHECK constraint, so this list is a TypeScript narrowing: widening
       * it changes what the code will write and nothing about the table.
       *
       * RULING 141's first rule is untouched. The subject id stays a PUBLIC
       * candidate key, nothing here identifies who is speaking, and no new
       * join path to any other store is created by naming a fourth kind of
       * public thing a reader can speak to.
       */
      enum: ["OFFICIAL", "BODY", "MEETING", "CANDIDATE"],
    }).notNull(),
    /** The subject's own public identifier — an ocd-id, a body id, a meeting id. */
    subjectId: text("subject_id").notNull(),
    /**
     * The reader's zip-resolved divisions. District-stamped, which is the
     * whole value of the row to anybody: sentiment without a district is
     * sentiment about nowhere.
     */
    ocdIds: jsonb("ocd_ids").$type<string[]>().notNull(),
    divisionVintage: text("division_vintage").notNull(),
    /**
     * What the reader wrote, after the T09 scrub AND the self-disclosure pass.
     * Capped at the write path.
     */
    text: text("text").notNull(),
    /**
     * **RULE 3 — the PII self-disclosure flags.** Which KINDS of self-
     * identifying content the pass found and removed. Never the content
     * itself: storing what was redacted alongside the redaction would defeat
     * the redaction.
     *
     * A non-empty array means this row may NEVER export verbatim. The flag is
     * carried on the row rather than recomputed at export time, because an
     * export path that had to remember to re-run a classifier is an export
     * path that will one day forget.
     */
    selfDisclosure: jsonb("self_disclosure").$type<string[]>().notNull(),
    /**
     * **RULE 4 — abuse triage, never forwarding.** `HELD` means this row is
     * waiting for the author's review and is excluded from everything until he
     * decides. Nothing typed here is ever auto-forwarded to anyone; the tier
     * model is `docs/abuse-policy.md`.
     */
    reviewState: text("review_state", { enum: ["NONE", "HELD"] })
      .notNull()
      .default("NONE"),
    /** WHY it is held, in the abuse policy's own tiers. Never who. */
    reviewReason: text("review_reason", {
      enum: ["T1_ABUSIVE", "T2_CONCERNING", "T3_THREAT"],
    }),
    /**
     * **THE COVERAGE TIER, because this is a SOLD store.**
     *
     * Item 8.4's rule: every write path into a sold store states a tier, and
     * it is derived SERVER-SIDE from the row's own divisions — a client does
     * not get to say how well researched the place it is looking at is.
     *
     * Sentiment from a place whose governments are fully enumerated is not the
     * same measurement as sentiment from a place where almost nothing is known,
     * and a buyer weighting a row is entitled to tell them apart.
     */
    coverageTier: text("coverage_tier", {
      enum: ["TIER_0", "TIER_1", "TIER_2", "TIER_3", "UNKNOWN"],
    }).notNull(),
    /** The same stamped values COUNTED rather than floored — see the
     *  reactions table above, whose note carries the whole reasoning. */
    coverageTierDistribution: text("coverage_tier_distribution").notNull(),
    /** Browser continuity, for dedup and abuse defence. See the header. */
    speakKeyHash: text("speak_key_hash").notNull(),
    /** Quarantine, not deletion (T08). Same semantics as the reactions store. */
    suspectReason: text("suspect_reason", {
      enum: ["VELOCITY", "LIMITER_UNAVAILABLE"],
    }),
    runClass: text("run_class", { enum: ["ORGANIC", "SYNTHETIC", "UNKNOWN", "AUTHOR"] })
      .notNull()
      .default("UNKNOWN"),
    /** `sha256("speak-run:" + runId)` — its own digest space, like every other. */
    runId: text("run_id"),
  },
  (table) => [
    index("speak_your_mind_subject_idx").on(table.subjectType, table.subjectId),
    index("speak_your_mind_review_idx").on(table.reviewState),
    index("speak_your_mind_occurred_idx").on(table.occurredAt),
  ],
);

/**
 * **THE ASK INTERACTION STORE — one question, one answer, one row.**
 * (ASK03, 2026-08-27.)
 *
 * ## Why this store exists
 *
 * Until now an ANSWERED ask stored only its topic id, and only a REFUSED ask
 * kept the question text. The product was therefore keeping its failures and
 * discarding its successes — and the successes are the signal: what a
 * constituent actually asked, which government it turned out to be about, and
 * what answer they were given.
 *
 * ## Born under the identity boundary, not retrofitted to it
 *
 * - **The question and the answer are ONE ROW.** Not a question row joined to
 *   an answer row by a durable session key: that shape is an organic
 *   behavioural graph of one person's political curiosity, and there is no
 *   version of this product that needs one.
 * - **`askKeyHash` is digested under its OWN PREFIX**, `"ask-interaction:"`,
 *   exactly as the reaction, speak and limiter keys are. Without distinct
 *   prefixes the stores would be equality-joinable on a value nobody would
 *   have to look up, which is the n-stores rule failing silently.
 * - **No email, no account reference, no address, no phone, no IP.** The
 *   subjects are PUBLIC civic ids — a school district, an officeholder — which
 *   are facts about a government rather than about a reader.
 * - **`questionScrubbed` is the scrubbed text and nothing else.** The scrub
 *   runs at the single write path, before the row exists.
 *
 * ## It is not writable yet, and that is deliberate
 *
 * `ripcord.askSignalCapture` ships PULLED. The data-privacy policy requires
 * honest disclosure at the box before free text a reader typed may enter a
 * store whose aggregates may reach campaigns, organizations and researchers.
 * That copy is NH246's and it is not approved. The table and its write path
 * exist so approval is a one-flip activation rather than a build.
 */
export const askInteractions = pgTable(
  "ask_interactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    /** The reader's words AFTER the scrub. Never the raw text. */
    questionScrubbed: text("question_scrubbed").notNull(),
    /** Anything the scrub blanked, as KINDS — never the values themselves. */
    selfDisclosure: jsonb("self_disclosure").$type<string[]>().notNull(),
    /** What the pipeline understood the reader to be asking for. */
    intent: text("intent").notNull(),
    temporalKind: text("temporal_kind").notNull(),
    /** The PUBLIC civic subjects it resolved to. Facts about governments. */
    subjectIds: jsonb("subject_ids").$type<string[]>().notNull(),
    resolutionState: text("resolution_state", {
      enum: ["BOUND", "AMBIGUOUS", "UNRESOLVED", "NONE"],
    }).notNull(),
    /**
     * **HOW the answer was produced, and it is never inferred.** Saying a
     * grounded model answered when only the deterministic path ran would make
     * every later measurement of this feature a fiction.
     */
    answerMode: text("answer_mode", {
      enum: [
        "GROUNDED_CLAUDE",
        "STRUCTURED_GROUNDED",
        "CLARIFY",
        "UNRESOLVED",
        "NO_EVIDENCE",
        "REJECTED_FELL_BACK",
      ],
    }).notNull(),
    /** What the reader actually read. Null where no prose was produced. */
    answerText: text("answer_text"),
    /** Which model wrote it, for audit. Null where none did. */
    answerModel: text("answer_model"),
    /**
     * **The reasoning effort the answer was actually produced at.**
     * (ITEM K, 2026-09-01 — the column Lane 3's resolved `effort` writes into.)
     *
     * Effort is pinned per route rather than chosen per request —
     * `lib/ask/interpret.ts` runs at `low`, `lib/ask/synthesize.ts` at
     * `medium` — and until now that pinning existed only in the source. A
     * trace that records the MODEL but not the effort cannot answer the one
     * question anybody asks of it later: *did the answers get worse when we
     * turned the effort down?* Model plus effort is the setting; the model
     * alone is half of it, and half a setting reads like a whole one.
     *
     * **Nullable, and the null is meaningful rather than lazy.** The
     * deterministic paths — `STRUCTURED_GROUNDED`, `CLARIFY`, `UNRESOLVED`,
     * `NO_EVIDENCE` — produce an answer with no model call at all, so there is
     * no effort to record. A default of `"low"` would have written a
     * measurement of something that never happened, which is precisely the
     * fabrication the answer-mode column above exists to prevent.
     */
    answerEffort: text("answer_effort"),
    /** Did structural validation pass? Null where it did not run. */
    validationPassed: boolean("validation_passed"),
    /** How much evidence stood behind it — a denominator, not a score. */
    evidenceRecordCount: integer("evidence_record_count").notNull().default(0),
    evidenceSourceCount: integer("evidence_source_count").notNull().default(0),
    namedGapCount: integer("named_gap_count").notNull().default(0),
    /**
     * **WHICH evidence, not merely how much** (PR #212 follow-up, 2026-08-28).
     *
     * Three counts describe ten thousand different answers. The question this
     * store exists to be audited against — *what evidence supported the answer
     * readers actually saw?* — cannot be answered from a number, and by the
     * time anybody asks it the corpus has moved on.
     *
     * These are REFERENCES and never documents. A public agenda is already
     * public; copying it in here would make a behavioural store a document
     * archive by accident. `lib/ask/evidence.ts` bounds both the count and the
     * length of each. Nothing in these columns is about a reader — every value
     * is a fact about a public record.
     */
    evidenceRecordRefs: jsonb("evidence_record_refs").$type<string[]>().notNull().default([]),
    evidenceSourceUrls: jsonb("evidence_source_urls").$type<string[]>().notNull().default([]),
    evidenceSourceOrgs: jsonb("evidence_source_orgs").$type<string[]>().notNull().default([]),
    /** The oldest and newest retrieval stamps behind the answer, for staleness. */
    evidenceRetrievedFrom: text("evidence_retrieved_from"),
    evidenceRetrievedTo: text("evidence_retrieved_to"),
    /** Which surface asked. Ballot and map questions differ in kind. */
    surface: text("surface", { enum: ["MAP", "BALLOT", "UNKNOWN"] }).notNull(),
    /** Orientation only, exactly as the search log's is. Never a person. */
    approximateLocation: text("approximate_location"),
    ocdIds: jsonb("ocd_ids").$type<string[]>().notNull(),
    divisionVintage: text("division_vintage").notNull(),
    /**
     * The two orthogonal location axes. See `lib/ask/residency.ts` for why one
     * enum could not carry both without implying one from the other.
     */
    residencyRelation: text("residency_relation", {
      enum: ["CURRENT_HOME", "PROSPECTIVE_HOME", "BROWSING", "UNKNOWN"],
    }).notNull(),
    locationConfidence: text("location_confidence", {
      enum: [
        "UNVERIFIED",
        "SELF_DECLARED_ZIP",
        "ADDRESS_RESOLVED",
        "ADDRESS_VALIDATED",
        "UNKNOWN",
      ],
    }).notNull(),
    coverageTier: text("coverage_tier", {
      enum: ["TIER_0", "TIER_1", "TIER_2", "TIER_3", "UNKNOWN"],
    }).notNull(),
    coverageTierDistribution: text("coverage_tier_distribution").notNull(),
    /**
     * `sha256("ask-interaction:" + key)` — its OWN digest space. It counts
     * DISTINCT READERS for an aggregate and it is never exported as a
     * buyer-visible identifier.
     */
    askKeyHash: text("ask_key_hash").notNull(),
    runClass: text("run_class", { enum: ["ORGANIC", "SYNTHETIC", "UNKNOWN", "AUTHOR"] })
      .notNull()
      .default("UNKNOWN"),
    /** `sha256("ask-run:" + runId)` — namespaced, like every other run id. */
    runId: text("run_id"),
  },
  (table) => [
    index("ask_interactions_occurred_idx").on(table.occurredAt),
    index("ask_interactions_mode_idx").on(table.answerMode),
    index("ask_interactions_surface_idx").on(table.surface),
  ],
);

/**
 * **THE READER'S ASK FOR A RECORD SOONER.** (OWN-Q6, the owner's amendment on
 * Q6/Q7, authorized 2026-08-31.)
 *
 * The owner asked for a pill reading *"Want us to get this info sooner?"* that
 * registers the click with a brief confirmation. What that pill is, precisely,
 * is a DEMAND SIGNAL: the reader telling us which gap to close first. It is the
 * only reader input in this product that is about OUR backlog rather than about
 * a government.
 *
 * ## What it is bounded to, and every bound is load-bearing
 *
 * ```
 *   ONE fixed enum value       no free text, ever, on any path
 *   NO identity column         no account, no address, and deliberately no
 *                              browser-continuity hash either
 *   NO read path for a reader  results are never rendered back, in any form
 *   SYMMETRIC                  every body and candidate card, or none
 * ```
 *
 * **The missing continuity hash is the deliberate part.** `reactions` carries
 * `reactionKeyHash` so a reader can change their mind, and that hash is the
 * nearest thing to an identifier this product holds. The owner's instruction on
 * this feature was no identity, so there is no continuity here at all: a reader
 * who taps twice writes two rows and neither is relatable to the other. A
 * de-duplication that needed a key would be an identifier arriving through the
 * back door, and the aggregate this feeds is a COUNT OF ASKS, which is what the
 * pill literally records.
 *
 * ## Why it is a table beside `reactions` rather than a column on it
 *
 * Because it answers a different question and must never dilute the one the
 * business sells. A reaction is *what I think of this public record*; a demand
 * signal is *I want you to go get this*. Summing them would put our own backlog
 * into a civic-interest aggregate, which is the one thing that number may not
 * contain.
 *
 * **The n-stores rule holds by VALUE SPACE, not by column name** (RULING 132).
 * This table shares `ocdIds` and `divisionVintage` with `reactions` and the
 * search log — the same approximate-location basis, never an address — and
 * carries no key that could relate a row here to a row there. `runId` is
 * namespaced to its own digest space for exactly that reason.
 *
 * ## No read path, and that is structural
 *
 * There is no aggregate reader, no export shape and no surface. The pill
 * confirms the write and says nothing about the total; `lib/db/demand-signal.ts`
 * exposes a write and no read, and `tests/demand-signal.test.ts` asserts it.
 * The owner sees demand through the ordinary operational path, not through the
 * product.
 */
export const demandSignals = pgTable(
  "demand_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    /** What the reader was looking at. Two kinds, and the surface is symmetric on both. */
    subjectType: text("subject_type", { enum: ["BODY", "CANDIDATE"] }).notNull(),
    /** The body's or candidate's own key. Never a reader's anything. */
    subjectId: text("subject_id").notNull(),
    /**
     * **THE SINGLE-MEMBER FIXED ENUM.**
     *
     * One value, because the pill asks one question and a reader who taps it
     * has said one thing. It is a column rather than an implied constant so a
     * second signal class — if the owner ever asks for one — arrives as a value
     * a query can group by, rather than as a second table nobody reconciles.
     * Widening it costs no migration: it is a text column with no CHECK.
     */
    signal: text("signal", { enum: ["WANT_THIS_SOONER"] }).notNull(),
    /**
     * Where the reader was looking, on the same approximate-location basis as
     * the search log and reactions: divisions resolved from the map view,
     * zip-level at finest. Never an address, never district truth.
     */
    ocdIds: jsonb("ocd_ids").$type<string[]>().notNull(),
    divisionVintage: text("division_vintage").notNull(),
    /**
     * Whose traffic this row is. Same four classes and the same rule as
     * `reactions`: the write path REQUIRES the declaration, and the database
     * default is `UNKNOWN` so an undeclared row is never a reader.
     */
    runClass: text("run_class", { enum: ["ORGANIC", "SYNTHETIC", "UNKNOWN", "AUTHOR"] })
      .notNull()
      .default("UNKNOWN"),
    /** `sha256("demand-run:" + runId)` — its own digest space, joining nothing. */
    runId: text("run_id"),
  },
  (table) => [
    index("demand_signals_occurred_idx").on(table.occurredAt),
    index("demand_signals_subject_idx").on(table.subjectType, table.subjectId),
  ],
);

/**
 * Routine authoritative civic-data candidate versions. These rows are
 * operational data, never repository snapshots. A failed candidate remains
 * evidence that acquisition happened, while the promoted pointer stays on LKG.
 */
export const civicDataCandidates = pgTable(
  "civic_data_candidates",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    recordClass: text("record_class").notNull(),
    scope: text("scope").notNull(),
    state: text("state").notNull(),
    acquisitionSucceeded: boolean("acquisition_succeeded").notNull(),
    rawHash: text("raw_hash"),
    normalizedHash: text("normalized_hash"),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true, mode: "string" }).notNull(),
    sourceThrough: text("source_through").notNull(),
    parserVersion: text("parser_version").notNull(),
    identity: jsonb("identity").notNull(),
    /** Complete candidate envelope, including normalized evidence and read model. */
    candidate: jsonb("candidate").notNull(),
    validationReceipt: jsonb("validation_receipt"),
    promotedVersionId: text("promoted_version_id"),
    lastKnownGoodVersionId: text("last_known_good_version_id"),
    failureCode: text("failure_code"),
    failureDetail: text("failure_detail"),
  },
  (table) => [
    uniqueIndex("civic_data_candidates_identity_idx").on(
      table.id,
      table.sourceId,
      table.recordClass,
      table.scope,
    ),
    index("civic_data_candidates_projection_idx").on(table.recordClass, table.scope, table.retrievedAt),
    index("civic_data_candidates_source_idx").on(table.sourceId, table.retrievedAt),
    check(
      "civic_data_candidates_state_known",
      sql`${table.state} IN ('FETCHED', 'SOURCE_BLOCKED', 'NORMALIZED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL', 'VALIDATED', 'PROMOTED')`,
    ),
    check(
      "civic_data_candidates_promotion_fields_coherent",
      sql`(
        ${table.state} = 'PROMOTED'
        AND ${table.promotedVersionId} IS NOT DISTINCT FROM ${table.id}
        AND ${table.lastKnownGoodVersionId} IS NOT DISTINCT FROM ${table.id}
      ) OR (
        ${table.state} <> 'PROMOTED'
        AND ${table.promotedVersionId} IS NULL
      )`,
    ),
    check(
      "civic_data_candidates_envelope_identity_coherent",
      sql`
        jsonb_typeof(${table.candidate}) IS NOT DISTINCT FROM 'object'
        AND (${table.candidate}->>'id') IS NOT DISTINCT FROM ${table.id}
        AND (${table.candidate}->>'sourceId') IS NOT DISTINCT FROM ${table.sourceId}
        AND (${table.candidate}->>'recordClass') IS NOT DISTINCT FROM ${table.recordClass}
        AND (${table.candidate}->>'scope') IS NOT DISTINCT FROM ${table.scope}
        AND ((${table.candidate}#>>'{retrieval,retrievedAt}')::timestamptz) IS NOT DISTINCT FROM ${table.retrievedAt}
        AND (${table.candidate}#>>'{temporal,sourceThrough}') IS NOT DISTINCT FROM ${table.sourceThrough}
        AND (${table.candidate}#>>'{normalization,parserVersion}') IS NOT DISTINCT FROM ${table.parserVersion}
        AND (${table.candidate}#>'{retrieval,succeeded}') IS NOT DISTINCT FROM to_jsonb(${table.acquisitionSucceeded})
        AND (${table.candidate}#>>'{retrieval,rawHash}') IS NOT DISTINCT FROM ${table.rawHash}
        AND (${table.candidate}#>>'{normalization,normalizedHash}') IS NOT DISTINCT FROM ${table.normalizedHash}
        AND (${table.candidate}->'identities') IS NOT DISTINCT FROM ${table.identity}
      `,
    ),
    check(
      "civic_data_candidates_disposition_receipt_coherent",
      sql`(
        ${table.state} IN ('FETCHED', 'NORMALIZED')
        AND ${table.validationReceipt} IS NULL
        AND ${table.failureCode} IS NULL
        AND ${table.failureDetail} IS NULL
      ) OR (
        ${table.state} IN ('VALIDATED', 'PROMOTED')
        AND jsonb_typeof(${table.validationReceipt}) IS NOT DISTINCT FROM 'object'
        AND (${table.validationReceipt}->'contractVersion') IS NOT DISTINCT FROM '2'::jsonb
        AND (${table.validationReceipt}->>'decision') IS NOT DISTINCT FROM 'GOOD'
        AND (${table.validationReceipt}->>'candidateId') IS NOT DISTINCT FROM ${table.id}
        AND (${table.validationReceipt}->>'sourceId') IS NOT DISTINCT FROM ${table.sourceId}
        AND (${table.validationReceipt}->>'recordClass') IS NOT DISTINCT FROM ${table.recordClass}
        AND (${table.validationReceipt}->>'scope') IS NOT DISTINCT FROM ${table.scope}
        AND (((${table.validationReceipt}->>'validatedAt')::timestamptz >= ${table.retrievedAt}) IS TRUE)
        AND ${table.failureCode} IS NULL
        AND ${table.failureDetail} IS NULL
      ) OR (
        ${table.state} IN ('SOURCE_BLOCKED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL')
        AND jsonb_typeof(${table.validationReceipt}) IS NOT DISTINCT FROM 'object'
        AND (${table.validationReceipt}->'contractVersion') IS NOT DISTINCT FROM '2'::jsonb
        AND ((${table.validationReceipt}->>'decision') IN ('FAIL', 'CANNOT_TELL')) IS TRUE
        AND (${table.validationReceipt}->>'candidateId') IS NOT DISTINCT FROM ${table.id}
        AND (${table.validationReceipt}->>'sourceId') IS NOT DISTINCT FROM ${table.sourceId}
        AND (${table.validationReceipt}->>'recordClass') IS NOT DISTINCT FROM ${table.recordClass}
        AND (${table.validationReceipt}->>'scope') IS NOT DISTINCT FROM ${table.scope}
        AND ((length(btrim(${table.failureCode})) > 0) IS TRUE)
        AND ((length(btrim(${table.failureDetail})) > 0) IS TRUE)
        AND jsonb_typeof(jsonb_path_query_first(${table.validationReceipt}, '$.checks[*] ? (@.verdict != "PASS")')) IS NOT DISTINCT FROM 'object'
        AND (jsonb_path_query_first(${table.validationReceipt}, '$.checks[*] ? (@.verdict != "PASS")')->>'code') IS NOT DISTINCT FROM ${table.failureCode}
        AND (jsonb_path_query_first(${table.validationReceipt}, '$.checks[*] ? (@.verdict != "PASS")')->>'detail') IS NOT DISTINCT FROM ${table.failureDetail}
      )`,
    ),
    foreignKey({
      name: "civic_data_candidates_lkg_candidate_fk",
      columns: [table.lastKnownGoodVersionId, table.sourceId, table.recordClass, table.scope],
      foreignColumns: [table.id, table.sourceId, table.recordClass, table.scope],
    }).onDelete("restrict").onUpdate("restrict"),
  ],
);

/** Append-only proof of every candidate state transition. */
export const civicDataCandidateEvents = pgTable(
  "civic_data_candidate_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => civicDataCandidates.id, { onDelete: "restrict", onUpdate: "restrict" }),
    sequence: integer("sequence").notNull(),
    state: text("state").notNull(),
    at: timestamp("at", { withTimezone: true, mode: "string" }).notNull(),
    detail: text("detail").notNull(),
  },
  (table) => [
    uniqueIndex("civic_data_candidate_events_sequence_idx").on(table.candidateId, table.sequence),
    check("civic_data_candidate_events_positive_sequence", sql`${table.sequence} > 0`),
    check(
      "civic_data_candidate_events_state_known",
      sql`${table.state} IN ('FETCHED', 'SOURCE_BLOCKED', 'NORMALIZED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL', 'VALIDATED', 'PROMOTED')`,
    ),
    check("civic_data_candidate_events_detail_nonempty", sql`length(btrim(${table.detail})) > 0`),
  ],
);

/**
 * One bounded Reader projection per record-class/scope. Promotion replaces
 * this row atomically; candidates and raw validation evidence are never read
 * by Reader requests.
 */
export const civicDataPromotions = pgTable(
  "civic_data_promotions",
  {
    key: text("key").primaryKey(),
    sourceId: text("source_id").notNull(),
    recordClass: text("record_class").notNull(),
    scope: text("scope").notNull(),
    currentVersionId: text("current_version_id").notNull(),
    lastKnownGoodVersionId: text("last_known_good_version_id").notNull(),
    promotedAt: timestamp("promoted_at", { withTimezone: true, mode: "string" }).notNull(),
    payload: jsonb("payload").notNull(),
    validationReceipt: jsonb("validation_receipt").notNull(),
  },
  (table) => [
    uniqueIndex("civic_data_promotions_record_scope_idx").on(table.recordClass, table.scope),
    check(
      "civic_data_promotions_key_coherent",
      sql`${table.key} = ${table.recordClass} || ':' || ${table.scope}`,
    ),
    check(
      "civic_data_promotions_lkg_is_current",
      sql`${table.currentVersionId} = ${table.lastKnownGoodVersionId}`,
    ),
    check(
      "civic_data_promotions_receipt_identity_coherent",
      sql`
        jsonb_typeof(${table.validationReceipt}) IS NOT DISTINCT FROM 'object'
        AND (${table.validationReceipt}->>'decision') IS NOT DISTINCT FROM 'GOOD'
        AND (${table.validationReceipt}->>'candidateId') IS NOT DISTINCT FROM ${table.currentVersionId}
        AND (${table.validationReceipt}->>'sourceId') IS NOT DISTINCT FROM ${table.sourceId}
        AND (${table.validationReceipt}->>'recordClass') IS NOT DISTINCT FROM ${table.recordClass}
        AND (${table.validationReceipt}->>'scope') IS NOT DISTINCT FROM ${table.scope}
        AND (${table.validationReceipt}->'contractVersion') IS NOT DISTINCT FROM '2'::jsonb
        AND ((((${table.validationReceipt}->>'validatedAt')::timestamptz <= ${table.promotedAt})) IS TRUE)
      `,
    ),
    foreignKey({
      name: "civic_data_promotions_current_candidate_fk",
      columns: [table.currentVersionId, table.sourceId, table.recordClass, table.scope],
      foreignColumns: [
        civicDataCandidates.id,
        civicDataCandidates.sourceId,
        civicDataCandidates.recordClass,
        civicDataCandidates.scope,
      ],
    }).onDelete("restrict").onUpdate("restrict"),
    foreignKey({
      name: "civic_data_promotions_lkg_candidate_fk",
      columns: [table.lastKnownGoodVersionId, table.sourceId, table.recordClass, table.scope],
      foreignColumns: [
        civicDataCandidates.id,
        civicDataCandidates.sourceId,
        civicDataCandidates.recordClass,
        civicDataCandidates.scope,
      ],
    }).onDelete("restrict").onUpdate("restrict"),
  ],
);
