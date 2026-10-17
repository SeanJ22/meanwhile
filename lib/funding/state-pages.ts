import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { federalMoneyArtifactHash, federalMoneyArtifactKey } from "../federal-money/edge.ts";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import { campaignSourceRecordHash, type CampaignSourceRecord } from "./state-source-records.ts";

export interface CampaignFinancePageRef { readonly key: string; readonly hash: string; readonly count: number }

export async function readCampaignFinancePage(store: ReaderArtifactStore, ref: CampaignFinancePageRef, state: string): Promise<readonly CampaignSourceRecord[]> {
  if (!federalMoneyArtifactKey(ref.key) || !ref.key.endsWith(".json.gz") || !Number.isInteger(ref.count) || ref.count < 1 || ref.count > 100) throw new Error("Campaign page reference is invalid.");
  const bytes = await store.readBytes(ref.key);
  if (!bytes || !ref.key.includes(federalMoneyArtifactHash(bytes))) throw new Error("Campaign page bytes differ from their content hash.");
  const value = JSON.parse(gunzipSync(bytes, { maxOutputLength: 16 * 1024 * 1024 }).toString("utf8"));
  if (value.state !== state || !Array.isArray(value.records) || value.records.length !== ref.count ||
      value.records.some((row: CampaignSourceRecord, index: number) => row.state !== state || index > 0 && value.records[index - 1].id >= row.id)) throw new Error("Campaign page crosses its state or native row order.");
  const digest = createHash("sha256");
  for (const row of value.records) digest.update(campaignSourceRecordHash(row)).update("\n");
  if (digest.digest("hex") !== ref.hash) throw new Error("Campaign page native facts differ from their publication.");
  return value.records;
}
