import { selectSavedDatabase } from "../lib/core/keys-values.ts";
/**
 * Production intake observation owned by the standing runtime.
 *
 * The permanent path reads the production stores, performs the existing
 * sanctioned limiter purge, and
 * emits one aggregate receipt for `scripts/pilot-runner.mts` to persist on its
 * canonical control-plane heartbeat. A flag is data, not a process failure;
 * an unreadable store is also a durable runtime outcome, not a software-CI
 * failure.
 *
 * @freshness-reads-here — observedAt is the explicit start of this production
 * store observation and is persisted as runtime evidence, not data currency.
 */
import { neon } from "../lib/db/client.ts";

import type { Sql } from "../lib/control-plane/repository/pg-store.ts";
import { purgeExpiredLimiterState } from "../lib/db/intake-limiter.ts";
import { assertWriteAllowed } from "../lib/db/write-guard.ts";
import { resolveProductionWriteHandle } from "../lib/db/write-handle.ts";
import {
  collectIntakeRuntimeObservation,
  unreadableIntakeRuntimeObservation,
  type IntakeRuntimeObservation,
} from "../lib/ops/intake-runtime.ts";
import { assertRuntimeAuthority } from "../lib/civic-data/runtime-authority.ts";

const observedAt = new Date().toISOString();
let observation: IntakeRuntimeObservation;

try {
  assertRuntimeAuthority({ capabilities: ["INTAKE_RUNTIME"] });
  const handle = resolveProductionWriteHandle();
  if (process.env.WTP_RUNTIME_MODE !== "staging") selectSavedDatabase("WTP_PRODUCTION_DATABASE_URL_WRITE");
  if (process.env.WTP_RUNTIME_MODE === "staging") process.env.WTP_DB_ROLE = "local";
  else process.env.WTP_DB_ROLE = "production";
  process.env.WTP_SANCTIONED_WRITE = "intake-limiter-purge";
  assertWriteAllowed("an intake limiter purge");
  observation = await collectIntakeRuntimeObservation({
    sql: neon(handle.connection) as unknown as Sql,
    observedAt,
    purgeExpired: () => purgeExpiredLimiterState(new Date(observedAt)),
  });
} catch (error) {
  observation = unreadableIntakeRuntimeObservation(
    observedAt,
    `The standing runtime could not open the sanctioned production intake path (${error instanceof Error ? error.name : "error"}); no healthy verdict was recorded.`,
  );
}

console.log(`INTAKE_RUNTIME_RECEIPT=${JSON.stringify(observation)}`);
if (observation.outcome === "UNREADABLE") process.exitCode = 2;
