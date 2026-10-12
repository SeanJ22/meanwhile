/**
 * The one sanctioned write path to production, asked for by its own name.
 * Two refusals:
 * 1. By variable name: `WTP_PRODUCTION_DATABASE_URL_READONLY` is never a
 *    write source, whatever it contains.
 * 2. By connection user: a `readonly` / `readonly_*` user is refused before
 *    anything runs, so a migration never fails half-applied.
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
 * reader can act on. `env` is injected for tests.
 */
export function resolveProductionWriteHandle(
  env: Record<string, string | undefined> = process.env,
  requestedVariable: string = WRITE_VARIABLE,
): WriteHandle {
  if (env.WTP_RUNTIME_MODE === "staging" && requestedVariable === WRITE_VARIABLE) {
    if (env.WTP_DB_ROLE !== "local" || !env.DATABASE_URL) throw new WriteHandleRefused("staging requires WTP_DB_ROLE=local and DATABASE_URL");
    const u = new URL(env.DATABASE_URL);
    if (isReadonlyUser(env.DATABASE_URL)) throw new WriteHandleRefused("staging DATABASE_URL is read-only");
    return { connection: env.DATABASE_URL, variable: "DATABASE_URL", role: decodeURIComponent(u.username), host: u.hostname, database: u.pathname.replace(/^\//, "") };
  }
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
