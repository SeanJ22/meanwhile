import type { PublicRecord } from "@/lib/civic-data/types";

/** The place caller supplies only records for the exact division on screen. */
export function PublicRecords({ divisionId, records }: { divisionId: string; records: readonly PublicRecord[] }) {
  const held = records.filter(record => record.ocdId === divisionId);
  if (!held.length) return null;
  return <section aria-label="Public records">{held.map(record => <article key={record.id}>
    <p>{record.kindLabel}</p><h3>{record.title}</h3><p>{record.sourceSentence}</p>
    <a href={record.sourceUrl} target="_blank" rel="noopener noreferrer">Source</a>
  </article>)}</section>;
}
