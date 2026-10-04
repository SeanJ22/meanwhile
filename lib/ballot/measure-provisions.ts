import { currentMeasureRecords, MEASURE_RECORD_FIRST_SEED, type MeasureRecord, type ProvisionKind } from "./measure-records.ts";
export type { ProvisionKind } from "./measure-records.ts";

export const PROVISION_KIND_LABEL: Readonly<Record<ProvisionKind, string>> = {
  FUNDING: "Money",
  PROGRAM: "What it does",
  OVERSIGHT: "Who checks it",
  SUNSET: "When it ends or must be renewed",
  START: "When it starts",
};

export interface MeasureProvision {
  /**
   * The reaction target key, and the reason this file exists at all.
   *
   * Shaped `<contestId>#<slug>` so a reaction row names the measure and the
   * provision in one column, and so a provision that is later re-worded keeps
   * its identity. NEVER renumber one: a changed id silently orphans every
   * reaction already collected against it.
   */
  id: string;
  contestId: string;
  kind: ProvisionKind;
  /** A short plain-language name for the provision. The 15-year-old test. */
  label: string;
  /** What this provision would do. Plain language, from the cited analysis. */
  what: string;
  /** The official analysis this was written from — the citation. */
  citesUrl: string;
  writtenAt: string;
}

function provisions(records: readonly MeasureRecord[]): MeasureProvision[] {
  return records.flatMap(record => record.parts.map(part => ({
    id: part.id, contestId: record.contestId, kind: part.kind, label: part.label,
    what: part.what, citesUrl: record.sourceUrl, writtenAt: record.writtenAt,
  })));
}

/** Immutable seed compatibility; runtime consumers read their loaded ballot records. */
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
