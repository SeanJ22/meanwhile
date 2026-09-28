import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
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
    searchText: text("search_text").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.recordKey] }),
    index("civic_data_publication_search_time_idx").on(table.promotedAt.desc(), table.versionId, table.recordKey),
    index("civic_data_publication_search_scope_idx").on(table.recordClass, table.scope),
  ],
);
