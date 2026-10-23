import { SourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";

export interface SamQuotaHold {
  readonly formatVersion: 1;
  readonly source: "sam-gov-entities";
  readonly publisherCode: "900804";
  readonly checkedAt: string;
  readonly retryAt: string;
}

export const SAM_QUOTA_KEY = "project/meanwhile/source/federal-money/sam-quota";

const instant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const nextUtcDay = (at: string) => { const date = new Date(at); date.setUTCHours(24, 0, 0, 0); return date.getTime(); };

export class SamQuotaFailure extends SourceAcquisitionFailure {
  readonly publisherCode = "900804";
  readonly checkedAt: string;
  readonly retryAt: string;
  constructor(hold: SamQuotaHold) {
    super("PUBLISHER_RESPONSE_REFUSED", `SAM.gov's daily request allowance was reached at ${hold.checkedAt}; requests resume at ${hold.retryAt}.`);
    this.name = "SamQuotaFailure";
    this.checkedAt = hold.checkedAt;
    this.retryAt = hold.retryAt;
  }
}

export async function readSavedSamQuota(vault: Pick<EvidenceStore, "get">): Promise<SamQuotaHold | null> {
  const saved = await vault.get(SAM_QUOTA_KEY);
  if (!saved) return null;
  if (saved.bytes.length > 1024) throw new Error("The saved SAM.gov request reset is invalid.");
  const value: unknown = JSON.parse(new TextDecoder().decode(saved.bytes));
  if (!value || typeof value !== "object") throw new Error("The saved SAM.gov request reset is invalid.");
  const row = value as Record<string, unknown>;
  if (row.formatVersion !== 1 || row.source !== "sam-gov-entities" || row.publisherCode !== "900804" || !instant(row.checkedAt) || !instant(row.retryAt) || Date.parse(row.retryAt) < nextUtcDay(row.checkedAt)) throw new Error("The saved SAM.gov request reset is invalid.");
  return { formatVersion: 1, source: "sam-gov-entities", publisherCode: "900804", checkedAt: row.checkedAt, retryAt: row.retryAt };
}

export async function saveSamQuota(vault: EvidenceStore, input: { readonly checkedAt: string; readonly retryAt: string }): Promise<SamQuotaHold> {
  if (!instant(input.checkedAt) || !instant(input.retryAt)) throw new Error("The SAM.gov request reset must use valid UTC timestamps.");
  const prior = await readSavedSamQuota(vault);
  const active = prior && Date.parse(prior.retryAt) > Date.parse(input.checkedAt) ? prior : null;
  const checkedAt = active && active.checkedAt < input.checkedAt ? active.checkedAt : input.checkedAt;
  const retryAt = new Date(Math.max(nextUtcDay(input.checkedAt), Date.parse(input.retryAt), active ? Date.parse(active.retryAt) : 0)).toISOString();
  const hold: SamQuotaHold = { formatVersion: 1, source: "sam-gov-entities", publisherCode: "900804", checkedAt, retryAt };
  const bytes = Buffer.from(JSON.stringify(hold));
  await vault.put(SAM_QUOTA_KEY, bytes, { contentType: "application/json", contentHash: "manifest:sam-quota", byteLength: bytes.length, objectClass: "MUTABLE_INDEX" });
  return hold;
}

export async function requireSamQuotaAvailable(vault: EvidenceStore, now: string): Promise<void> {
  const hold = await readSavedSamQuota(vault);
  if (hold && Date.parse(now) < Date.parse(hold.retryAt)) throw new SamQuotaFailure(hold);
}

function publisherTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  let text = value.trim().replace(/\s+UTC$/i, "");
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) text = text.replace(" ", "T") + "Z";
  const direct = Date.parse(text);
  if (Number.isFinite(direct)) return direct;
  const match = /^(\d{4})-([A-Za-z]+)-(\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(text);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = match ? months.indexOf(match[2].slice(0, 3).toLowerCase()) + 1 : 0;
  if (!match || !month) return null;
  const parsed = Date.parse(`${match[1]}-${String(month).padStart(2, "0")}-${match[3]}T${match[4]}${match[5] ?? ""}${match[6] ?? "Z"}`);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function recordSamQuotaResponse(vault: EvidenceStore, body: unknown, checkedAt: string, retryAfter: string | null): Promise<void> {
  if (!body || typeof body !== "object" || String((body as Record<string, unknown>).code) !== "900804") return;
  const row = body as Record<string, unknown>;
  const description = typeof row.description === "string" ? row.description.match(/\d{4}-(?:\d{2}|[A-Za-z]+)-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?(?:\s+UTC)?/)?.[0] : null;
  const seconds = retryAfter !== null && /^\d+(?:\.\d+)?$/.test(retryAfter.trim()) ? Number(retryAfter) : null;
  const times = [nextUtcDay(checkedAt), publisherTime(row.nextAccessTime), publisherTime(description), seconds === null ? publisherTime(retryAfter) : Date.parse(checkedAt) + seconds * 1000];
  const retryAt = new Date(Math.max(...times.filter((value): value is number => value !== null && Number.isFinite(value)))).toISOString();
  throw new SamQuotaFailure(await saveSamQuota(vault, { checkedAt, retryAt }));
}
