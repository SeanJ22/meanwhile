/**
 * Shared write permission: a built Next runtime is not proof of a production
 * deployment. The deploy context and destination must both be measured by the
 * same isolation machinery the branch build runs.
 */
import {
  classifyDatabaseUrl,
  databaseDestinationHints,
  evaluateDatabaseDestination,
  type DatabaseRole,
} from "../ops/staging-isolation.ts";

export type DbRole = DatabaseRole;
export type WriteEnvironment = Record<string, string | undefined>;
export type WriteDestination = "application" | "control-plane";

/** Existing scheduled exception: one purpose, one operation, one exact handle. */
export const SANCTIONED_WRITES: Record<string, string> = {
  "intake-limiter-purge": "an intake limiter purge",
};
export const SANCTIONED_WRITE_VARIABLE = "WTP_PRODUCTION_DATABASE_URL_WRITE";
export const SANCTION_VARIABLE = "WTP_SANCTIONED_WRITE";

export interface WriteContext {
  dbRole: DbRole;
  isProductionRuntime: boolean;
  allowed: boolean;
  reason: string;
  sanction?: string | null;
}

export class ProductionWriteRefused extends Error {
  readonly context: WriteContext;
  constructor(operation: string, context: WriteContext) {
    super(
      `REFUSED database write: ${operation}. ${context.reason} ` +
      "Verify the deployment context and production/staging endpoint anchors. " +
      "For local development, use a measured local database and WTP_DB_ROLE=local. " +
      `A scheduled job requires a NAMED SANCTION in ${SANCTION_VARIABLE} and the exact ` +
      `${SANCTIONED_WRITE_VARIABLE} handle. See lib/db/write-guard.ts.`,
    );
    this.name = "ProductionWriteRefused";
    this.context = context;
  }
}

/** Literal references are required for Next's build-time substitutions. No secrets are inlined. */
export function runtimeWriteEnvironment(): WriteEnvironment {
  return {
    ...process.env,
    WTP_BUILD_CONTEXT: process.env.WTP_BUILD_CONTEXT,
    WTP_BUILD_PRODUCTION_DATABASE_HOST: process.env.WTP_BUILD_PRODUCTION_DATABASE_HOST,
    WTP_BUILD_STAGING_DATABASE_HOST: process.env.WTP_BUILD_STAGING_DATABASE_HOST,
    WTP_BUILD_PRODUCTION_CONTROL_PLANE_HOST: process.env.WTP_BUILD_PRODUCTION_CONTROL_PLANE_HOST,
    WTP_BUILD_STAGING_CONTROL_PLANE_HOST: process.env.WTP_BUILD_STAGING_CONTROL_PLANE_HOST,
  };
}

export function describeWriteContext(
  env: WriteEnvironment = runtimeWriteEnvironment(),
  operation?: string,
  destination: WriteDestination = "application",
): WriteContext {
  const buildContext = env.WTP_BUILD_CONTEXT?.trim() ?? "";
  const runtimeContext = env.CONTEXT?.trim() ?? "";
  const context = buildContext || runtimeContext;
  const { productionHostHint, stagingHostHint } = databaseDestinationHints(env, destination);
  const databaseUrl = destination === "application"
    ? env.DATABASE_URL
    : env.WTP_CONTROL_PLANE_DATABASE_URL;
  const dbRole = classifyDatabaseUrl(databaseUrl, { productionHostHint, stagingHostHint });
  const isProductionRuntime = context === "production" && env.NODE_ENV === "production";
  const result = (allowed: boolean, reason: string, sanction: string | null = null): WriteContext => ({
    dbRole, isProductionRuntime, allowed, reason, sanction,
  });

  if (buildContext && runtimeContext && buildContext !== runtimeContext) {
    return result(false, "the build and runtime deploy contexts disagree; neither can authorize a write.");
  }

  // Deploy contexts never fall through to declarations or scheduled sanctions.
  if (context) {
    if (env.NODE_ENV !== "production") {
      return result(false, "a deployed write requires a built production NODE_ENV runtime as well as a measured deploy context.");
    }
    const verdict = evaluateDatabaseDestination({ context, databaseUrl, productionHostHint, stagingHostHint });
    return result(verdict.ok, verdict.reason);
  }

  if (dbRole === "local" && env.WTP_DB_ROLE === "local" && env.NODE_ENV === "development") {
    return result(true, "the development runtime resolves a measured local database (WTP_DB_ROLE=local).");
  }

  const declared = env[SANCTION_VARIABLE];
  if (declared && destination === "application" && env.NODE_ENV !== "production") {
    const permits = SANCTIONED_WRITES[declared];
    const handle = env[SANCTIONED_WRITE_VARIABLE];
    if (!permits) {
      return result(false, "no such sanction exists in SANCTIONED_WRITES.");
    }
    if (operation !== permits) {
      return result(false, `the named sanction permits ${JSON.stringify(permits)} only; it cannot authorize this operation.`);
    }
    if (!handle) {
      return result(false, `${SANCTIONED_WRITE_VARIABLE} is not set.`);
    }
    if (handle !== databaseUrl) {
      return result(false, `DATABASE_URL is not ${SANCTIONED_WRITE_VARIABLE}.`);
    }
    if (classifyDatabaseUrl(handle, { productionHostHint: handle }) !== "production") {
      return result(false, "the sanctioned destination could not be measured as a remote database.");
    }
    return { ...result(true, "the named operation uses its exact sanctioned production write handle.", declared), dbRole: "production" };
  }

  return result(false, "the deploy context or destination is unmeasured; NODE_ENV and WTP_DB_ROLE alone cannot authorize a remote write.");
}

export function assertWriteAllowed(
  operation: string,
  env: WriteEnvironment = runtimeWriteEnvironment(),
  destination: WriteDestination = "application",
): void {
  const context = describeWriteContext(env, operation, destination);
  if (!context.allowed) throw new ProductionWriteRefused(operation, context);
}
