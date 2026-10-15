import { jurisdictionFromOcdId } from "../coverage/states.ts";

const PREFIXES: Readonly<Record<string, string>> = {
  "venue-resolutions": "US:venue-resolutions",
  "plain-english-translations": "US:plain-english-translations",
  "special-district-boundaries": "US:special-district-boundaries",
  "public-records": "US:public-records",
  "government-budgets": "US:government-budgets",
  "campaign-finance": "US:campaign-finance",
};
const jurisdictionIsValid = (id: string, ocdId: string) => Boolean((id === "venue-resolutions" && /^tenant:[a-z0-9][a-z0-9_-]*$/i.test(ocdId)) || jurisdictionFromOcdId(ocdId) ||
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
  const records = (payload as { records?: readonly { ocdId?: string; bodyOcdId?: string; tenant?: string }[] })?.records;
  const scopeOf = (row: { ocdId?: string; bodyOcdId?: string; tenant?: string }) => id === "venue-resolutions" ? row.bodyOcdId ?? (row.tenant ? `tenant:${row.tenant}` : undefined) : row.ocdId;
  const division = records?.[0] ? scopeOf(records[0]) : undefined;
  if (!division || records?.some(row => scopeOf(row) !== division)) throw new Error("Scoped publication contains different jurisdictions.");
  return scopedManualContractScope(id, division);
}
