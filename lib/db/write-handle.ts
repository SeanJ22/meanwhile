/**
 * THE ONE SANCTIONED WRITE PATH TO PRODUCTION (g11, 2026-08-17; the author's
 * ruling A of the same day).
 *
 * ## What this is for
 *
 * Two jobs genuinely need to write to the production database from a
 * developer's machine: applying a migration, and an explicit maintenance pass
 * such as `pnpm searchlog:backmark`. Nothing else does — the application
 * writes through its own runtime, and every audit and census reads.
 *
 * Those two jobs used to reach for whatever connection string was nearest.
 * `searchlog:backmark --target=production` reached for
 * `WTP_PRODUCTION_DATABASE_URL_READONLY`, because until 2026-08-17 that
 * variable connected as `neondb_owner` and could write anything. The name
 * promised a protection that did not exist (R36), and the script's use of it
 * was the proof: a variable called READONLY was the repo's actual write path
 * to production.
 *
 * R36 is now closed — that role really is read-only, and the database refuses
 * its DELETE. So a script pointed at it would now fail at the database rather
 * than quietly succeed. That is a good failure, and it is not the protection
 * this module exists to give. The protection is that a write path must be
 * ASKED FOR BY ITS OWN NAME, so reaching production to write is a deliberate
 * act with a variable behind it that says "write" out loud.
 *
 * ## The two refusals, and why both are needed
 *
 * 1. **By variable name.** `WTP_PRODUCTION_DATABASE_URL_READONLY` is refused
 *    as a source, whatever it happens to contain. A variable whose name says
 *    read is never a write handle, even on the day someone puts an owner
 *    string in it — which is exactly what it held for the whole of the repo's
 *    life until yesterday.
 *
 * 2. **By connection user.** Any string whose user is `readonly` (or begins
 *    `readonly_`) is refused, whatever variable it arrived in. This catches
 *    the mirror of the same mistake: the right variable holding the wrong
 *    string. It fails loudly at the script instead of ten statements into a
 *    migration, where a permission error leaves the schema half-applied.
 *
 * Both are proven by planting in `tests/write-handle.test.ts` — a guard whose
 * refusal has never been demonstrated is a comment.
 */

/** The variable that holds the production owner string. The only source. */
export const WRITE_VARIABLE = "WTP_PRODUCTION_DATABASE_URL_WRITE";

/** The variable a write path may never read, by name, whatever it contains. */
export const REFUSED_VARIABLE = "WTP_PRODUCTION_DATABASE_URL_READONLY";

export class WriteHandleRefused extends Error {}

/** True when this connection string authenticates as a read-only role. */
export function isReadonlyUser(connection: string): boolean {
  let user: string;
  try {
    user = decodeURIComponent(new URL(connection).username);
  } catch {
    return false;
  }
  return user === "readonly" || user.startsWith("readonly_");
}

export interface WriteHandle {
  connection: string;
  variable: string;
  role: string;
  host: string;
  database: string;
}

/**
 * Resolve the sanctioned production write handle, or refuse with a reason a
 * reader can act on.
 *
 * `env` is injected so the refusals can be planted in a test without a test
 * mutating the process it runs in.
 */
export function resolveProductionWriteHandle(
  env: Record<string, string | undefined> = process.env,
  requestedVariable: string = WRITE_VARIABLE,
): WriteHandle {
  if (requestedVariable === REFUSED_VARIABLE) {
    throw new WriteHandleRefused(
      `${REFUSED_VARIABLE} is not a write path. Its name says read, and a write path ` +
        `must be asked for by its own name: ${WRITE_VARIABLE}.`,
    );
  }
  if (requestedVariable !== WRITE_VARIABLE) {
    throw new WriteHandleRefused(
      `${requestedVariable} is not the sanctioned production write variable. ` +
        `The only one is ${WRITE_VARIABLE}.`,
    );
  }

  const connection = env[WRITE_VARIABLE];
  if (!connection) {
    throw new WriteHandleRefused(
      `${WRITE_VARIABLE} is not set. This is the one sanctioned write path to production; ` +
        `nothing here falls back to another variable.`,
    );
  }

  if (isReadonlyUser(connection)) {
    throw new WriteHandleRefused(
      `${WRITE_VARIABLE} holds a connection whose user is read-only. A write pass would ` +
        `fail partway through rather than at the start. Refusing before anything runs.`,
    );
  }

  const u = new URL(connection);
  return {
    connection,
    variable: WRITE_VARIABLE,
    role: decodeURIComponent(u.username),
    host: u.hostname,
    database: u.pathname.replace(/^\//, ""),
  };
}
