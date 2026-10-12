import { getDb } from "./index.ts";
import { writeAlarm } from "./schema.ts";
import { assertWriteAllowed } from "./write-guard.ts";

/**
 * Records a failed store write in a table this repo can read, beside the
 * reader-facing catch, which stays unchanged. If the database itself is
 * unreachable the alarm write fails too. It never throws: the caller's own
 * write already failed and the reader is owed their page.
 */

export type SoldStore =
  | "search_log"
  | "reactions"
  | "speak_your_mind"
  | "ask_interactions"
  /* Not sold; here so its failed writes are visible. */
  | "demand_signals";

/** The database's own words are useful; a parameter echo is not. Capped. */
const MESSAGE_CAP = 400;

interface PgLikeError {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
}

/** How far down the error chain to look; a cyclic chain must not hang the alarm. */
const CAUSE_DEPTH = 5;

/**
 * Drivers nest the underlying error under different names (`cause`,
 * `sourceError`, `originalError`, `error`, and `errors` on an AggregateError).
 * Walked breadth-first and depth-capped.
 */
const LINK_NAMES = ["cause", "sourceError", "originalError", "error"] as const;

function chainOf(error: unknown): PgLikeError[] {
  const out: PgLikeError[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];
  while (queue.length > 0 && out.length < CAUSE_DEPTH) {
    const node = queue.shift();
    if (node === null || node === undefined) continue;
    if (seen.has(node)) continue;
    seen.add(node);
    out.push(node as PgLikeError);
    const record = node as Record<string, unknown>;
    for (const name of LINK_NAMES) {
      if (record[name] !== undefined && record[name] !== null) queue.push(record[name]);
    }
    // An AggregateError carries its real failures in `errors`.
    const aggregated = record.errors;
    if (Array.isArray(aggregated)) for (const one of aggregated.slice(0, CAUSE_DEPTH)) queue.push(one);
  }
  return out;
}

/** SQLSTATE where the driver supplies one — five alphanumerics, or null. */
export function errorCodeOf(error: unknown): string | null {
  for (const link of chainOf(error)) {
    const code = link?.code;
    if (typeof code === "string" && /^[0-9A-Za-z]{5}$/.test(code)) return code;
  }
  return null;
}

/**
 * The database's own words about why, never the values it was given. The
 * driver appends `params:` and the values to its message, so everything from
 * there is cut, and division ids and five-digit runs are scrubbed from what
 * is left.
 */
function oneMessage(link: PgLikeError): string | null {
  const raw =
    link instanceof Error
      ? link.message
      : typeof link?.message === "string"
        ? String(link.message)
        : null;
  if (raw === null) return null;

  // 1. Everything from `params:` onward is VALUES. It goes, whole.
  const at = raw.indexOf("params:");
  const withoutParams = at >= 0 ? raw.slice(0, at) : raw;
  // 2. Strip division ids and bare five-digit runs from every link.
  const scrubbed = withoutParams
    .replace(/ocd-division\/[^\s"',)\]]+/g, "[division]")
    .replace(/(?<![\d-])\d{5}(?![\d-])/g, "[digits]");

  const flat = scrubbed.replace(/\s+/g, " ").trim();
  return flat === "" ? null : flat;
}

export function errorMessageOf(error: unknown): string | null {
  const parts: string[] = [];
  for (const link of chainOf(error)) {
    const message = oneMessage(link);
    // A wrapper that merely restates its cause adds nothing but length.
    if (message !== null && !parts.includes(message)) parts.push(message);
  }
  if (parts.length === 0) return null;

  // The deepest cause reads first; `←` points at what wrapped what.
  const flat = parts.reverse().join(" ← ");
  return flat.length <= MESSAGE_CAP ? flat : `${flat.slice(0, MESSAGE_CAP)}… [truncated]`;
}

export async function raiseWriteAlarm(store: SoldStore, error: unknown, signal?: AbortSignal): Promise<boolean> {
  try {
    // The alarm is a write and passes the guard like any other; a refusal is caught below.
    assertWriteAllowed("a write alarm");
    signal?.throwIfAborted();
    const db = getDb();
    const write = db.insert(writeAlarm).values({
      raisedAt: new Date().toISOString(),
      store,
      errorCode: errorCodeOf(error),
      errorMessage: errorMessageOf(error),
    });
    if (signal) {
      const query = write.toSQL();
      await db.$client.query(query.sql, query.params, { fetchOptions: { signal } });
    } else await write;
    return true;
  } catch (alarmError) {
    // The operational log remains usable even when both writes fail. Never
    // log raw driver errors: they can contain the failed insert's values.
    console.error(
      "reader store write failed; write alarm unavailable",
      { store, errorCode: errorCodeOf(error), errorMessage: errorMessageOf(error),
        alarmErrorCode: errorCodeOf(alarmError), alarmErrorMessage: errorMessageOf(alarmError) },
    );
    return false;
  }
}
