import {
  resolveProductionWriteHandle,
  type WriteHandle,
} from "../db/write-handle.ts";
import { assertWriteAllowed } from "../db/write-guard.ts";

export const CIVIC_DATA_PROMOTION_SANCTION = "routine-civic-data-promotion";
export const CIVIC_DATA_PROMOTION_OPERATION =
  "a routine civic data candidate/version promotion";

type WritableEnvironment = Record<string, string | undefined>;

/**
 * Open the one sanctioned production destination for an explicit civic-data
 * promotion before any store is constructed or source request begins.
 *
 * Manual acquisition commands used to rely on a caller/preload to copy the
 * write handle into DATABASE_URL. That made the command printed in the
 * contract registry incomplete and made a failed source capable of losing its
 * durable attempt receipt. The command now establishes and proves its own
 * destination, while the existing write-handle and named-sanction refusals
 * remain the authorities for what may proceed.
 */
export function prepareProductionCivicDataWrite(
  env: WritableEnvironment = process.env,
): WriteHandle {
  const handle = resolveProductionWriteHandle(env);
  env.DATABASE_URL = handle.connection;
  env.WTP_DB_ROLE = "production";
  env.WTP_SANCTIONED_WRITE = CIVIC_DATA_PROMOTION_SANCTION;
  assertWriteAllowed(CIVIC_DATA_PROMOTION_OPERATION, env);
  return handle;
}
