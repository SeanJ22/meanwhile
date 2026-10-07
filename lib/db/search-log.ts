import { scrubFreeText } from "../log/scrub.ts";

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
  | "QUESTION_ASKED";

export const SEARCH_LOG_EVENT_TYPES: SearchLogEventType[] = [
  "SEARCH",
  "BODY_OPENED",
  "MEETING_OPENED",
  "DISTRICT_SELECTED",
  "FILTER_APPLIED",
  "OFFICIAL_OPENED",
  // Routed asks log the topic id only; a refusal logs the capped question text.
  "QUESTION_ASKED",
];

export interface SearchLogEvent {
  eventType: SearchLogEventType;
  /** Zip as entered — orientation, never district truth. */
  approximateLocation?: string | null;
  /** Divisions the event touched. */
  ocdIds: string[];
  /** Scalar facts only; validated against the forbidden fragments below. */
  detail?: Record<string, string | number | boolean>;
  /** Whose traffic this is, from the request's own declaration. Absent means ORGANIC. */
  marker?: RunMarker;
}

/**
 * Detail keys that would turn an event row into a person. A rejected event
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
 * Validate and write one event. Throws on a malformed event; returns false
 * when there is no database.
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
    // More than five digits could be a street address.
    throw new Error("approximateLocation must be a five-digit zip or absent");
  }

  const marker = event.marker ?? ORGANIC;

  if (!process.env.DATABASE_URL) return false;

  // After the DATABASE_URL check: no database returns false, the wrong database throws.
  assertWriteAllowed("a search log event");

  // String detail values are scrubbed of phone-, email- and address-shaped tokens before storage.
  let detail = event.detail ?? null;
  if (detail) {
    detail = Object.fromEntries(
      Object.entries(detail).map(([k, v]) => [
        k,
        typeof v === "string" ? scrubFreeText(v) : v,
      ]),
    );
  }

  await getDb()
    .insert(searchLog)
    .values({
      occurredAt: new Date().toISOString(),
      eventType: event.eventType,
      approximateLocation: zip,
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
    });
  return true;
}
