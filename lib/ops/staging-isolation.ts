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
