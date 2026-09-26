/** Private collector-only reload. Never imports this module from a browser entry. */
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parseEnv } from "node:util";
import { BILLING_SECRET_NAMES, withoutBillingSecrets } from "./provider-billing.ts";

export const BILLING_ENV_FILE = "WTP_BILLING_ENV_FILE";

/** Only five reporting credentials are refreshed; search/model/DB settings stay put. */
export function billingCollectorEnvironment(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const path = parent[BILLING_ENV_FILE];
  if (!path) return { ...parent };
  if (!isAbsolute(path)) throw new Error("REPORT_ENV_PATH_NOT_ABSOLUTE");
  let file: Record<string, string | undefined>;
  try { file = parseEnv(readFileSync(path, "utf8")); }
  catch { throw new Error("REPORT_ENV_FILE_UNREADABLE"); }
  const env = withoutBillingSecrets(parent);
  for (const name of BILLING_SECRET_NAMES) if (file[name]?.trim()) env[name] = file[name];
  return env;
}
