/**
 * `pnpm staging:isolation` runs before Next in Netlify's branch-deploy command.
 * This shell opens no connection. Both mutable destinations use the same
 * measured endpoint decision as the shared runtime write boundary.
 *
 * Output contains variable names, verdicts and sanitized endpoint/database
 * identity only. Connection strings, credentials and parser errors never leave
 * the pure helper. Missing context/measurement exits 2; a measured collision
 * exits 1; only an isolated configuration exits 0. There is no skip flag.
 *
 * Legacy --production-var=<NAME> / --staging-var=<NAME> anchors are supported
 * for local proofs. Netlify uses the provider-readback WTP_BUILD_*_HOST anchors.
 */
import {
  BRANCH_DEPLOY_CONTEXT,
  PRODUCTION_CONTEXT,
  classifyDatabaseUrl,
  databaseDestinationHints,
  evaluateDatabaseDestination,
  sameEndpointIdentity,
  sanitizedDatabaseDestination,
} from "../lib/ops/staging-isolation.ts";

const flag = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function main(): void {
  const rawContext = flag("context") ?? process.env.CONTEXT ?? "";
  const context = rawContext.trim().toLowerCase();
  console.log("STAGING ISOLATION GATE");
  console.log("  values printed        sanitized endpoint identity / host / database only");

  // Do not map a new or unmeasured deployment context onto an allowed one.
  if (context !== BRANCH_DEPLOY_CONTEXT && context !== PRODUCTION_CONTEXT) {
    console.error("COULD NOT TELL — CONTEXT must identify production or branch-deploy.");
    process.exitCode = 2;
    return;
  }
  console.log(`  context               ${context}`);

  let exitCode = 0;
  for (const destination of ["application", "control-plane"] as const) {
    const runtimeVariable = destination === "application" ? "DATABASE_URL" : "WTP_CONTROL_PLANE_DATABASE_URL";
    const runtimeUrl = process.env[runtimeVariable] ?? null;
    const hints = databaseDestinationHints(process.env, destination);
    const productionVariable = destination === "application" ? flag("production-var") : undefined;
    const stagingVariable = destination === "application" ? flag("staging-var") : undefined;
    // Variable overrides remain names, and are never interpolated into output.
    const productionUrl = productionVariable ? process.env[productionVariable] ?? null : hints.productionHostHint;
    const stagingUrl = stagingVariable ? process.env[stagingVariable] ?? null : hints.stagingHostHint;
    const measuredHints = { productionHostHint: productionUrl, stagingHostHint: stagingUrl };
    const verdict = evaluateDatabaseDestination({ context, databaseUrl: runtimeUrl, ...measuredHints });
    const productionRole = classifyDatabaseUrl(productionUrl, { productionHostHint: productionUrl });
    const collision = sameEndpointIdentity(runtimeUrl, productionUrl);

    for (const [name, value] of [[runtimeVariable, runtimeUrl]] as const) {
      console.log(`  set: ${name.padEnd(38)} ${value === null ? "NO" : "yes"}`);
    }
    const identity = sanitizedDatabaseDestination(runtimeUrl);
    if (identity !== null) {
      console.log(`  ${runtimeVariable} endpoint ${identity.endpointIdentity}; host ${identity.host}; database ${identity.database ?? "UNMEASURED"}`);
    }
    console.log(`  ${runtimeVariable} resolves to ${verdict.role}; same production endpoint? ${collision === null ? "UNMEASURED" : collision ? "YES" : "no"}`);

    if (verdict.ok) {
      console.log(`ISOLATED — ${runtimeVariable}: ${verdict.reason}`);
      continue;
    }
    const couldNotTell = verdict.role === "unknown" || productionRole === "unknown" || collision === null;
    console.error(`${couldNotTell ? "COULD NOT TELL" : "REFUSED"} — ${runtimeVariable}: ${verdict.reason}`);
    // A measured collision remains exit 1 even if another store is unmeasured.
    if (!couldNotTell) exitCode = 1;
    else if (exitCode === 0) exitCode = 2;
  }
  process.exitCode = exitCode;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/staging-isolation-gate.mts")) {
  main();
}
