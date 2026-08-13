import { getDb } from "./index.ts";
import { searchLog } from "./schema.ts";

/**
 * Writes to the search log — what was asked and where, never who.
 *
 * The two-store constraint (CLAUDE.md) applies from the first row, which is
 * this one: no account key, no device ID, no fingerprint, no retained IP, no
 * session key. The row's shape is enforced by the schema
 * (tests/db-schema.test.ts) and the *values* are filtered here — a caller
 * cannot smuggle an identifier through the `detail` bag.
 *
 * Logging is fire-and-forget and must never break the reader's request:
 * a demo without a database still serves the map, it just doesn't log.
 */

/**
 * The dataset every division identifier in the current registry was resolved
 * against — all 940 divisions carry TIGER_GENZ2025 (docs/state.md §9,
 * provenance distribution verified). When the boundary vintage changes, this
 * constant changes with it in the same commit.
 */
export const DIVISION_VINTAGE = "TIGER_GENZ2025";

export type SearchLogEventType =
  | "SEARCH"
  | "BODY_OPENED"
  | "MEETING_OPENED"
  | "DISTRICT_SELECTED"
  | "FILTER_APPLIED";

export const SEARCH_LOG_EVENT_TYPES: SearchLogEventType[] = [
  "SEARCH",
  "BODY_OPENED",
  "MEETING_OPENED",
  "DISTRICT_SELECTED",
  "FILTER_APPLIED",
];

export interface SearchLogEvent {
  eventType: SearchLogEventType;
  /** Zip as entered — orientation, never district truth. */
  approximateLocation?: string | null;
  /** Divisions the event touched. */
  ocdIds: string[];
  /** Scalar facts only; validated against the forbidden fragments below. */
  detail?: Record<string, string | number | boolean>;
}

/**
 * Detail keys that would turn an event row into a person. Same family as the
 * schema-level guard, applied to the free-form bag the schema cannot see
 * into. A rejected event is dropped loudly (thrown to the caller's catch) —
 * never written with the key silently stripped, because a caller passing an
 * identifier is a bug to surface, not launder.
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
];

export function assertDetailIsAnonymous(
  detail: Record<string, string | number | boolean> | undefined,
): void {
  if (!detail) return;
  for (const key of Object.keys(detail)) {
    const lower = key.toLowerCase();
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
 * Validate and write one event. Throws on a malformed event (caller bug);
 * returns false when there is no database to write to (a real state for the
 * demo until DATABASE_URL is set in the deploy environment).
 */
export async function logSearchEvent(event: SearchLogEvent): Promise<boolean> {
  if (!isValidEventType(event.eventType)) {
    throw new Error(`unknown search log event type: ${String(event.eventType)}`);
  }
  if (!Array.isArray(event.ocdIds) || event.ocdIds.some((v) => typeof v !== "string")) {
    throw new Error("ocdIds must be an array of strings");
  }
  assertDetailIsAnonymous(event.detail);

  const zip = event.approximateLocation?.trim() || null;
  if (zip !== null && !/^\d{5}$/.test(zip)) {
    // Anything beyond five digits could be a street address someone typed —
    // which is more location than this table is allowed to hold.
    throw new Error("approximateLocation must be a five-digit zip or absent");
  }

  if (!process.env.DATABASE_URL) return false;

  await getDb()
    .insert(searchLog)
    .values({
      occurredAt: new Date().toISOString(),
      eventType: event.eventType,
      approximateLocation: zip,
      ocdIds: event.ocdIds,
      divisionVintage: DIVISION_VINTAGE,
      detail: event.detail ?? null,
    });
  return true;
}
