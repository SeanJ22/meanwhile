import { currentMeasureRecords, MEASURE_RECORD_FIRST_SEED, type MeasureRecord, type ProvisionKind } from "./measure-records.ts";
export type { ProvisionKind } from "./measure-records.ts";

export const PROVISION_KIND_LABEL: Readonly<Record<ProvisionKind, string>> = {
  FUNDING: "Money",
  PROGRAM: "What it does",
  OVERSIGHT: "Who checks it",
  SUNSET: "When it ends or must be renewed",
  START: "When it starts",
};

/** `id` is `<contestId>#<slug>` and is never renumbered: a changed id orphans every reaction against it. */
export interface MeasureProvision {
  id: string;
  contestId: string;
  kind: ProvisionKind;
  label: string;
  what: string;
  citesUrl: string;
  writtenAt: string;
}

function provisions(records: readonly MeasureRecord[]): MeasureProvision[] {
  return records.flatMap(record => record.parts.map(part => ({
    id: part.id, contestId: record.contestId, kind: part.kind, label: part.label,
    what: part.what, citesUrl: record.sourceUrl, writtenAt: record.writtenAt,
  })));
}

export const MEASURE_PROVISIONS: MeasureProvision[] = provisions(MEASURE_RECORD_FIRST_SEED).map(part => ({
  ...part,
  get citesUrl(): string {
    const current = provisionById(part.id);
    if (!current) throw new Error(`No promoted measure provision: ${part.id}`);
    return current.citesUrl;
  },
}));

export function provisionsForContest(contestId: string, records: readonly MeasureRecord[] = currentMeasureRecords()): MeasureProvision[] {
  return provisions(records.filter(record => record.contestId === contestId));
}

export function provisionById(id: string, records: readonly MeasureRecord[] = currentMeasureRecords()): MeasureProvision | null {
  return provisions(records).find(part => part.id === id) ?? null;
}

export function getProvisionTargetIds(records: readonly MeasureRecord[] = currentMeasureRecords()): Set<string> {
  return new Set(provisions(records).map(part => part.id));
}
