import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { canonicalCivicDataHash } from "./canonical-hash.ts";

export const STATE_RETIREMENT_KEY_ENV = "WTP_STATE_RETIREMENT_KEY";
type UnitSeal = { readonly fileSha256: string; readonly originId: string; readonly originRecordClass: string;
  readonly originScope: string; readonly originReadModelHash: string; readonly state: string; readonly contractId: string };

export function sealStateRetirementUnit(unit: UnitSeal, env: NodeJS.ProcessEnv = process.env): string {
  const key = env[STATE_RETIREMENT_KEY_ENV];
  if (!key || !/^[a-f0-9]{64}$/.test(key)) throw new Error("STATE_RETIREMENT_PRODUCER_KEY_MISSING");
  return createHmac("sha256", Buffer.from(key, "hex")).update(canonicalCivicDataHash(unit)).digest("hex");
}

export function verifyStateRetirementUnitSeal(unit: UnitSeal, seal: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!/^[a-f0-9]{64}$/.test(seal) || !timingSafeEqual(Buffer.from(sealStateRetirementUnit(unit, env), "hex"), Buffer.from(seal, "hex")))
    throw new Error("STATE_RETIREMENT_UNIT_SEAL_INVALID");
}

type Row = Record<string, unknown>;
const retirementObject = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};

export function retirementMemberKey(path: readonly string[], value: unknown): string {
  const row = retirementObject(value), field = path.at(-1);
  const text = (value: unknown) => typeof value === "string" ? value : "";
  if (field === "absences") return `${text(row.ocdId)}:${text(row.statement)}`;
  if (field === "bodyRosters") return text(row.bodyId);
  if (field === "statewideExecutives") return `${text(row.stateOcdId)}:${text(retirementObject(row.holder).id)}`;
  if (field === "rows" && path.includes("officialCandidacies")) return text(retirementObject(row.holder).id);
  if (field === "rows" && path.includes("lineupReconciliation")) return text(row.cardKey);
  if (field === "rosterReaderDispositions") return text(row.sourceId);
  if (field === "hunts") return `${text(row.key)}:${text(row.attemptedAt)}:${text(row.note)}`;
  if (field === "failures") return `${text(row.candidateKey)}:${text(row.documentUrl)}:${text(row.attemptedAt)}:${text(row.reason)}`;
  return text(row.id) || text(row.candidacyId) || text(row.officeholderId) || text(row.contestId) || text(row.ocdId)
    || text(row.cardKey) || text(row.bodyId) || text(retirementObject(row.holder).id) || text(row.sourceId) || createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
