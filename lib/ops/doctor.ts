/**
 * **`pnpm doctor` — CAN THIS MACHINE DO THE WORK, AND WHAT EXACTLY IS MISSING?**
 * (2026-08-27, the coverage-truth session.)
 *
 * ## Why this is not `pnpm credentials`
 *
 * `pnpm credentials` proves each credential **by calling it** and writes
 * `docs/credential-ledger.md`. That is a question about the WORLD: does this key
 * still open that door. This asks a question about the MACHINE: is there a
 * browser, is there a build, is the database variable set, is git configured —
 * the things whose absence makes a session fail ten minutes in, on a step that
 * had nothing to do with them.
 *
 * The two are deliberately separate and this one never calls a credentialed
 * endpoint. It reports that a credential is PRESENT or MISSING **by name**, and
 * leaves whether it works to the instrument built for that.
 *
 * ## The secret boundary, which is the whole reason this file exists
 *
 * A diagnostic tool is the single most dangerous place in a repository to
 * handle a secret, because its entire job is to describe failures and failures
 * are where secrets leak: a thrown `fetch` error carries the URL, a connection
 * error carries the connection string, an `Authorization` header survives into
 * a serialized request object, and a report file written for a human to paste
 * into a chat carries all three.
 *
 * So doctor may emit **a credential's NAME, its presence, its validity state, a
 * generic failure class and a remediation**, and nothing else, through ANY sink
 * it writes — stdout, stderr, the JSON report, the human report, a log, a
 * captured artifact, or a serialized error.
 *
 * {@link redact} is that boundary and it is the only way anything leaves here.
 * It works in two directions on purpose:
 *
 * 1. **Value-based** — every environment value that looks like a secret is
 *    removed by exact match, so a leak of a REAL secret this machine holds is
 *    caught even if its shape is one nothing anticipated.
 * 2. **Shape-based** — credential-bearing URLs, `Authorization` headers, API-key
 *    query parameters and long opaque tokens are removed by pattern, so a
 *    secret that is NOT in this machine's environment (one echoed by a remote
 *    service, one from a fixture) is caught too.
 *
 * Either alone is insufficient, and `tests/doctor-secrets.test.ts` drives a
 * sentinel through the FAILING paths and captures every sink to prove it.
 */

export type CheckState = "PASS" | "FAIL" | "MISSING" | "COULD_NOT_VERIFY" | "OPTIONAL";

export interface CheckResult {
  /** Stable id, for a machine reading the JSON report. */
  id: string;
  /** What was checked, in one clause a non-coder can read. */
  what: string;
  state: CheckState;
  /** What was observed. ALWAYS passed through `redact` before it is stored. */
  detail: string;
  /**
   * What to do about it. Required on every non-PASS, and the requirement is
   * mechanical: `tests/doctor-secrets.test.ts` fails a check that reports a
   * problem and does not say what to do about it.
   */
  remediation: string | null;
}

/**
 * Environment variable names whose VALUE is secret.
 *
 * A prefix list rather than an exact list, because the failure mode that
 * matters is a NEW credential nobody added here. `SECRET_NAME_SHAPES` is
 * checked against the variable's name, so `NEW_VENDOR_API_KEY` is covered on
 * the day it is added rather than on the day somebody remembers this file.
 */
const SECRET_NAME_SHAPES: readonly RegExp[] = [
  /KEY$/i,
  /_KEY_/i,
  /TOKEN/i,
  /SECRET/i,
  /PASSWORD/i,
  /PASSWD/i,
  /CREDENTIAL/i,
  /DATABASE_URL/i,
  /_URL$/i,
  /_DSN$/i,
  /AUTH/i,
  /SIGNING/i,
  /PRIVATE/i,
];

export function nameLooksSecret(name: string): boolean {
  return SECRET_NAME_SHAPES.some((s) => s.test(name));
}

/**
 * Shapes that are secret-bearing wherever they appear, whatever the value is.
 *
 * These catch what the value list cannot: a token echoed by a remote service, a
 * connection string built at runtime, a header serialized into an error.
 */
const SECRET_VALUE_SHAPES: readonly { re: RegExp; as: string }[] = [
  /* A URL carrying credentials: postgres://user:pw@host, https://u:p@host. */
  { re: /\b([a-z][a-z0-9+.-]*):\/\/[^\s/@]+:[^\s/@]+@/gi, as: "$1://<credentials-removed>@" },
  /* Authorization headers, in any casing and either quoting style. */
  { re: /\bauthorization["'\s:=]+(bearer|basic|token)?\s*[^\s"',}]+/gi, as: "authorization: <removed>" },
  /* An api key or token in a query string. */
  { re: /([?&](?:api[_-]?key|key|token|access[_-]?token|secret)=)[^&\s"']+/gi, as: "$1<removed>" },
  /* A long opaque run of token-ish characters — the generic shape. 24+ so an
   * ordinary word, a git SHA of 7-8 characters or an OCD id never matches. */
  { re: /\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{8,}\b/g, as: "<token-removed>" },
  { re: /\b(?:sk|pk|ghp|gho|ghs|glpat|xox[baprs])[_-][A-Za-z0-9_-]{8,}\b/gi, as: "<token-removed>" },
];

/**
 * **THE ONLY WAY TEXT LEAVES THIS MODULE.**
 *
 * `env` is passed in rather than read from `process.env` here so a test can
 * drive it with a sentinel, and so the function has no hidden input.
 */
export function redact(text: unknown, env: Record<string, string | undefined> = process.env): string {
  /*
   * An Error is turned into its CLASS and a redacted message. `String(error)`
   * on a fetch failure carries the URL, and `JSON.stringify` on a request
   * object carries the headers, so neither is used raw — but the message is
   * still worth having, redacted, because "ENOTFOUND" and "certificate
   * expired" are different problems with different remediations.
   */
  let s: string;
  if (text instanceof Error) s = `${text.name}: ${text.message}`;
  else if (typeof text === "string") s = text;
  else {
    try {
      s = JSON.stringify(text);
    } catch {
      s = "<unserializable>";
    }
  }
  if (s === "") return s;

  /*
   * VALUE-BASED FIRST. Every environment value long enough to be a secret is
   * removed by exact match, whatever its name — a value that leaked into a
   * message is a leak regardless of which variable it came from. Longest
   * first, so a short value that is a substring of a long one cannot leave a
   * fragment of the long one behind.
   */
  const values = Object.entries(env)
    .filter(([name, value]) => typeof value === "string" && value.length >= 8 && nameLooksSecret(name))
    .map(([, value]) => value as string)
    .sort((a, b) => b.length - a.length);

  for (const v of values) {
    if (!v) continue;
    s = s.split(v).join("<redacted>");
  }

  /* SHAPE-BASED SECOND, for what this machine's environment does not hold. */
  for (const { re, as } of SECRET_VALUE_SHAPES) s = s.replace(re, as);

  return s;
}

/**
 * Build a result, with the detail redacted on the way in.
 *
 * Nothing constructs a `CheckResult` literal directly. A single constructor is
 * what makes "every detail is redacted" a property of the type rather than a
 * discipline every future check has to remember.
 */
export function check(
  id: string,
  what: string,
  state: CheckState,
  detail: unknown,
  remediation: string | null = null,
  env: Record<string, string | undefined> = process.env,
): CheckResult {
  return { id, what, state, detail: redact(detail, env), remediation };
}

/** A check that reports a problem and no way to act on it is half a check. */
export function needsRemediation(r: CheckResult): boolean {
  return r.state !== "PASS" && r.state !== "OPTIONAL" && (r.remediation ?? "").trim().length === 0;
}

/** The states that mean a session cannot do its work. */
export function blocking(results: readonly CheckResult[]): CheckResult[] {
  return results.filter((r) => r.state === "FAIL" || r.state === "MISSING");
}

/**
 * **THE RUNNER'S OWN VERSION, ASKED RATHER THAN SPAWNED.**
 * (Extracted 2026-08-27 so it can carry a regression control.)
 *
 * `pnpm run doctor` reported **`FAIL — pnpm is not on PATH`** on a machine that
 * was running the check THROUGH pnpm. Twice, for two different reasons, and
 * both are Windows: `execFileSync("pnpm")` is ENOENT because the executable is
 * `pnpm.cmd`, and `execFileSync("pnpm.cmd")` is ENOENT too because `execFile`
 * does no PATHEXT or shell resolution.
 *
 * That is a readiness tool reporting a fact about ITSELF as a fact about the
 * world — the same class of defect as an empty fetch recorded as an absence,
 * committed by the instrument built to catch it.
 *
 * The fix is not a better spawn. **pnpm already told us**: it sets
 * `npm_config_user_agent` for every script it runs, so when doctor is invoked
 * through pnpm the answer is in hand, exactly and for free, with no process and
 * no PATH resolution to get wrong.
 *
 * Taking a `spawn` argument is what makes this testable: the control below can
 * drive the user-agent path with a spawn that THROWS, proving the version came
 * from the runner rather than from a spawn that happened to work.
 */
export function detectPnpm(
  userAgent: string | undefined,
  spawn: () => string,
): { version: string | null; error: unknown } {
  const fromUa = /(?:^|\s)pnpm\/(\S+)/.exec(userAgent ?? "");
  if (fromUa) return { version: fromUa[1], error: null };
  try {
    return { version: spawn().trim() || null, error: null };
  } catch (error) {
    return { version: null, error };
  }
}
