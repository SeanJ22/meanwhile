/**
 * NOTHING BUT PRODUCTION WRITES TO PRODUCTION (2026-08-17, the author's P0).
 *
 * ## What happened
 *
 * `.env.local` carries the PRODUCTION `DATABASE_URL`. So `pnpm dev` is a
 * production client, and opening a browser at `localhost:3000` wrote an
 * unmarked ORGANIC row into `search_log` — the table the business sells from.
 * That was the third undeclared run in one day and the first from a writer
 * that is not a script, which is why nothing caught it:
 * `tests/browser-construction.test.ts` guards every live browser SCRIPT, and
 * structurally cannot see a human opening a browser.
 *
 * The author's ruling was a separate local database, so local never touches
 * production, plus this: "the production write path additionally refuses any
 * request whose environment is not production — belt and braces, because one
 * hand-edited env file must not be able to recreate this."
 *
 * This module is the braces. The belt is `.env.local` pointing somewhere else,
 * and the two are deliberately independent: the belt is one line in an
 * untracked file that any session or any hand can change, and a protection
 * that a hand-edit defeats is not a protection. Recreating the defect now
 * takes TWO simultaneous mistakes rather than one.
 *
 * ## Why this guards WRITES and not reads
 *
 * The harm is a row in a sold store, not a SELECT. Guarding reads would break
 * local development of every surface that reads officials, districts and
 * funding, and would buy nothing — a read pollutes nothing and is invisible in
 * the aggregate. So reads are untouched, deliberately, and this is stated
 * rather than left to be inferred from where the calls happen to be.
 *
 * ## The two signals, and why each is the one it is
 *
 * `WTP_DB_ROLE` declares WHAT the connection string points at, because a URL
 * cannot be asked. The production hostname is deliberately NOT hardcoded here:
 * a committed allowlist of production hosts is infrastructure detail in a repo
 * that does not need it, and it would silently fail open the day the host
 * changes — the guard would see an unrecognised host and call it local, which
 * is the wrong direction to fail.
 *
 * **Unset defaults to `production`**, and that default is the whole design.
 * Anything that has not declared itself is ASSUMED to be pointed at the sold
 * store, so a new checkout, a forgotten variable, a fresh CI box and a script
 * nobody thought about are all refused rather than trusted. This is the same
 * conservative reading `lib/db/run-marker.ts` applies to a malformed marker:
 * resolve the ambiguity in the direction that keeps rows OUT of what we sell.
 *
 * `NODE_ENV === "production"` decides whether this is the production runtime,
 * and it is chosen over `NETLIFY`, `CONTEXT` or any other platform variable
 * for one reason: Next sets it itself. `next dev` is always `development` and
 * a built Next server is always `production`, guaranteed by the framework
 * rather than by a deploy setting somebody has to remember. A platform
 * variable that turns out not to be present at function runtime would refuse
 * every production write — which is the failure `run-marker.ts` describes as
 * the one we would discover months later, and this module must not be able to
 * cause it.
 *
 * ## The residual hole, named rather than papered over
 *
 * `NODE_ENV` cannot tell the production deployment apart from a LOCAL
 * production build (`next build && next start`) — both are `production`. So
 * the braces alone do not stop a local production build pointed at the
 * production database. That case is covered by the belt instead, and it is not
 * a current workflow: `pnpm dev` is the dev path and the walks run against
 * either `localhost:3000` or the deployed URL, never a local `next start`.
 *
 * Closing it properly needs a signal only the real deployment has, which means
 * reading what Netlify actually exposes at function runtime rather than
 * assuming it — the build-stamp endpoint is the place that becomes checkable.
 * Recorded as this row's named remainder rather than claimed as done.
 */

export type DbRole = "production" | "local";

/**
 * THE NAMED SANCTIONS (g13, 2026-08-18).
 *
 * ## Why a third path exists at all
 *
 * The daily intake tripwire purges the limiter table's expired rows — a write
 * the n-stores isolation contract REQUIRES on the limiter's own 48-hour
 * schedule. It runs in GitHub Actions, where `NODE_ENV` and `WTP_DB_ROLE` are
 * both unset, so the guard read it as a non-production runtime pointed at the
 * sold store. It read correctly: that is exactly what it was. The job had
 * never been taught to say who it was, and the guard refused it every day
 * from 2026-08-18.
 *
 * The wrong fix is to widen the guard — teach it that CI is fine, or that a
 * purge is harmless, or that an unset `NODE_ENV` deserves the benefit of the
 * doubt. Each of those reopens the P0 for every writer, to fix one. So the
 * guard is not loosened. Instead a writer may hold a SANCTION: a purpose named
 * out loud, scoped to one operation, that opens nothing else.
 *
 * ## The three conditions, all required
 *
 * 1. `WTP_SANCTIONED_WRITE` names a sanction in this table.
 * 2. The operation being attempted is that sanction's operation, exactly. So
 *    a declaration set for the purge cannot open a reaction write, and a
 *    script that is not the sanctioned one is refused while carrying it.
 * 3. The process's `DATABASE_URL` IS `WTP_PRODUCTION_DATABASE_URL_WRITE` —
 *    the one sanctioned write path (`lib/db/write-handle.ts`), asked for by
 *    its own name. A sanction that opened a write to whatever string happened
 *    to be nearest would be a declaration standing in for a destination.
 *
 * Every one of those is proven by planting in `tests/write-guard.test.ts`.
 * A guard whose refusal has never been demonstrated is a comment.
 */
export const SANCTIONED_WRITES: Record<string, string> = {
  /** `scripts/intake-tripwire.mts`, via `purgeExpiredLimiterState`. */
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
  /** The named sanction this write proceeded under, when it did (g13). */
  sanction?: string | null;
}

/**
 * Thrown when a non-production runtime tries to write to the production
 * database. Its own class so a caller can tell a refusal apart from a database
 * being down — one is a misconfiguration to fix, the other is an outage.
 */
export class ProductionWriteRefused extends Error {
  readonly context: WriteContext;
  constructor(operation: string, context: WriteContext) {
    super(
      `refusing to write ${operation} to the production database from a non-production runtime. ` +
        `${context.reason} ` +
        `Point DATABASE_URL at a local database and set WTP_DB_ROLE=local in .env.local. ` +
        // g13: the third door, named where the refusal is read. A scheduled job
        // that legitimately must write used to be told only about .env.local,
        // which is advice a CI runner cannot take — so the message described a
        // fix that did not apply to the reader most likely to hit it.
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

/**
 * Read the two signals and decide. Pure — the environment is a parameter so
 * the test suite can exercise every combination without mutating the process.
 */
export function describeWriteContext(
  env: Env = process.env as Env,
  operation?: string,
): WriteContext {
  // Anything that is not an explicit "local" is treated as production. A typo
  // ("locl", "Local ") therefore fails SAFE rather than opening the gate.
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

  // The named sanction (g13). All three conditions or none — a partial match
  // is refused with the missing condition named, because "refused" without a
  // reason is how a scheduled job stays broken for a week.
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
 * The call every write path makes first. Throws rather than returning false:
 * a refused write is a misconfiguration to surface, and a silent false is the
 * empty success CLAUDE.md forbids — it would read exactly like "there was no
 * database", which is a different and much less alarming fact.
 */
export function assertWriteAllowed(operation: string, env: Env = process.env as Env): void {
  // The operation travels INTO the decision (g13), not just into the message:
  // a named sanction opens exactly one operation, so the guard has to know
  // which one is being attempted before it can honour anything.
  const context = describeWriteContext(env, operation);
  if (!context.allowed) throw new ProductionWriteRefused(operation, context);
}
