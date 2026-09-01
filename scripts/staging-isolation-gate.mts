/**
 * `pnpm staging:isolation` — **prove this deploy is not pointed at the store
 * readers are served from.** (Lane 5, 2026-09-01.)
 *
 * The executable half of `lib/ops/staging-isolation.ts`. That module holds the
 * reasoning and every branch of it; this file is the impure shell that reads
 * the environment, hands the module three facts, prints the verdict and exits.
 *
 * ## WHAT IT PRINTS, AND WHAT IT WILL NEVER PRINT
 *
 * **Environment variable NAMES. Never values.** Not truncated, not masked, not
 * "the first eight characters", not a host, not a username. A connection string
 * that reaches a CI log is a connection string that reaches everyone with read
 * access to the run, and every mask anybody has ever written has had an input
 * that defeats it. The classification happens inside a pure function that
 * returns a four-value enum; the only thing that crosses back out is that enum.
 *
 * ## The context, and why an unset one is not a pass
 *
 * Netlify sets `CONTEXT` to `production`, `branch-deploy`, `deploy-preview` or
 * `dev`. Everything that is not `production` collapses to the strict side —
 * a deploy preview must no more resolve the production database than a branch
 * deploy — and the mapping is printed so the collapse is visible rather than
 * inferred.
 *
 * With no `CONTEXT` and no `--context=`, this exits **2 — COULD NOT TELL**. A
 * bare local shell does not load `.env.local` and does not set `CONTEXT`, so
 * that is the honest reading on a developer machine: a true fact about this
 * process, and never a claim about a deploy.
 *
 *   --context=<production|branch-deploy|…>  override the platform's CONTEXT
 *   --production-var=<NAME>                 the variable holding the production
 *                                           anchor. A NAME, never a value.
 *   --staging-var=<NAME>                    the variable holding the staging
 *                                           anchor. A NAME, never a value.
 *
 * There is no skip flag, for the reason every gate in this repository gives:
 * an escape hatch on a gate is how the gate stops meaning anything.
 *
 * Exit codes — three answers, never two:
 *   0  ISOLATED     this deploy is proven to be pointed somewhere else
 *   1  REFUSED      it is pointed at production, or at an unmeasurable place
 *   2  COULD NOT TELL   the question could not be asked at all
 */

import {
  BRANCH_DEPLOY_CONTEXT,
  PRODUCTION_CONTEXT,
  classifyDatabaseUrl,
  evaluateIsolation,
  sameEndpointIdentity,
} from "../lib/ops/staging-isolation.ts";

/** The variable this deploy's application actually connects through. */
const RUNTIME_VARIABLE = "DATABASE_URL";

/**
 * The default production anchor, by NAME.
 *
 * `WTP_PRODUCTION_DATABASE_URL_READONLY` is the one production connection this
 * repository already provisions for automated checks (NH272), and it is the
 * right anchor for an identity comparison: the READONLY and WRITE roles are two
 * users on ONE endpoint, so either proves the same thing about where a URL
 * points, and this one cannot write anything if it is ever misused.
 */
const DEFAULT_PRODUCTION_VARIABLE = "WTP_PRODUCTION_DATABASE_URL_READONLY";

/**
 * The staging anchor, by NAME — and why the gate needs one to PASS.
 *
 * "Not the production endpoint" is weaker than "the staging endpoint", and the
 * difference is a real deploy: a `DATABASE_URL` nobody declared could be a
 * third database, an abandoned branch, or another project's store. So a branch
 * deploy is cleared by POSITIVE identification against a declared anchor, and
 * an undeclared one comes back `unknown` and is refused.
 *
 * **That makes the gate satisfiable, which is not a nicety.**
 * `lib/ops/production-integrity.ts` records the lesson in its own header: an
 * unsatisfiable gate is the strongest argument anyone will ever have for the
 * skip flag this repository refuses to have. Without an anchor to clear
 * against, this gate could only ever refuse, and it would be switched off
 * rather than fixed.
 */
const DEFAULT_STAGING_VARIABLE = "WTP_STAGING_DATABASE_URL_READONLY";

/** One-line flag reader. Deliberately not a fourth copy of `arg` (RULING 103). */
const flag = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/**
 * Netlify's four contexts mapped onto the guard's two.
 *
 * The collapse is toward the STRICT side by construction: only the literal
 * string `production` is production, and every other value — including one
 * this repository has never seen — is treated as a branch deploy. A mapping
 * that listed the non-production contexts instead would silently permit the
 * fifth one Netlify adds.
 */
function normaliseContext(raw: string): { context: string; note: string } {
  const value = raw.trim().toLowerCase();
  if (value === PRODUCTION_CONTEXT) {
    return { context: PRODUCTION_CONTEXT, note: "the production context, unmapped" };
  }
  return {
    context: BRANCH_DEPLOY_CONTEXT,
    note: `${JSON.stringify(raw)} is not "${PRODUCTION_CONTEXT}", so it is held to the ${BRANCH_DEPLOY_CONTEXT} rules`,
  };
}

function main(): void {
  const productionVariable = flag("production-var") ?? DEFAULT_PRODUCTION_VARIABLE;
  const stagingVariable = flag("staging-var") ?? DEFAULT_STAGING_VARIABLE;
  const rawContext = flag("context") ?? process.env.CONTEXT ?? "";

  console.log("STAGING ISOLATION GATE");
  console.log(`  runtime variable      ${RUNTIME_VARIABLE}`);
  console.log(`  production anchor     ${productionVariable}`);
  console.log(`  staging anchor        ${stagingVariable}`);
  console.log("  values printed        NONE — this gate prints variable NAMES only");
  console.log("");

  if (rawContext.trim() === "") {
    console.error(
      "COULD NOT TELL — neither CONTEXT nor --context= names the deploy context, so there is\n" +
        "no question to ask. This is a fact about this process, not about any deploy: a bare\n" +
        "shell sets no CONTEXT. Pass --context=branch-deploy or --context=production.",
    );
    process.exitCode = 2;
    return;
  }

  const { context, note } = normaliseContext(rawContext);
  console.log(`  context               ${context}  (${note})`);

  /*
   * READ ONCE, INTO CONSTS THAT ARE NEVER PRINTED, AND HANDED STRAIGHT INTO
   * THE PURE FUNCTIONS. Nothing between here and the verdict formats, slices,
   * interpolates or logs either string.
   */
  const runtimeUrl = process.env[RUNTIME_VARIABLE] ?? null;
  const productionUrl = process.env[productionVariable] ?? null;
  const stagingUrl = process.env[stagingVariable] ?? null;

  for (const [name, value] of [
    [RUNTIME_VARIABLE, runtimeUrl],
    [productionVariable, productionUrl],
    [stagingVariable, stagingUrl],
  ] as const) {
    console.log(`  set: ${name.padEnd(38)} ${value === null ? "NO" : "yes"}`);
  }
  console.log("");

  /*
   * THE PRODUCTION ANCHOR IS PASSED FIRST AND WINS FIRST. If the two anchors
   * were ever set to the same connection — a copy-paste in a settings panel —
   * `classifyDatabaseUrl` refuses to distinguish them and answers `unknown`
   * rather than blessing the runtime URL as staging on an anchor that is
   * really production.
   */
  const role = classifyDatabaseUrl(runtimeUrl, {
    productionHostHint: productionUrl,
    stagingHostHint: stagingUrl,
  });
  /*
   * THE ANCHOR IS CLASSIFIED AGAINST ITSELF, AND THAT IS DEFINITIONAL RATHER
   * THAN EVIDENTIAL. The variable named "…PRODUCTION_DATABASE_URL…" IS the
   * production anchor by construction; asking whether it looks like production
   * would be asking the wrong question. What this call actually establishes is
   * whether the anchor EXISTS and is parseable at all — an absent or malformed
   * anchor comes back `unknown`, and `evaluateIsolation` refuses on it, because
   * a comparison with nothing on one side is not a comparison.
   */
  const productionRole = classifyDatabaseUrl(productionUrl, {
    productionHostHint: productionUrl,
    stagingHostHint: null,
  });
  const collision = sameEndpointIdentity(runtimeUrl, productionUrl);

  const verdict = evaluateIsolation({
    context,
    role,
    productionRole,
    sameEndpointAsProduction: collision,
  });

  console.log(`  ${RUNTIME_VARIABLE} resolves to  ${role}`);
  console.log(`  production anchor is  ${productionRole}`);
  console.log(
    `  same endpoint?        ${collision === null ? "COULD NOT TELL" : collision ? "YES" : "no"}`,
  );
  console.log("");

  if (verdict.ok) {
    console.log(`ISOLATED — ${verdict.reason}`);
    process.exitCode = 0;
    return;
  }

  /*
   * TWO DIFFERENT REFUSALS, AND THEY MAY NEVER SHARE AN EXIT CODE. "This
   * deploy is pointed at production" is a finding; "the question could not be
   * asked" is the absence of one. A single non-zero code would let a CI job
   * that never had a credential read exactly like a caught misconfiguration —
   * and, worse, would let a real catch be dismissed as the usual missing
   * secret.
   */
  const couldNotTell = role === "unknown" || productionRole === "unknown" || collision === null;
  console.error(`${couldNotTell ? "COULD NOT TELL" : "REFUSED"} — ${verdict.reason}`);
  if (couldNotTell) {
    const owed = [
      runtimeUrl === null ? RUNTIME_VARIABLE : null,
      productionUrl === null ? productionVariable : null,
      role === "unknown" && stagingUrl === null ? stagingVariable : null,
    ].filter((n): n is string => n !== null);
    /*
     * The NAMES, resolved before the template rather than inside it.
     *
     * What is printed here is a LIST of variable names, never a number. Taking
     * the size of a collection inside a printed template is the shape
     * `scripts/floor-audit.mts` sweeps for under RULING 159, and it is right to
     * sweep for it: that shape is how a script reports a quantity whose
     * population it never established. Resolving the list first makes it plain
     * that no quantity is being reported here at all.
     */
    const owedNames =
      owed[0] === undefined
        ? "(all three are set — the values simply did not classify)"
        : owed.join(", ");
    console.error(
      `\nWhat is owed, by NAME: ${owedNames}.\n` +
        "Set them in the deploy environment or as repository secrets and run this again.\n" +
        "Nothing about any value is printed here, or anywhere else in this gate.",
    );
  }
  process.exitCode = couldNotTell ? 2 : 1;
}

/*
 * `process.exitCode`, never `process.exit()` — the same measured reason
 * `scripts/post-deploy-observer.mts` gives. Nothing above runs on import, so
 * the suite can drive the pure half without this shell reading an environment.
 */
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/staging-isolation-gate.mts")) {
  main();
}
