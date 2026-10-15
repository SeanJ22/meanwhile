import { jurisdictionFromOcdId } from "../coverage/states.ts";

const PREFIXES: Readonly<Record<string, string>> = {
  "ballot-measures": "US:ballot-measures",
  "plain-english-translations": "US:plain-english-translations",
  "special-district-boundaries": "US:special-district-boundaries",
  "public-records": "US:public-records",
  "government-budgets": "US:government-budgets",
  "campaign-finance": "US:campaign-finance",
};
const jurisdictionIsValid = (id: string, ocdId: string) => Boolean(jurisdictionFromOcdId(ocdId) ||
  !["plain-english-translations", "campaign-finance", "special-district-boundaries"].includes(id) && ocdId === "ocd-division/country:us");

export function scopedManualContractScope(id: string, ocdId: string): string {
  if (!PREFIXES[id] || !jurisdictionIsValid(id, ocdId)) throw new Error("Scoped publication requires one US jurisdiction.");
  return `${PREFIXES[id]}:${ocdId}`;
}
export function isScopedManualContractScope(id: string, scope: string): boolean {
  const prefix = PREFIXES[id];
  return Boolean(prefix && scope.startsWith(`${prefix}:`) && jurisdictionIsValid(id, scope.slice(prefix.length + 1)));
}
export function manualPayloadScope(id: string, fallback: string, payload: unknown): string {
  if (!PREFIXES[id]) return fallback;
  if (id === "ballot-measures") {
    const value = payload as { ocdId?: string; ballots?: Record<string, { contests?: { ocdId: string }[] }> };
    if (!value.ocdId || !value.ballots || Object.values(value.ballots).some(ballot => ballot.contests?.some(contest => contest.ocdId !== value.ocdId))) {
      throw new Error("Local measure publication contains different jurisdictions.");
    }
    return scopedManualContractScope(id, value.ocdId);
  }
  const records = (payload as { records?: readonly { ocdId?: string }[] })?.records;
  const division = records?.[0]?.ocdId;
  if (!division || records?.some(row => row.ocdId !== division)) throw new Error("Scoped publication contains different jurisdictions.");
  return scopedManualContractScope(id, division);
}
