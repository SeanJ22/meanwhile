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
 * `tests/run-marker-coverage.test.ts` guards every live browser SCRIPT, and
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
export function describeWriteContext(env: Env = process.env as Env): WriteContext {
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
      reason: "the production runtime writing to the production database, which is the one allowed pairing.",
    };
  }
  return {
    dbRole,
    isProductionRuntime,
    allowed: false,
    reason:
      `NODE_ENV is ${JSON.stringify(env.NODE_ENV ?? null)} (not "production") while WTP_DB_ROLE is ` +
      `${JSON.stringify(env.WTP_DB_ROLE ?? null)}, which this guard reads as the production database.`,
  };
}

/**
 * The call every write path makes first. Throws rather than returning false:
 * a refused write is a misconfiguration to surface, and a silent false is the
 * empty success CLAUDE.md forbids — it would read exactly like "there was no
 * database", which is a different and much less alarming fact.
 */
export function assertWriteAllowed(operation: string, env: Env = process.env as Env): void {
  const context = describeWriteContext(env);
  if (!context.allowed) throw new ProductionWriteRefused(operation, context);
}
