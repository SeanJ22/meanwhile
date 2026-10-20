import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { openZipFile } from "../sources/archive.ts";
import { decodeUtf8 } from "../sources/prl/streaming.ts";
import { requireRegistryState } from "../civic-data/state-scopes.ts";
import { sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { fecRegistration, type FecDiscovery } from "./fec-discovery.ts";

export function fecBulkUrls(cycle: number): { master: string; summary: string } {
  const suffix = String(cycle).slice(-2), base = `https://www.fec.gov/files/bulk-downloads/${cycle}/`;
  return { master: `${base}cn${suffix}.zip`, summary: `${base}weball${suffix}.zip` };
}
/** Both official ZIP members and captured plain fixtures stream one native row.
 * ZIP metadata stays bounded; the member stream verifies its own full CRC. */
export async function* fecBulkRecords(path: string, member: string): AsyncGenerator<string[]> {
  const file = await open(path, "r"), signature = Buffer.alloc(2);
  try { await file.read(signature, 0, 2, 0); } finally { await file.close(); }
  const entries = signature.toString("ascii") === "PK" ? await openZipFile(path, { maxEntries: 4, maxMemberBytes: Number.MAX_SAFE_INTEGER, maxTotalBytes: Number.MAX_SAFE_INTEGER }) : null;
  const entry = entries?.find(row => row.name === member);
  if (entries && !entry) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_BULK_MEMBER_MISSING");
  let pending = "", first = true;
  for await (const chunk of decodeUtf8(entry ? entry.stream() : createReadStream(path))) {
    pending += chunk;
    for (;;) {
      const end = pending.indexOf("\n"); if (end < 0) break;
      let line = pending.slice(0, end).replace(/\r$/, ""); pending = pending.slice(end + 1);
      if (first) { line = line.replace(/^\uFEFF/, ""); first = false; }
      if (line.trim()) yield line.split("|");
    }
    if (pending.length > 4 * 1024 * 1024) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_BULK_ROW_INVALID");
  }
  if (pending.trim()) yield pending.replace(/\r$/, "").split("|");
}
function amount(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(Number(value))) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_BULK_AMOUNT_INVALID");
  return Number(value);
}
function date(value: string): string | null {
  if (!value) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_BULK_DATE_INVALID");
  return `${match[3]}-${match[1]}-${match[2]}`;
}
/** FEC cn (15 columns) and current weball (30), joined only by CAND_ID.
 * weball carries total individual money, not the two small-donor lines. */
export async function parseFecBulk(masterPath: string, summaryPath: string, cycle: number, observedAt: string, selectedState: string): Promise<FecDiscovery> {
  const state = requireRegistryState(selectedState), registrations: FecDiscovery["registrations"] = [];
  for await (const fields of fecBulkRecords(masterPath, "cn.txt")) {
    if (fields.length !== 15) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_BULK_MASTER_INVALID");
    if (fields[4] !== state || Number(fields[3]) !== cycle || !["H", "S"].includes(fields[5])) continue;
    registrations.push(fecRegistration({ candidate_id: fields[0], name: fields[1], state: fields[4], office: fields[5],
      district: fields[6], election_years: [cycle], principal_committee_id: fields[9] }, cycle, observedAt));
  }
  if ( new Set(registrations.map(row => row.candidateId)).size !== registrations.length) {
    throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_BULK_REGISTRATIONS_INVALID");
  }
  const byId = new Map(registrations.map(row => [row.candidateId, row]));
  const totals: FecDiscovery["totals"] = [];
  for await (const fields of fecBulkRecords(summaryPath, `weball${String(cycle).slice(-2)}.txt`)) {
    if (fields.length !== 30) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_BULK_SUMMARY_INVALID");
    const registered = byId.get(fields[0]);
    if (!registered) continue;
    if (registered.state !== fields[18] || registered.office === "H" && registered.district !== null && registered.district !== fields[19].padStart(2, "0")) {
      throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_BULK_SUMMARY_IDENTITY_INVALID");
    }
    totals.push({ candidate_id: fields[0], cycle, receipts: amount(fields[5]), disbursements: amount(fields[7]),
      last_cash_on_hand_end_period: amount(fields[10]), coverage_end_date: date(fields[27]) });
  }
  return { registrations, totals, route: "bulk" };
}
