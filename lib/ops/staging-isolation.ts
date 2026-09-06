/**
 * **A STAGING DEPLOY MAY NEVER RESOLVE THE PRODUCTION DATABASE.**
 * (Lane 5, 2026-09-01.)
 *
 * ## The failure this module exists to make unshippable
 *
 * The staging host — `STAGING_RENDER_ORIGIN` in `lib/ops/origins.ts`, and it is
 * named there rather than spelled here — is a Netlify BRANCH DEPLOY of the same
 * site, built from the same repository, with the same code reading the same
 * variable name.
 * The only thing that makes it staging rather than a second production is what
 * `DATABASE_URL` resolves to in that build's environment — one line in a
 * platform settings panel that nobody re-reads.
 *
 * If that line is wrong, nothing visible breaks. The staging site comes up, it
 * serves real data, it looks right, and every `/api/meetings` GET taken against
 * it writes an unmarked ORGANIC row into `search_log` — **the table this
 * business sells from** — while every walk, every probe and every reader-suite
 * run against staging writes into the store readers are served from. There is
 * no error, no alarm and no reader-visible symptom. It is discovered, if it is
 * ever discovered, in an aggregate somebody sold.
 *
 * `NODE_ENV=production` alone cannot distinguish production from a built branch
 * deploy. Both the branch build and `lib/db/write-guard.ts` now use this module's
 * measured deployment context and endpoint identities. Runtime SQL dispatch is
 * guarded at `lib/db/guarded-neon.ts`, including raw queries and control-plane
 * persistence, so a forgotten business-level assertion cannot reopen the hole.
 *
 * ## This module is PURE, and that is a security property
 *
 * No network, no filesystem, no clock, no `process.env`. Every input is passed
 * in, so every branch — including the seeded failure — is constructible in a
 * test rather than reproducible only by misconfiguring a deploy.
 *
 * ## THE CREDENTIAL RULE, and it is absolute
 *
 * `classifyDatabaseUrl` and `sameEndpointIdentity` receive connection strings
 * carrying a password. **They return a role or a boolean. They never return,
 * log, throw or embed the string, any component of it, or anything derived
 * from its credentials.** In particular they never re-throw a parse error:
 * Node's `new URL()` failure carries the ENTIRE input back on `err.input`, and
 * a `catch` that rethrows, wraps, or writes `err.message` into a reason string
 * is how a password reaches a CI log that a hundred people can read. Every
 * `catch` here is empty by intent, and `tests/staging-isolation.test.ts` plants
 * a password and proves it appears in no output on any path.
 *
 * ## WHY `"unknown"` IS A REAL ANSWER AND `"staging"` IS NEVER A DEFAULT
 *
 * The two wrong answers are not symmetrical:
 *
 * ```
 *   wrong "staging"  -> a test suite writes into the sold store. Silent.
 *   wrong "unknown"  -> a branch deploy is refused. Loud, and fixed in a minute.
 * ```
 *
 * So weak evidence may only ever move the answer TOWARD the refusing side. A
 * URL that merely looks like staging stays `"unknown"`, and a `CANNOT_TELL`
 * fails safe (RULING 182, RULING 184: a route that could not be established is
 * never an established fact).
 */

/* ------------------------------------------------------------------ roles */

/**
 * What a connection string points at.
 *
 * `"unknown"` is not a failure state and not a placeholder — it is the honest
 * answer whenever the evidence does not settle the question, and it is what a
 * naive implementation replaces with a guess.
 */
export const DATABASE_ROLES = ["staging", "production", "local", "unknown"] as const;
export type DatabaseRole = (typeof DATABASE_ROLES)[number];

/**
 * The anchors a classification is made against.
 *
 * Each hint may be a bare host (`ep-quiet-forest-a1b2c3.us-east-2.aws.neon.tech`)
 * or a whole connection string. Accepting the connection string matters: it
 * means the CALLER never has to slice a secret apart to produce a hint, and
 * slicing is where a secret escapes.
 */
export interface ClassifyHints {
  /** The connection string or host this project treats as production. */
  readonly productionHostHint?: string | null;
  /** The connection string or host this project treats as staging. */
  readonly stagingHostHint?: string | null;
}

export type DatabaseDestination = "application" | "control-plane";

/** The gate and runtime resolve the same build-bound anchors; values never leave the caller. */
export function databaseDestinationHints(
  env: Readonly<Record<string, string | undefined>>,
  destination: DatabaseDestination = "application",
): ClassifyHints {
  return destination === "application" ? {
    productionHostHint: env.WTP_BUILD_PRODUCTION_DATABASE_HOST || env.WTP_PRODUCTION_DATABASE_URL_READONLY,
    stagingHostHint: env.WTP_BUILD_STAGING_DATABASE_HOST || env.WTP_STAGING_DATABASE_URL_READONLY,
  } : {
    productionHostHint: env.WTP_BUILD_PRODUCTION_CONTROL_PLANE_HOST || env.WTP_PRODUCTION_CONTROL_PLANE_DATABASE_URL_READONLY,
    stagingHostHint: env.WTP_BUILD_STAGING_CONTROL_PLANE_HOST || env.WTP_STAGING_CONTROL_PLANE_DATABASE_URL_READONLY,
  };
}

/** Hosts that cannot be a shared store, whatever else is true of them. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

/**
 * Name fragments that may CONVICT a URL of being production, and nothing else.
 *
 * There is deliberately no staging equivalent. A token list that could produce
 * `"staging"` would be a way to be permitted by naming, and the whole point of
 * the asymmetry above is that a name is not evidence in the permitting
 * direction. Extending this list can only ever refuse more deploys, so it is
 * safe to extend and can never become a bypass.
 */
const PRODUCTION_NAME_TOKENS = new Set(["prod", "production"]);

/**
 * The stable identity of the endpoint a connection string resolves to.
 *
 * Neon branch endpoints are `ep-<name>-<id>.<region>.aws.neon.tech`, and the
 * `ep-…` label is the branch: the region and the `aws.neon.tech` suffix are
 * shared by every branch of every project, so comparing whole hosts would call
 * two DIFFERENT branches the same place the day a pooler host is used. The
 * `ep-…` label is therefore the identity, and a non-Neon host is its own.
 *
 * A POOLED connection carries the real branch in `?options=endpoint=ep-…`
 * while the HOST is the pooler's. Reading `options` first is what stops a
 * pooled production string from reading as a different endpoint than the
 * direct one — the exact shape that would let a collision check pass on two
 * spellings of one database.
 *
 * Returns `null` when nothing could be established. `null` is never treated as
 * a match and never as a non-match.
 */
function endpointIdentityOf(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw === "") return null;

  let host = "";
  let options: string | null = null;
  try {
    const parsed = new URL(raw);
    host = parsed.hostname;
    options = parsed.searchParams.get("options");
  } catch {
    /*
     * NOTHING IS READ FROM THE ERROR. Node attaches the whole input string to
     * `err.input`, and its message has carried the input in past versions. An
     * empty catch is the only shape that cannot leak, so it is the shape.
     */
  }

  if (host === "") {
    // A bare host hint has no scheme, so `new URL` refuses it. Accept it only
    // when it looks like a hostname and nothing else — a value with a `:`, a
    // `/` or an `@` in it might be a connection string that failed to parse,
    // and treating that as a host would put credentials into the identity.
    host = /^[a-z0-9.\-_]+$/i.test(raw) ? raw : "";
  }
  if (host === "") return null;

  host = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

  const pooled = /(?:^|[;\s])endpoint=(ep-[a-z0-9-]+)/i.exec(options ?? "");
  if (pooled) return pooled[1].toLowerCase().replace(/-pooler$/, "");

  const direct = /^(ep-[a-z0-9-]+)\./.exec(host);
  if (direct) return direct[1].replace(/-pooler$/, "");

  return host;
}

/** The database (or Neon branch) name, lowercased. `null` when unreadable. */
function databaseNameOf(value: string): string | null {
  try {
    /*
     * Deliberately NOT `new URL(value).pathname`.
     *
     * RULING 14 (`tests/path-separator.test.ts`) bans that shape repo-wide,
     * and although the reason it was adopted was FILE urls, the ban is right
     * here too for a second reason: `pathname` PERCENT-DECODES. A database
     * name containing an escaped character would decode into a different
     * string, and this value is COMPARED against another connection's name to
     * decide whether staging and production are the same store. A comparison
     * that silently normalises its inputs is how two different databases come
     * to look like one — or one like two.
     *
     * Taking the segment after the authority directly is narrower, decodes
     * nothing, and still reads nothing from the credential portion.
     */
    const afterScheme = value.replace(/^[a-z0-9+.-]+:\/\//i, "");
    const slash = afterScheme.indexOf("/");
    if (slash === -1) return null;
    const name = (afterScheme.slice(slash + 1).split(/[/?#]/)[0] ?? "").trim();
    return name === "" ? null : name.toLowerCase();
  } catch {
    /* See `endpointIdentityOf`: nothing is read from the error. */
    return null;
  }
}

/** Provider proof may expose only a credential-free endpoint, host and simple database name. */
export function sanitizedDatabaseDestination(
  value: string | null | undefined,
): { endpointIdentity: string; host: string; database: string | null } | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return null;
    const host = parsed.hostname.toLowerCase();
    if (!/^[a-z0-9.-]+$/i.test(host) && host !== "[::1]") return null;
    const endpointIdentity = endpointIdentityOf(value);
    if (!endpointIdentity) return null;
    const database = databaseNameOf(value);
    return {
      endpointIdentity,
      host,
      database: database !== null && /^[a-z0-9_-]+$/i.test(database) ? database : null,
    };
  } catch {
    return null;
  }
}

/** Split an identifier into the word-shaped segments a token can match. */
function segments(value: string): string[] {
  return value.split(/[^a-z0-9]+/i).filter(Boolean);
}

/**
 * **Classify a connection string by WHERE IT POINTS, never by what it is called.**
 *
 * The ladder, strongest evidence first. Every rung that does not settle the
 * question falls through to `"unknown"`; none of them falls through to a guess.
 *
 *  1. **A local host is local.** Nothing reachable only from this machine can
 *     be the store readers are served from.
 *  2. **Endpoint identity equal to the production anchor is production.**
 *     This is the rung that catches the seeded failure, and it catches it even
 *     when the deploy's settings panel calls the variable something reassuring.
 *  3. **Endpoint identity equal to the staging anchor is staging.**
 *  4. **A `prod` / `production` token in the endpoint or database name is
 *     production.** Weak evidence, admitted only in the refusing direction.
 *  5. **Otherwise `"unknown"`.**
 *
 * WHEN THE TWO ANCHORS ARE THE SAME ENDPOINT, the answer is `"unknown"` rather
 * than `"production"` or `"staging"`. Anchors that do not distinguish two
 * places cannot classify anything, and returning either label would be
 * reporting the caller's misconfiguration as a measurement of this URL.
 * `evaluateIsolation` refuses that state through the collision rule.
 *
 * NEVER THROWS. A malformed URL, a null, an empty string and a hostile string
 * are all `"unknown"`, because the alternative — an exception whose message or
 * `input` carries the connection string — is the leak this module is built to
 * prevent.
 */
export function classifyDatabaseUrl(
  url: string | null | undefined,
  opts: ClassifyHints,
): DatabaseRole {
  const identity = endpointIdentityOf(url);
  if (identity === null) return "unknown";

  if (LOCAL_HOSTS.has(identity) || identity.endsWith(".localhost")) return "local";

  const productionId = endpointIdentityOf(opts.productionHostHint);
  const stagingId = endpointIdentityOf(opts.stagingHostHint);

  // Anchors that name one place cannot separate two. Neither label is earned.
  if (productionId !== null && productionId === stagingId) return "unknown";

  if (productionId !== null && identity === productionId) return "production";
  if (stagingId !== null && identity === stagingId) return "staging";

  const named = [
    ...segments(identity),
    ...segments(databaseNameOf(typeof url === "string" ? url : "") ?? ""),
  ];
  if (named.some((s) => PRODUCTION_NAME_TOKENS.has(s))) return "production";

  return "unknown";
}

/**
 * Do these two connection strings resolve to the SAME endpoint?
 *
 * **`null` is not `false`.** A pair where either identity could not be
 * established is an UNMEASURED collision, and CLAUDE.md's rule applies
 * directly: an operation that can return nothing must be asked what it
 * returned. `evaluateIsolation` treats `null` exactly as it treats an
 * unasked question — it refuses — so there is no way to be permitted by
 * failing to measure.
 *
 * Returns a boolean or `null` and NEVER either identity, because a caller
 * holding an identity is a caller that can print one beside the variable it
 * came from.
 */
export function sameEndpointIdentity(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean | null {
  const ia = endpointIdentityOf(a);
  const ib = endpointIdentityOf(b);
  if (ia === null || ib === null) return null;
  return ia === ib;
}

/** One measured destination decision shared by the build gate and write boundary. */
export function evaluateDatabaseDestination(input: ClassifyHints & {
  readonly context: string;
  readonly databaseUrl: string | null | undefined;
}): IsolationVerdict {
  // The classifier's weak "prod" naming evidence may refuse staging, but
  // cannot grant production writes without a measured production anchor.
  if (input.context.trim().toLowerCase() === "production" &&
    sameEndpointIdentity(input.databaseUrl, input.productionHostHint) !== true) {
    return {
      ok: false,
      role: "unknown",
      context: input.context,
      reason: "the production destination has not been measured equal to the production anchor.",
    };
  }
  return evaluateIsolation({
    context: input.context,
    role: sanitizedDatabaseDestination(input.databaseUrl) === null
      ? "unknown" : classifyDatabaseUrl(input.databaseUrl, input),
    productionRole: classifyDatabaseUrl(input.productionHostHint, {
      productionHostHint: input.productionHostHint,
    }),
    sameEndpointAsProduction: sameEndpointIdentity(input.databaseUrl, input.productionHostHint),
  });
}

/* --------------------------------------------------------------- verdicts */

/**
 * The two contexts this module recognises, as constants rather than as strings
 * typed at each call site. Netlify's own vocabulary is wider —
 * `deploy-preview`, `dev` — and NORMALISING IT IS THE CALLER'S JOB, at the
 * impure boundary, where the mapping can be printed. Every context that is not
 * `production` collapses to `branch-deploy`, which is the strict side.
 */
export const BRANCH_DEPLOY_CONTEXT = "branch-deploy";
export const PRODUCTION_CONTEXT = "production";

export interface IsolationVerdict {
  readonly ok: boolean;
  readonly role: DatabaseRole;
  readonly context: string;
  /** Why, in one sentence, always stated — for a pass as well as a refusal. */
  readonly reason: string;
}

/**
 * May this deploy proceed against the database it has resolved?
 *
 * Each rule names the failure it prevents and the wrong answer a naive
 * implementation gives.
 *
 * `sameEndpointAsProduction` is the CALLER'S MEASUREMENT, taken with
 * {@link sameEndpointIdentity}. It is optional in the type and it is not
 * optional in effect: **omitting it refuses a branch deploy.** That direction
 * is deliberate and it is copied from `evaluateReleaseFreeze`'s rule 4 — a
 * caller that leaves the question unasked gets the strict answer, never the
 * lenient one, which is the only shape under which "there is no skip flag"
 * survives contact with a caller who would like one.
 */
export function evaluateIsolation(input: {
  readonly context: string;
  readonly role: DatabaseRole;
  readonly productionRole: DatabaseRole;
  /** `true` collides, `false` is proven distinct, `null`/absent is UNMEASURED. */
  readonly sameEndpointAsProduction?: boolean | null;
}): IsolationVerdict {
  const context = input.context.trim().toLowerCase();
  const collision = input.sameEndpointAsProduction ?? null;
  const verdict = (ok: boolean, reason: string): IsolationVerdict => ({
    ok,
    role: input.role,
    context: input.context,
    reason,
  });

  /*
   * AN UNRECOGNISED CONTEXT IS NOT A PERMITTED ONE. A new deploy context is a
   * decision — somebody has to say which side of the isolation boundary it
   * falls on — and a `default:` branch that let it through would answer that
   * decision by accident, in the permitting direction, for every future
   * context at once.
   */
  if (context !== BRANCH_DEPLOY_CONTEXT && context !== PRODUCTION_CONTEXT) {
    return verdict(
      false,
      `the context ${JSON.stringify(input.context)} is not one this guard recognises ` +
        `(${BRANCH_DEPLOY_CONTEXT} or ${PRODUCTION_CONTEXT}). A context nobody has classified ` +
        "is refused rather than assumed harmless.",
    );
  }

  if (context === PRODUCTION_CONTEXT) {
    /*
     * PRODUCTION MUST SERVE PRODUCTION. The mirror-image failure of the seeded
     * one, and it is not hypothetical: a settings panel where the two branch
     * URLs were pasted into each other's slots produces a production site
     * serving the staging store — every reader sees stale or empty civic data,
     * and every reaction is written where nothing will ever read it.
     */
    if (input.role !== "production") {
      return verdict(
        false,
        `this is the production context and DATABASE_URL resolves to ${input.role}. Production ` +
          "serves production; anything else is a production site reading a store no reader's " +
          "data is in.",
      );
    }
    return verdict(true, "the production context resolving the production database.");
  }

  /* ------------------------------- branch-deploy (staging) ---------------- */

  /*
   * THE COLLISION RULE, FIRST, BECAUSE IT OUTRANKS EVERY LABEL. Two variables
   * can be named anything and still be one database. This is checked before
   * the roles for exactly that reason: a deploy whose staging URL resolves to
   * the production endpoint is refused even when both ends are confidently
   * labelled "staging".
   *
   * It applies ONLY on this side. In the production context the two strings
   * SHOULD resolve to the same endpoint, and refusing that would be refusing
   * the correct configuration.
   */
  if (collision === true) {
    return verdict(
      false,
      "the staging connection and the production connection resolve to the SAME " +
        "endpoint. Whatever either variable is called, this deploy is pointed at the store " +
        "readers are served from, and every test run against it would write into what we sell.",
    );
  }

  /*
   * THE SEEDED FAILURE. A staging deploy resolving the production database.
   * A naive implementation never reaches this branch at all, because it asks
   * whether the URL is "set" rather than where it points.
   */
  if (input.role === "production") {
    return verdict(
      false,
      "this is a branch (staging) deploy and DATABASE_URL resolves to the PRODUCTION " +
        "database. Nothing here would fail visibly: the site would come up, serve real data, and " +
        "write every probe row into the store this business sells from.",
    );
  }

  /*
   * CANNOT_TELL FAILS SAFE. An unverifiable staging database is refused, not
   * permitted. The wrong answer a naive implementation gives is to default the
   * unclassifiable case to "staging" because that is the reassuring word — and
   * that default is precisely how a production URL passes.
   */
  if (input.role === "unknown") {
    return verdict(
      false,
      "DATABASE_URL could not be classified, so nothing establishes that this branch " +
        "deploy is NOT pointed at production. An unverifiable staging database is refused; a " +
        "could-not-tell is never a pass (RULING 24).",
    );
  }

  /*
   * THE ANCHOR ITSELF HAS TO EXIST. If the production connection could not be
   * classified, then no comparison against production happened, and a verdict
   * that reported OK here would be reporting the ABSENCE of a check as the
   * result of one.
   */
  if (input.productionRole !== "production") {
    return verdict(
      false,
      `REFUSED — the production anchor classifies as ${input.productionRole}, so there was ` +
        "nothing to compare this deploy against. A missing anchor is a missing check, and a " +
        "missing check never prints like a passing one.",
    );
  }

  if (collision !== false) {
    return verdict(
      false,
      "whether this deploy's database is the production database was never MEASURED. " +
        "An unasked question is not a passing answer, so the branch deploy is refused rather " +
        "than permitted on an unmeasured comparison.",
    );
  }

  return verdict(
    true,
    `the branch (staging) deploy resolves a ${input.role} database, proven to be a different ` +
      "endpoint from the production anchor.",
  );
}

/* ----------------------------------------------------- record-path safety */

/**
 * Would writing here overwrite the production integrity record?
 *
 * The staging observer must be STRUCTURALLY incapable of writing
 * `data/ops/production-integrity.json`: that file is what
 * `scripts/release-freeze-gate.mts` reads to decide whether the next
 * production-changing release may ship, so a staging reading landing in it
 * would be a fact about the branch-deploy host deciding what production is
 * allowed to do — a green one blessing a release, or a red one freezing the
 * repository over a host no reader visits.
 *
 * **Compared case-INSENSITIVELY, and that is not sloppiness.** On Windows two
 * paths differing only in case are ONE FILE, so a case-sensitive comparison
 * would let `Data/Ops/Production-Integrity.json` through and overwrite the
 * record it was written to protect. The cost of the other direction is a
 * refused write on a path nobody would ever create.
 */
export function recordPathCollides(candidate: string, productionRecordPath: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(candidate) === norm(productionRecordPath);
}
