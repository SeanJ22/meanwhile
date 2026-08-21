import { getDb } from "./index.ts";
import { writeAlarm } from "./schema.ts";
import { assertWriteAllowed } from "./write-guard.ts";

/**
 * **RAISE, ON A PATH SEPARATE FROM THE READER'S** (Prompt D item 6.2,
 * 2026-08-20; D73).
 *
 * RULING 25: reader-facing behaviour is not degraded to fix an internal
 * problem. So the reader-facing catch on each sold-store write path stays
 * exactly as it is — a search still answers with its meetings, a reaction still
 * returns its status — and this runs beside it. A visitor sees no difference.
 *
 * ## What "alarm" means here, and what it does not
 *
 * It means: a row lands somewhere THIS REPO CAN READ. D73 was invisible for
 * four hours because the failure existed only as a `console.error` in a
 * serverless function log nobody here can reach, and a log nobody can reach is
 * a diary rather than an alarm. `pnpm alarms` reads this table through the
 * readonly production credential, and `pnpm walk:all` asserts it is empty at
 * the end of every session.
 *
 * It does not mean a page, an email, or a third party. Those are a decision
 * about who gets woken up, and this session is not making it.
 *
 * ## The failure mode this cannot cover, stated rather than implied
 *
 * If the DATABASE is unreachable, the alarm write fails too — so this covers a
 * store that refuses a write while the database is up, which is exactly D73's
 * shape and the one an outage does not announce. A database that is entirely
 * down is loud on its own, and the schema gate (`app/api/schema/route.ts`)
 * covers the drift that produced D73 from the other side. Neither is claimed to
 * cover the other's case.
 *
 * ## It never throws
 *
 * An alarm that can take down the path it is watching is worse than no alarm.
 * A failure to raise is swallowed here DELIBERATELY, and it is the one place in
 * this file where that is the right answer — the caller's own write already
 * failed, and the reader is owed their page either way.
 */

export type SoldStore = "search_log" | "reactions";

/** The database's own words are useful; a parameter echo is not. Capped. */
const MESSAGE_CAP = 400;

interface PgLikeError {
  code?: unknown;
  message?: unknown;
}

/** SQLSTATE where the driver supplies one — five alphanumerics, or null. */
export function errorCodeOf(error: unknown): string | null {
  const code = (error as PgLikeError | null)?.code;
  return typeof code === "string" && /^[0-9A-Za-z]{5}$/.test(code) ? code : null;
}

/** The message, truncated, with the truncation stated rather than silent. */
export function errorMessageOf(error: unknown): string | null {
  const raw =
    error instanceof Error
      ? error.message
      : typeof (error as PgLikeError | null)?.message === "string"
        ? String((error as PgLikeError).message)
        : null;
  if (raw === null) return null;
  const flat = raw.replace(/\s+/g, " ").trim();
  if (flat === "") return null;
  return flat.length <= MESSAGE_CAP ? flat : `${flat.slice(0, MESSAGE_CAP)}… [truncated]`;
}

export async function raiseWriteAlarm(store: SoldStore, error: unknown): Promise<boolean> {
  try {
    /*
     * The alarm is a WRITE, and every write in `lib/db` passes the guard —
     * `tests/write-guard.test.ts` scans this directory and would have caught
     * an exemption, which is the check working. A runtime not permitted to
     * write to production must not write an alarm row to production either;
     * the alarm's own reason for existing does not make it a second door.
     *
     * The throw is caught below like any other, so a refused runtime degrades
     * to the console line rather than taking down the path it is watching.
     */
    assertWriteAllowed("a write alarm");
    await getDb().insert(writeAlarm).values({
      raisedAt: new Date().toISOString(),
      store,
      errorCode: errorCodeOf(error),
      errorMessage: errorMessageOf(error),
    });
    return true;
  } catch (alarmError) {
    // Deliberately swallowed — see the header. The console line is the last
    // resort and is honest about being one.
    console.error(
      `write alarm could not be raised for ${store} (the original failure is above)`,
      alarmError,
    );
    return false;
  }
}
