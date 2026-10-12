import type { SeatHolder } from "../../officials/lookup.ts";
import { seatHolderById } from "../../registry/server.ts";
import { readerPersonKeys } from "../../identity/reader-person.ts";
import type { EvidenceRecord } from "../../ask/evidence.ts";
import { readPrlPerson, type PrlPersonKeys, type PrlPersonRead } from "./reader.ts";
import { normalize, searchTerms } from "../../corpus/positions.ts";

/** Exact publisher IDs reach PRL; a display name never chooses an archive partition. */
export function prlPersonKeys(subjectId: string, holder?: SeatHolder | null): PrlPersonKeys {
  const ids = holder?.nativeIds ?? {};
  const unique = (values: readonly string[]) => new Set(values).size === 1 ? values[0] : undefined;
  const uuid = /^plural:(?:[a-z]{2}:)?([0-9a-f-]{36})$/.exec(subjectId)?.[1];
  return {
    bioguideId: /^congress:([A-Z]\d{6})$/.exec(subjectId)?.[1] ?? unique(ids.bioguide ?? ids.congress ?? []),
    openstatesId: uuid ? `ocd-person/${uuid}` : unique(ids["ocd-person"] ?? ids.openstates ?? []),
    candidateId: /^fec:([HSP][A-Z0-9]{8})$/.exec(subjectId)?.[1] ?? unique(ids.fec ?? []),
  };
}

export async function readPrlForSubject(subjectId: string, knownHolder?: SeatHolder | null): Promise<PrlPersonRead> {
  let holder = knownHolder;
  if (!holder) {
    let keys = [subjectId];
    try { keys = readerPersonKeys(subjectId).keys; } catch { /* Source-native keys remain independently readable. */ }
    const reads = await Promise.allSettled(keys.map(key => seatHolderById(key)));
    const found = new Map(reads.flatMap(read => read.status === "fulfilled" && read.value ? [[read.value.id, read.value] as const] : []));
    if (found.size === 1) holder = [...found.values()][0];
  }
  return readPrlPerson(prlPersonKeys(holder?.id ?? subjectId, holder));
}

export function prlStatementEvidence(subjectId: string, read: PrlPersonRead, question?: string, name = ""): EvidenceRecord[] {
  const names = new Set(searchTerms(name));
  const topic = question ? searchTerms(question).filter(term => !names.has(term) && !/^(?:believe|believes|support|supports|oppose|opposes|published|statement|statements|latest|recent|public)$/.test(term)) : [];
  return read.statements.filter(row => topic.every(term => normalize(row.text).includes(term))).map(row => ({ kind: "SOURCE_PASSAGE", id: row.id, subjectId, text: row.text,
    sourceUrl: row.sourceUrl, sourceOrg: row.sourceLabel, retrievedAt: row.retrievedAt,
    verifiedStatement: { speakerId: subjectId, quote: row.text, date: row.date.slice(0, 10),
      attribution: row.attribution.text, nativeSourceId: row.id } }));
}
