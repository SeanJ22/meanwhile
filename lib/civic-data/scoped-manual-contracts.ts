import { jurisdictionFromOcdId } from "../coverage/states.ts";

const PREFIXES: Readonly<Record<string, string>> = {
  "plain-english-translations": "US:plain-english-translations",
  "public-records": "US:public-records",
  "government-budgets": "US:government-budgets",
};
const jurisdictionIsValid = (id: string, ocdId: string) => Boolean(jurisdictionFromOcdId(ocdId) ||
  id !== "plain-english-translations" && ocdId === "ocd-division/country:us");

/** These families publish and read one exact jurisdiction, never a nationwide payload. */
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
  const records = (payload as { records?: readonly { ocdId?: string }[] })?.records;
  const division = records?.[0]?.ocdId;
  if (!division || records?.some(row => row.ocdId !== division)) throw new Error("Scoped publication contains different jurisdictions.");
  return scopedManualContractScope(id, division);
}
