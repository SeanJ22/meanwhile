import { scrubFreeText } from "../log/scrub.ts";
import { askKeyHash } from "./ask-signal.ts";
import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

import { getDb } from "./index.ts";
import { ORGANIC, type RunMarker } from "./run-marker.ts";
import { searchLog } from "./schema.ts";
import { assertWriteAllowed } from "./write-guard.ts";
import {
  coverageTierForZip,
  encodeTierDistribution,
  tierDistributionForZip,
} from "../coverage/zip-tier.ts";

/**
 * Writes to the search log: what was asked and where, never who. The schema
 * enforces the row's shape; the `detail` values are filtered here. Without a
 * database the write is skipped and the request still succeeds.
 */

/** The dataset every division identifier in the current registry was resolved against. */
export const DIVISION_VINTAGE = "TIGER_GENZ2025";

export type SearchLogEventType =
  | "SEARCH"
  | "BODY_OPENED"
  | "MEETING_OPENED"
  | "DISTRICT_SELECTED"
  | "FILTER_APPLIED"
  | "OFFICIAL_OPENED"
  | "QUESTION_ASKED"
  | "ADDRESS_ENTERED"
  | "BALLOT_VIEWED";

export const SEARCH_LOG_EVENT_TYPES: SearchLogEventType[] = [
  "SEARCH",
  "BODY_OPENED",
  "MEETING_OPENED",
  "DISTRICT_SELECTED",
  "FILTER_APPLIED",
  "OFFICIAL_OPENED",
  "QUESTION_ASKED",
  "ADDRESS_ENTERED",
  "BALLOT_VIEWED",
];

export interface SearchLogEvent {
  eventType: SearchLogEventType;
  /** Zip as entered — orientation, never district truth. */
  approximateLocation?: string | null;
  /** Divisions the event touched. */
  ocdIds: string[];
  /** Browser-minted random key; only its Ask continuity digest is stored. */
  continuityKey?: string | null;
  /** Scalar facts only; validated against the forbidden fragments below. */
  detail?: Record<string, string | number | boolean>;
  /** Whose traffic this is, from the request's own declaration. Absent means ORGANIC. */
  marker?: RunMarker;
}

/**
 * Detail keys that would retain an address or identify a person. A rejected event
 * throws; the key is never silently stripped.
 */
const FORBIDDEN_DETAIL_FRAGMENTS = [
  "user",
  "account",
  "email",
  "device",
  "fingerprint",
  "ip",
  "session",
  "subscriber",
  "token",
  "cookie",
  "phone",
  "name",
  "address",
  "street",
  "house_number",
  "coordinate",
  "latitude",
  "longitude",
  "continuity",
];
const FORBIDDEN_DETAIL_KEYS = new Set(["lat", "lng", "lon", "housenumber", "house"]);

export function assertDetailIsAnonymous(
  detail: Record<string, string | number | boolean> | undefined,
): void {
  if (!detail) return;
  for (const key of Object.keys(detail)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_DETAIL_KEYS.has(lower)) {
      throw new Error(`search log detail key "${key}" records a private address`);
    }
    for (const fragment of FORBIDDEN_DETAIL_FRAGMENTS) {
      if (lower.includes(fragment)) {
        throw new Error(
          `search log detail key "${key}" matches forbidden fragment "${fragment}" — the log records what, never who`,
        );
      }
    }
    const value = detail[key];
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      throw new Error(`search log detail "${key}" must be a scalar`);
    }
  }
}

export function isValidEventType(value: unknown): value is SearchLogEventType {
  return (
    typeof value === "string" &&
    (SEARCH_LOG_EVENT_TYPES as string[]).includes(value)
  );
}

/**
 * Validate and prepare exactly the values handed to the database writer.
 */
export function prepareSearchLogEvent(event: SearchLogEvent): typeof searchLog.$inferInsert {
  if (!isValidEventType(event.eventType)) {
    throw new Error(`unknown search log event type: ${String(event.eventType)}`);
  }
  if (!Array.isArray(event.ocdIds) || event.ocdIds.some((v) => typeof v !== "string")) {
    throw new Error("ocdIds must be an array of strings");
  }
  assertDetailIsAnonymous(event.detail);

  const zip = event.approximateLocation?.trim() || null;
  if (zip !== null && !/^\d{5}$/.test(zip)) {
    // More than five digits could be a street address.
    throw new Error("approximateLocation must be a five-digit zip or absent");
  }

  if (event.continuityKey !== undefined && event.continuityKey !== null && typeof event.continuityKey !== "string") {
    throw new Error("continuityKey must be a string or absent");
  }

  const marker = event.marker ?? ORGANIC;

  // Ask words are retained exactly; the other event details keep their handling.
  let detail = event.detail ?? null;
  if (detail) {
    detail = Object.fromEntries(
      Object.entries(detail).map(([k, v]) => [
        k,
        typeof v === "string" && !(event.eventType === "QUESTION_ASKED" && k === "question")
          ? scrubFreeText(v)
          : v,
      ]),
    );
  }

  return {
    occurredAt: new Date().toISOString(),
    eventType: event.eventType,
    approximateLocation: zip,
    continuityHash: event.continuityKey ? askKeyHash(event.continuityKey) : null,
    ocdIds: event.ocdIds,
    divisionVintage: DIVISION_VINTAGE,
    detail,
    // `runId` is null on every organic row, so it never relates two readers' rows.
    runClass: marker.runClass,
    runId: marker.runClass === "ORGANIC" ? null : marker.runId,
    // Stamped at write time. `UNKNOWN` when the zip has no stamped tier, never TIER_0.
    coverageTier: coverageTierForZip(zip),
    // UNKNOWN where the zip has no stamped distribution, never four zeros.
    coverageTierDistribution: encodeTierDistribution(tierDistributionForZip(zip)),
  };
}

/**
 * STEP-7's temporary release bridge. Postgres fills the currently installed
 * row type in one INSERT, so the same writer works before and after River's
 * contract migration. Before continuity_hash exists the digest stays in a
 * reserved detail field; the migration moves it to the column and removes
 * that field. River removes this bridge after applying the migration.
 */
export function searchLogInsertSql(row: typeof searchLog.$inferInsert): SQL {
  const payload = JSON.stringify({
    id: row.id ?? randomUUID(),
    occurred_at: row.occurredAt,
    event_type: row.eventType,
    approximate_location: row.approximateLocation ?? null,
    continuity_hash: row.continuityHash ?? null,
    ocd_ids: row.ocdIds,
    division_vintage: row.divisionVintage,
    detail: row.detail ?? null,
    run_class: row.runClass,
    run_id: row.runId ?? null,
    coverage_tier: row.coverageTier,
    coverage_tier_distribution: row.coverageTierDistribution,
  });
  return sql`INSERT INTO "search_log"
    SELECT (jsonb_populate_record(NULL::"search_log", incoming.payload || jsonb_build_object('detail',
      CASE WHEN EXISTS (SELECT 1 FROM pg_attribute
        WHERE attrelid = 'search_log'::regclass AND attname = 'continuity_hash' AND NOT attisdropped)
        OR incoming.payload->>'continuity_hash' IS NULL
      THEN incoming.payload->'detail'
      ELSE coalesce(nullif(incoming.payload->'detail', 'null'::jsonb), '{}'::jsonb)
        || jsonb_build_object('__step7_continuity_hash', incoming.payload->>'continuity_hash')
      END))).*
    FROM (SELECT ${payload}::jsonb AS payload) incoming`;
}

/** Write one validated event; absent database returns false, database refusals throw. */
export async function logSearchEvent(event: SearchLogEvent): Promise<boolean> {
  const row = prepareSearchLogEvent(event);
  if (!process.env.DATABASE_URL) return false;
  assertWriteAllowed("a search log event");
  await getDb().execute(searchLogInsertSql(row));
  return true;
}
