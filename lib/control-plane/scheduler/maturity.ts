import { readFieldManual, type FieldManualRepos } from "../field-manual.ts";
import { learnedRouteIds, ROUTE_ENTRY_KIND } from "../../method/manual-bridge.ts";
import type { MethodMaturity } from "./dispatch.ts";

/** Whether a route is graduated, read from the field manual's learned routes. An unreadable manual, or one with no learned routes, throws. */
export async function methodMaturityFromManual(repos: FieldManualRepos): Promise<MethodMaturity> {
  const read = await readFieldManual(repos, { kinds: [ROUTE_ENTRY_KIND], everywhere: true });
  if (read.error !== undefined) {
    throw new Error(`the field manual could not be read (${read.error}). This is a FAILED read and is raised rather than treated as an empty manual.`);
  }
  const known = learnedRouteIds(read.store);
  if (known.size === 0) {
    throw new Error("the field manual holds no learned routes. An empty manual would send every route to the bounded worker.");
  }
  return (route) => (route !== null && known.has(route) ? "GRADUATED" : "UNGRADUATED");
}
