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
  cause?: unknown;
}

/**
 * **THE ERROR CHAIN, NOT ITS TOP** (Prompt E item 4, 2026-08-20; `PD04`).
 *
 * `errorCodeOf` and `errorMessageOf` both used to read the object they were
 * handed and stop. Drizzle never hands them that object. Every query failure
 * arrives as a `DrizzleQueryError`, and its own source (`drizzle-orm/errors.js`
 * — read, not assumed) is four lines long:
 *
 *     super(`Failed query: ${query}\nparams: ${params}`);
 *     this.query = query; this.params = params; this.cause = cause;
 *
 * It carries no `code` and its message is the SQL. So the alarm recorded a
 * SQLSTATE of `null` for **every** failure structurally — not because the
 * driver withheld one — and it recorded the statement instead of the reason.
 * `PD04`'s single row read "Failed query: insert into search_log (…)" with no
 * code, which is the instrument describing itself rather than the database.
 *
 * The driver's own sentence — `terminating connection…`, `column "x" does not
 * exist`, `duplicate key value violates…` — and its SQLSTATE both live one or
 * more links down `.cause`. So both functions walk the chain.
 *
 * Depth is capped because a cyclic `cause` is a hang, and a hang inside an
 * alarm takes down the path the alarm is watching.
 */
const CAUSE_DEPTH = 5;

function chainOf(error: unknown): PgLikeError[] {
  const out: PgLikeError[] = [];
  const seen = new Set<unknown>();
  let node: unknown = error;
  while (node !== null && node !== undefined && out.length < CAUSE_DEPTH) {
    if (seen.has(node)) break;
    seen.add(node);
    out.push(node as PgLikeError);
    node = (node as PgLikeError).cause;
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
 * The database's own words about WHY — and never the values it was given.
 *
 * **THE ALARM'S FIRST REAL FIRING CAUGHT THIS** (2026-08-20, the Prompt D
 * close-out walk). One `search_log` insert failed transiently out of 94, the
 * alarm worked exactly as designed, and the row it wrote read:
 *
 *     Failed query: insert into "search_log" (…) values (…) params:
 *     2026-08-21T00:20:53.025Z,SEARCH,03255,["ocd-division/country:us/state:nh/…
 *
 * The Neon driver wraps a failure as the QUERY plus its PARAMS, so the message
 * carried a reader's zip and the divisions their search resolved to — into the
 * one table whose entire design is that it holds nothing about who was writing.
 * The column guard cannot see that: the value was smuggled inside a text field
 * the guard permits. `tests/db-schema.test.ts` asserts the SHAPE; this asserts
 * the CONTENT, because a rule enforced only at the column level is a rule a
 * string can walk past.
 *
 * So the message is cut at `params:` before anything else, and what survives is
 * scrubbed of division- and zip-shaped tokens as a second line. The part worth
 * keeping is untouched by either: `column "coverage_tier" does not exist` — the
 * sentence that would have closed D73 in a minute — names a column and no
 * value.
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

  // 2. Belt and braces, because a driver this repo has not met yet may format
  // its values differently: strip division ids and bare five-digit runs. Both
  // are things the alarm may never hold, and neither belongs to a genuine
  // reason-for-failure sentence. It applies to EVERY link in the chain —
  // a Postgres detail line quotes the offending key, so the cause is no
  // safer than the wrapper and is scrubbed on exactly the same terms.
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

  /*
   * The cause reads FIRST. The reason a human wants — `column "coverage_tier"
   * does not exist` — is the deepest link, and the shallowest is a page of SQL
   * that pushes it past the cap. `←` points at what wrapped what.
   */
  const flat = parts.reverse().join(" ← ");
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
