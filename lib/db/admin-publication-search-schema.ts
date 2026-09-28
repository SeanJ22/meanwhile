import { bigint, boolean, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { civicDataCandidates } from "./schema.ts";

/** Search-only projection of immutable GOOD/PROMOTED candidate members.
 * The candidate and its promotion event remain authority; this table never
 * serves Reader facts and is populated only by the promotion trigger. Legacy
 * candidates without civicRecords contribute one whole readModel document. */
export const civicDataPublicationSearch = pgTable(
  "civic_data_publication_search",
  {
    versionId: text("version_id").notNull().references(() => civicDataCandidates.id, { onDelete: "restrict", onUpdate: "restrict" }),
    recordKey: text("record_key").notNull(),
    recordClass: text("record_class").notNull(),
    scope: text("scope").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true, mode: "string" }).notNull(),
    promotedAt: timestamp("promoted_at", { withTimezone: true, mode: "string" }).notNull(),
    legacyDocument: boolean("legacy_document").notNull(),
    record: jsonb("record").notNull(),
    /** At most 300 characters, derived from a known scalar and labeled as a preview. */
    label: text("label"),
    /** Complete scalar URL only; null when absent or longer than 2,048 characters. */
    sourceUrl: text("source_url"),
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.recordKey] }),
    index("civic_data_publication_search_time_idx").on(table.promotedAt.desc(), table.versionId, table.recordKey),
    index("civic_data_publication_search_scope_idx").on(table.recordClass, table.scope),
  ],
);

/** Bounded exact-search units. Every character of the full record text is
 * represented; adjacent units overlap by 99 characters so an admitted
 * 100-character literal cannot disappear at a boundary. */
export const civicDataPublicationSearchChunks = pgTable(
  "civic_data_publication_search_chunks",
  {
    versionId: text("version_id").notNull(),
    recordKey: text("record_key").notNull(),
    chunkOrdinal: integer("chunk_ordinal").notNull(),
    searchChunk: text("search_chunk").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.recordKey, table.chunkOrdinal] }),
    foreignKey({ columns: [table.versionId, table.recordKey], foreignColumns: [civicDataPublicationSearch.versionId, civicDataPublicationSearch.recordKey] }),
  ],
);

/** Operational activation receipt. Search UI requires READY version 2;
 * backfill counts are a receipt for that migration, not live totals. */
export const civicDataPublicationSearchReadiness = pgTable("civic_data_publication_search_readiness", {
  id: text("id").primaryKey(),
  schemaVersion: integer("schema_version").notNull(),
  status: text("status").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "string" }).notNull(),
  parentCount: bigint("parent_count", { mode: "number" }).notNull(),
  chunkCount: bigint("chunk_count", { mode: "number" }).notNull(),
});
