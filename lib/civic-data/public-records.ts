import type { PublicRecord } from "./types.ts";
import { publicRecordIssue } from "./public-record-contract.ts";
export { publicRecordIssue } from "./public-record-contract.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "./read-model.ts";
import { scopedManualContractScope } from "./scoped-manual-contracts.ts";
import { addUpdates } from "../control-plane/updates.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { createHash } from "node:crypto";
import { newFieldManualEntry, writeFieldManual } from "../control-plane/field-manual.ts";
import { readPublicKindOwed } from "../coverage/public-kind-owed.ts";


export async function readPublicRecords(ocdId: string, options: PromotedCivicDataReadOptions = {}) {
  const read = await readPromotedCivicData<{ kind: "public-records"; records: readonly PublicRecord[] }>("CURATED_READER_RECORD",
    scopedManualContractScope("public-records", ocdId), options);
  if (read.kind === "PROMOTED" && (read.value.kind !== "public-records" || !Array.isArray(read.value.records) ||
    read.value.records.some(row => publicRecordIssue(row) || row.ocdId !== ocdId))) throw new Error("Published public records have invalid source or jurisdiction identity.");
  return read;
}

export async function recordNewPublicKinds(repos: Pick<ControlPlaneRepositories, "adminConfig" | "fieldManual">, records: readonly PublicRecord[], now: string) {
  if (!records.length) return;
  if (records.some(publicRecordIssue)) throw new Error("Unverified public kind cannot create owed work.");
  const entries = records.map(row => newFieldManualEntry("public-record-kinds", createHash("sha256")
    .update(row.kindLabel.normalize("NFKC").toLowerCase().trim()).digest("hex"), {
      role: "SHARED", kind: "PUBLIC_RECORD_KIND", title: row.kindLabel, summary: `Source kind: ${row.kindLabel}`, outcome: "YIELDED",
      url: row.sourceUrl, observedAt: now, recordClasses: ["PUBLIC_RECORD"], portable: true, payload: { kindLabel: row.kindLabel },
    }));
  const [heldKinds, owed] = await Promise.all([
    repos.fieldManual.readMany([...new Set(entries.map(entry => entry.id))]),
    readPublicKindOwed(repos, [...new Set(records.map(row => row.ocdId))]),
  ]);
  const known = new Set(heldKinds.map(entry => entry.id));
  const fresh = entries.filter(entry => !known.has(entry.id));
  const places = new Map<string, PublicRecord>();
  for (const row of records) {
    const key = JSON.stringify([row.ocdId, row.kindLabel.normalize("NFKC").toLowerCase().trim()]);
    if (!places.has(key)) places.set(key, row);
  }
  const knownPlaces = new Set(owed.map(value => JSON.stringify([value.divisionId, value.kindLabel.normalize("NFKC").toLowerCase().trim()])));
  const placeEntries = [...places].filter(([key]) => !knownPlaces.has(key)).map(([key,row]) => newFieldManualEntry("public-place-kinds",
    createHash("sha256").update(JSON.stringify([key,now])).digest("hex"), {
      role:"SHARED",kind:"PUBLIC_RECORD_PLACE_KIND",title:row.kindLabel,summary:`Keep ${row.kindLabel} current`,outcome:"YIELDED",
      url:row.sourceUrl,observedAt:now,recordClasses:["PUBLIC_RECORD"],ocdIds:[row.ocdId],
      payload:{divisionId:row.ocdId,kindLabel:row.kindLabel,owedSince:now,sourceUrl:row.sourceUrl,firstRecordId:row.id},
    }));
  await addUpdates(repos, fresh.map(entry => ({ id: `public-kind:${entry.id}`, what: `New kind found: ${entry.title}`,
    at: now, label: "TESTING", evidenceHref: entry.url, after: records.find(row => row.kindLabel === entry.title)?.title })), now);
  const saved = await writeFieldManual(repos, [...fresh,...placeEntries], now);
  if (saved.error) throw new Error(saved.error);
}
