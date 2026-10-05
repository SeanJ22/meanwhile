import { FINANCE_DOOR_KINDS } from "./finance-door-reader.ts";
import type { DoorRecord } from "../doors/registry.ts";
export interface FinanceDoorDetailSource {
  readonly doorId: string; readonly kind: string; readonly ocdId: string;
  readonly hosts: readonly string[];
  readonly config: Readonly<Record<string, string>>;
  readonly committeeId: string; readonly candidateName: string; readonly office: string; readonly electionYear: number;
}
const allowed = new Set(["fieldMap", "rowsPath", "totalPath", "fileName", "organizationFieldMap", "keyRef", "keyParam", "keyHeader"]);
export function financeDoorDetailSource(door: DoorRecord, identity: Pick<FinanceDoorDetailSource, "committeeId" | "candidateName" | "office" | "electionYear">): FinanceDoorDetailSource {
  const source = { doorId: door.doorId, kind: door.kind, ocdId: door.ocdId!, hosts: door.hosts,
    config: Object.fromEntries(Object.entries(door.config).filter(([key, value]) => allowed.has(key) && typeof value === "string")) as Record<string, string>, ...identity };
  if (!validFinanceDoorDetailSource(source)) throw new Error("Finance detail lacks a held source mapping and exact filing identity.");
  return source;
}
export function validFinanceDoorDetailSource(value: unknown): value is FinanceDoorDetailSource {
  const s = value as FinanceDoorDetailSource;
  return Boolean(s && (FINANCE_DOOR_KINDS as readonly string[]).includes(s.kind) &&
    [s.doorId, s.ocdId, s.committeeId, s.candidateName, s.office].every(v => typeof v === "string" && v.trim()) &&
    Number.isSafeInteger(s.electionYear) && s.electionYear >= 1900 && Array.isArray(s.hosts) && s.hosts.length &&
    s.hosts.every(h => typeof h === "string" && /^[a-z0-9.-]+$/.test(h)) && s.config && typeof s.config === "object" && !Array.isArray(s.config) &&
    Object.entries(s.config).every(([k, v]) => allowed.has(k) && typeof v === "string") && typeof s.config.fieldMap === "string" &&
    (!s.config.keyRef || /^[A-Z][A-Z0-9_]*(?:API_KEY|APP_TOKEN)$/.test(s.config.keyRef)) &&
    (!s.config.keyParam || /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(s.config.keyParam)) &&
    (!s.config.keyHeader || /^[a-zA-Z][a-zA-Z0-9-]*$/.test(s.config.keyHeader)));
}
