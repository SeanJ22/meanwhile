import {
  resolveProductionWriteHandle,
  type WriteHandle,
} from "../db/write-handle.ts";
import { assertWriteAllowed } from "../db/write-guard.ts";

export const CIVIC_DATA_PROMOTION_SANCTION = "routine-civic-data-promotion";
export const CIVIC_DATA_PROMOTION_OPERATION =
  "a routine civic data candidate/version promotion";

type WritableEnvironment = Record<string, string | undefined>;

export function prepareProductionCivicDataWrite(
  env: WritableEnvironment = process.env,
): WriteHandle {
  const handle = resolveProductionWriteHandle(env);
  env.DATABASE_URL = handle.connection;
  if (env.WTP_RUNTIME_MODE === "staging") env.WTP_DB_ROLE = "local";
  else env.WTP_DB_ROLE = "production";
  env.WTP_SANCTIONED_WRITE = CIVIC_DATA_PROMOTION_SANCTION;
  assertWriteAllowed(CIVIC_DATA_PROMOTION_OPERATION, env);
  return handle;
}
