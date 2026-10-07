import { assertSanctionedRuntimeAuthority } from "../civic-data/runtime-authority.ts";

/**
 * Nothing but production writes to production. Guards writes, not reads.
 *
 * `WTP_DB_ROLE` declares what `DATABASE_URL` points at; anything other than an
 * exact "local" is read as production, so an undeclared environment is refused.
 * `NODE_ENV === "production"` (set by Next itself) marks the production
 * runtime. `NODE_ENV` cannot tell a local `next start` from the deployment, so
 * a local production build pointed at production is not stopped here.
 */

export type DbRole = "production" | "local";

/**
 * Named sanctions: a non-production writer may write only when all three hold.
 * 1. `WTP_SANCTIONED_WRITE` names a sanction in this table.
 * 2. The operation is exactly that sanction's operation.
 * 3. `DATABASE_URL` is `WTP_PRODUCTION_DATABASE_URL_WRITE`, the one sanctioned
 *    write path (`lib/db/write-handle.ts`).
 */
export const SANCTIONED_WRITES: Record<string, string> = {
  /** Standing runner's intake observation, via `purgeExpiredLimiterState`. */
  "intake-limiter-purge": "an intake limiter purge",
  /** Standing data-plane runner; changes civic data versions, never code. */
  "routine-civic-data-promotion": "a routine civic data candidate/version promotion",
};

/** The variable a sanctioned writer must connect through. */
export const SANCTIONED_WRITE_VARIABLE = "WTP_PRODUCTION_DATABASE_URL_WRITE";

/** The variable a sanctioned writer declares its purpose in. */
export const SANCTION_VARIABLE = "WTP_SANCTIONED_WRITE";

/** What a write is about to do, decided from the environment alone. */
export interface WriteContext {
  /** What `DATABASE_URL` is declared to point at. Undeclared means production. */
  dbRole: DbRole;
  /** Whether this process is a production Next runtime. */
  isProductionRuntime: boolean;
  /** Whether a write may proceed. */
  allowed: boolean;
  /** Why, in words, for the error and for the report. */
  reason: string;
  /** The named sanction this write proceeded under, when it did. */
  sanction?: string | null;
}

/**
 * Thrown when a non-production runtime tries to write to the production
 * database; its own class so a refusal is distinguishable from an outage.
 */
export class ProductionWriteRefused extends Error {
  readonly context: WriteContext;
  constructor(operation: string, context: WriteContext) {
    super(
      `refusing to write ${operation} to the production database from a non-production runtime. ` +
        `${context.reason} ` +
        `Point DATABASE_URL at a local database and set WTP_DB_ROLE=local in .env.local. ` +
        `If this is a scheduled job that legitimately must write, it needs a NAMED SANCTION: ` +
        `set ${SANCTION_VARIABLE} to a purpose listed in SANCTIONED_WRITES and connect through ` +
        `${SANCTIONED_WRITE_VARIABLE}, the one sanctioned write path. ` +
        `See lib/db/write-guard.ts.`,
    );
    this.name = "ProductionWriteRefused";
    this.context = context;
  }
}

type Env = Record<string, string | undefined>;

/** Read the signals and decide. Pure; the environment is a parameter. */
export function describeWriteContext(
  env: Env = process.env as Env,
  operation?: string,
): WriteContext {
  // Anything that is not an exact "local" is treated as production.
  const dbRole: DbRole = env.WTP_DB_ROLE === "local" ? "local" : "production";
  const isProductionRuntime = env.NODE_ENV === "production";

  if (dbRole === "local") {
    return {
      dbRole,
      isProductionRuntime,
      allowed: true,
      reason: "DATABASE_URL is declared local (WTP_DB_ROLE=local), so writes cannot reach the sold store.",
    };
  }
  if (isProductionRuntime) {
    return {
      dbRole,
      isProductionRuntime,
      allowed: true,
      sanction: null,
      reason: "the production runtime writing to the production database, which is the one allowed pairing.",
    };
  }

  // A named sanction needs all three conditions; a partial match names what is missing.
  let refusalDetail: WriteContext | null = null;
  const declared = env[SANCTION_VARIABLE];
  if (declared) {
    const permits = SANCTIONED_WRITES[declared];
    const handle = env[SANCTIONED_WRITE_VARIABLE];
    const refuse = (why: string): WriteContext => ({
      dbRole,
      isProductionRuntime,
      allowed: false,
      sanction: null,
      reason: `${SANCTION_VARIABLE} is ${JSON.stringify(declared)}, but ${why}`,
    });

    if (!permits) {
      refusalDetail = refuse(
        `no such sanction exists. The named sanctions are: ${Object.keys(SANCTIONED_WRITES).join(", ") || "(none)"}.`,
      );
    } else if (operation !== permits) {
      refusalDetail = refuse(
        `that sanction permits ${JSON.stringify(permits)} and this write is ` +
          `${JSON.stringify(operation ?? null)}. A sanction opens one operation, never a script.`,
      );
    } else if (!handle) {
      refusalDetail = refuse(
        `${SANCTIONED_WRITE_VARIABLE} is not set. A sanctioned writer connects through the one ` +
          `sanctioned write path, asked for by its own name.`,
      );
    } else if (handle !== env.DATABASE_URL) {
      refusalDetail = refuse(
        `DATABASE_URL is not ${SANCTIONED_WRITE_VARIABLE}. The sanction names a purpose; it does ` +
          `not name a destination, so the connection this process will actually use has to BE ` +
          `the sanctioned write path.`,
      );
    } else {
      return {
        dbRole,
        isProductionRuntime,
        allowed: true,
        sanction: declared,
        reason:
          `the sanctioned write ${JSON.stringify(declared)} performing ${JSON.stringify(permits)} ` +
          `through ${SANCTIONED_WRITE_VARIABLE}.`,
      };
    }
  }

  return (
    refusalDetail ?? {
      dbRole,
      isProductionRuntime,
      allowed: false,
      sanction: null,
      reason:
        `NODE_ENV is ${JSON.stringify(env.NODE_ENV ?? null)} (not "production") while WTP_DB_ROLE is ` +
        `${JSON.stringify(env.WTP_DB_ROLE ?? null)}, which this guard reads as the production database.`,
    }
  );
}

/**
 * The call every write path makes first. Throws rather than returning false,
 * so a refusal never reads like "there was no database".
 */
export function assertWriteAllowed(operation: string, env: Env = process.env as Env): void {
  // A sanction opens exactly one operation, so the decision needs the operation.
  const context = describeWriteContext(env, operation);
  if (!context.allowed) throw new ProductionWriteRefused(operation, context);
  // A sanction must also hold runtime authority; checked whatever NODE_ENV says.
  if (env[SANCTION_VARIABLE]) assertSanctionedRuntimeAuthority(operation, env);
}
