import { readLearnedManualRoutes, type FieldManualRepos } from "../field-manual.ts";
import type { MethodMaturity } from "./dispatch.ts";

export async function methodMaturityFromManual(repos: FieldManualRepos,routeIds:readonly string[]): Promise<MethodMaturity> {
  const read=await readLearnedManualRoutes(repos,routeIds);
  if (!read.present) throw new Error("the field manual holds no learned routes. An empty manual would send every route to the bounded worker.");
  const known=new Set(read.routeIds);
  return route=>route!==null&&known.has(route)?"GRADUATED":"UNGRADUATED";
}
