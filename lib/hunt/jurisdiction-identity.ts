import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { countyIdentity, stateBase } from "../ocd/divisions.ts";
import type { Jurisdiction } from "./jurisdiction-universe.ts";

type GovernmentIdentity = Pick<Jurisdiction, "id" | "stateCode" | "govClass" | "countyName" | "ocdId" | "bodyId">;

/** Reviewed county rows and native geography use the same Census county name and state. */
export function jurisdictionMatchesSubject(row: GovernmentIdentity, subjectId: string): boolean {
  if (row.id === subjectId || row.ocdId === subjectId || row.bodyId === subjectId) return true;
  const state = jurisdictionFromOcdId(subjectId);
  if (!state || state.usps !== row.stateCode.toUpperCase()) return false;
  if (row.govClass === "STATE") return stateBase(state.fips)?.base === subjectId;
  return row.govClass === "COUNTY" && Boolean(row.countyName) && countyIdentity(state.fips, row.countyName!)?.ocdId === subjectId;
}

/** A bare county government, excluding its cities, districts and board suffixes. */
export function countySubject(state: string, subjectId: string): string | null {
  const own = jurisdictionFromOcdId(subjectId), county = /^ocd-division\/country:us\/state:[a-z]{2}\/county:([a-z0-9]+(?:_[a-z0-9]+)*)$/.exec(subjectId)?.[1];
  return own?.usps.toLowerCase() === state.toLowerCase() && county ? county : null;
}
