import { scrubFreeText } from "../log/scrub.ts";

import { getDb } from "./index.ts";
import { ORGANIC, type RunMarker } from "./run-marker.ts";
import { searchLog } from "./schema.ts";
import { assertWriteAllowed } from "./write-guard.ts";

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
  | "FILTER_APPLIED"
  | "OFFICIAL_OPENED"
  | "QUESTION_ASKED";

export const SEARCH_LOG_EVENT_TYPES: SearchLogEventType[] = [
  "SEARCH",
  "BODY_OPENED",
  "MEETING_OPENED",
  "DISTRICT_SELECTED",
  "FILTER_APPLIED",
  // Approved by the author (session brief 1d, 2026-08-15) — added together
  // with its line on /transparency, per the coupling rule.
  "OFFICIAL_OPENED",
  // The ask box (session brief 5, 2026-08-19), same coupling: routed asks
  // log the topic id only; a refusal logs the question's text (capped)
  // because unanswered questions are the roadmap — disclosed on
  // /transparency in the same commit. Identifier-free like every row.
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
  /**
   * Whose traffic this is (C05). Supplied by the caller from the incoming
   * request's own declaration — see `lib/db/run-marker.ts`. Absent means
   * ORGANIC, which is the correct reading of "nobody said otherwise" for a
   * human at a browser.
   */
  marker?: RunMarker;
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

  const marker = event.marker ?? ORGANIC;

  if (!process.env.DATABASE_URL) return false;

  // Ordered after the DATABASE_URL check on purpose: "there is no database" is
  // an ordinary state that returns false, while "there is a database and it is
  // the production one, and we are not production" is a misconfiguration that
  // throws. Collapsing the two would hide the second inside the first.
  assertWriteAllowed("a search log event");

  // The scrub pass (session brief 4, wall clock 2026-08-14): free text —
  // the refusal log's question field, and any string a future event
  // carries — is scrubbed of phone-number-, email-, and street-address-
  // shaped tokens BEFORE storage. The store is described as
  // identifier-free; a reader typing their own address into a question
  // must not make that description false. Mechanical, tested in
  // tests/ask-box.test.ts; disclosed on /transparency in the same commit.
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
      // C05: whose traffic this is, declared at write time. `runId` is null on
      // every organic row by construction, so it can never relate two
      // readers' rows to each other.
      runClass: marker.runClass,
      runId: marker.runClass === "ORGANIC" ? null : marker.runId,
    });
  return true;
}
