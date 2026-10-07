/** A staging deploy may never resolve the production database: isolation is decided by where a connection points, never its name. */

/** What a connection string points at; `"unknown"` is the honest answer when the evidence does not settle it. */
export const DATABASE_ROLES = ["staging", "production", "local", "unknown"] as const;
export type DatabaseRole = (typeof DATABASE_ROLES)[number];

/** The anchors a classification is made against; a hint may be a bare host or a whole connection string, so no caller slices a secret. */
export interface ClassifyHints {
  /** The connection string or host this project treats as production. */
  readonly productionHostHint?: string | null;
  /** The connection string or host this project treats as staging. */
  readonly stagingHostHint?: string | null;
}

/** Hosts that cannot be a shared store, whatever else is true of them. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

/** Name fragments that may convict a URL of being production, and nothing else; there is deliberately no staging list. */
const PRODUCTION_NAME_TOKENS = new Set(["prod", "production"]);

/** The `ep-…` endpoint label a connection string resolves to: the branch identity, since region and suffix are shared. */
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
    // Nothing is read from the error: Node attaches the whole input string to it.
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
  if (pooled) return pooled[1].toLowerCase();

  const direct = /^(ep-[a-z0-9-]+)\./.exec(host);
  if (direct) return direct[1];

  return host;
}

/** The database (or Neon branch) name, lowercased. `null` when unreadable. */
function databaseNameOf(value: string): string | null {
  try {
    // Not `new URL(value).pathname`, which percent-decodes and would compare a different string.
    const afterScheme = value.replace(/^[a-z0-9+.-]+:\/\//i, "");
    const slash = afterScheme.indexOf("/");
    if (slash === -1) return null;
    const name = (afterScheme.slice(slash + 1).split(/[/?#]/)[0] ?? "").trim();
    return name === "" ? null : name.toLowerCase();
  } catch {
    // Nothing is read from the error.
    return null;
  }
}

/** Split an identifier into the word-shaped segments a token can match. */
function segments(value: string): string[] {
  return value.split(/[^a-z0-9]+/i).filter(Boolean);
}

/** Classify a connection string by where it points, strongest evidence first; every unsettled rung falls through to `"unknown"`. */
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

/** Whether two connection strings resolve to the same endpoint; `null` is unmeasured, not `false`, and is refused. */
export function sameEndpointIdentity(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean | null {
  const ia = endpointIdentityOf(a);
  const ib = endpointIdentityOf(b);
  if (ia === null || ib === null) return null;
  return ia === ib;
}

/** The two recognised contexts; every non-production context collapses to `branch-deploy`, the strict side. */
export const BRANCH_DEPLOY_CONTEXT = "branch-deploy";
export const PRODUCTION_CONTEXT = "production";

export interface IsolationVerdict {
  readonly ok: boolean;
  readonly role: DatabaseRole;
  readonly context: string;
  /** Why, in one sentence, always stated — for a pass as well as a refusal. */
  readonly reason: string;
}

/** Whether this deploy may proceed against its resolved database. Omitting `sameEndpointAsProduction` refuses a branch deploy. */
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

  // An unrecognised context is not a permitted one.
  if (context !== BRANCH_DEPLOY_CONTEXT && context !== PRODUCTION_CONTEXT) {
    return verdict(
      false,
      `the context ${JSON.stringify(input.context)} is not one this guard recognises ` +
        `(${BRANCH_DEPLOY_CONTEXT} or ${PRODUCTION_CONTEXT}). A context nobody has classified ` +
        "is refused rather than assumed harmless.",
    );
  }

  if (context === PRODUCTION_CONTEXT) {
    // Production must serve production.
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

  // The collision rule outranks every label: a staging URL resolving to the production endpoint is refused.
  if (collision === true) {
    return verdict(
      false,
      "the staging connection and the production connection resolve to the SAME " +
        "endpoint. Whatever either variable is called, this deploy is pointed at the store " +
        "readers are served from, and every test run against it would write into what we sell.",
    );
  }

  // A staging deploy resolving the production database.
  if (input.role === "production") {
    return verdict(
      false,
      "this is a branch (staging) deploy and DATABASE_URL resolves to the PRODUCTION " +
        "database. Nothing here would fail visibly: the site would come up, serve real data, and " +
        "write every probe row into the store this business sells from.",
    );
  }

  // An unverifiable staging database is refused, never defaulted to staging.
  if (input.role === "unknown") {
    return verdict(
      false,
      "DATABASE_URL could not be classified, so nothing establishes that this branch " +
        "deploy is NOT pointed at production. An unverifiable staging database is refused; a " +
        "could-not-tell is never a pass (RULING 24).",
    );
  }

  // The production anchor itself has to be classified, or no comparison happened.
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

/** Whether `candidate` is the production record path, compared case-insensitively since paths differing only in case can be one file. */
export function recordPathCollides(candidate: string, productionRecordPath: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(candidate) === norm(productionRecordPath);
}
