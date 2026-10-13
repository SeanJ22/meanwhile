import { readZipEntries } from "../sources/archive.ts";
import { sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { fecRegistration, type FecDiscovery } from "./fec-discovery.ts";

export function fecBulkUrls(cycle: number): { master: string; summary: string } {
  const suffix = String(cycle).slice(-2), base = `https://www.fec.gov/files/bulk-downloads/${cycle}/`;
  return { master: `${base}cn${suffix}.zip`, summary: `${base}weball${suffix}.zip` };
}
export function fecBulkText(bytes: Uint8Array, member: string): string {
  const entries = readZipEntries(bytes, { maxEntries: 4, maxMemberBytes: 32 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024 });
  const entry = entries.find(row => row.name === member);
  if (!entry) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_BULK_MEMBER_MISSING");
  return entry.data.toString("utf8");
}
const lines = (text: string) => text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim()).map(line => line.split("|"));
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
export function parseFecBulk(master: string, summary: string, cycle: number, observedAt: string): FecDiscovery {
  const registrations = lines(master).flatMap(fields => {
    if (fields.length !== 15) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_BULK_MASTER_INVALID");
    if (Number(fields[3]) !== cycle || !["H", "S"].includes(fields[5])) return [];
    return [fecRegistration({ candidate_id: fields[0], name: fields[1], state: fields[4], office: fields[5],
      district: fields[6], election_years: [cycle], principal_committee_id: fields[9] }, cycle, observedAt)];
  });
  if (!registrations.length || new Set(registrations.map(row => row.candidateId)).size !== registrations.length) {
    throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_BULK_REGISTRATIONS_INVALID");
  }
  const byId = new Map(registrations.map(row => [row.candidateId, row]));
  const totals = lines(summary).flatMap(fields => {
    if (fields.length !== 30) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_BULK_SUMMARY_INVALID");
    const registered = byId.get(fields[0]);
    if (!registered) return [];
    if (registered.state !== fields[18] || registered.office === "H" && registered.district !== null && registered.district !== fields[19].padStart(2, "0")) {
      throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_BULK_SUMMARY_IDENTITY_INVALID");
    }
    return [{ candidate_id: fields[0], cycle, receipts: amount(fields[5]), disbursements: amount(fields[7]),
      last_cash_on_hand_end_period: amount(fields[10]), coverage_end_date: date(fields[27]) }];
  });
  return { registrations, totals, route: "bulk" };
}
