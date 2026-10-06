import type { EvidenceRecord } from "@/lib/ask/evidence";
import { hostOf } from "@/lib/ask/host";
import { formatDateMDY } from "@/lib/map/format";

function RecordContents({ record }: { record: EvidenceRecord }) {
  return (
    <>
      <p>{record.text}</p>
      {record.sourceUrl ? (
        <a href={record.sourceUrl} target="_blank" rel="noreferrer noopener"
          className="t-caption text-link underline decoration-dotted underline-offset-2">
          {record.sourceOrg ?? hostOf(record.sourceUrl)}
        </a>
      ) : record.sourceOrg ? <span className="t-caption text-muted">{record.sourceOrg}</span> : null}
      {record.retrievedAt && <span className="t-caption text-muted"> · Read {formatDateMDY(record.retrievedAt.slice(0, 10))}</span>}
    </>
  );
}

/** Every grounded record remains reachable, including when prose is available. */
export function AskAnswerRecords({ records, initiallyOpen, agendaLead = false, prose }: { records: readonly EvidenceRecord[]; initiallyOpen: boolean; agendaLead?: boolean; prose?: string | null }) {
  const visible = records.filter((record) => record.kind !== "CONTACT");
  if (!visible.length) return null;
  const agenda = agendaLead ? visible.filter(record => ["MEETING", "AGENDA_ITEM", "AGENDA_DOCUMENT", "MEETING_NOTICE_SUMMARY"].includes(record.kind)) : [];
  const remaining = visible.filter(record => !agenda.includes(record));

  // ASK-24: when there is no generated answer, the held plain-language
  // definition leads. Move its record out of the detail list without copying
  // or rewriting it; procedure and official text remain one disclosure away.
  const summaries = initiallyOpen ? remaining.filter((record) => record.kind === "MEASURE_SUMMARY") : [];
  const detailRecords = summaries.length ? remaining.filter((record) => record.kind !== "MEASURE_SUMMARY") : remaining;
  const disclosure = detailRecords.length > 0 ? (
    <details className="mt-2" open={initiallyOpen && summaries.length === 0}
      data-ask-record-count={summaries.length ? undefined : visible.length}
      data-ask-detail-count={summaries.length ? detailRecords.length : undefined}>
      <summary className="cursor-pointer t-caption text-link">
        {summaries.length ? "Further records" : "Records"} ({detailRecords.length})
      </summary>
      <ul className="mt-1.5 max-h-80 space-y-2 overflow-y-auto overscroll-contain">
        {detailRecords.map((record, index) => (
          <li key={`${record.kind}:${record.id}:${index}`} data-ask-record-id={record.id}
            className="border-l-2 border-[var(--panel-border)] pl-3 t-detail leading-relaxed text-paper-dim">
            <RecordContents record={record} />
          </li>
        ))}
      </ul>
    </details>
  ) : null;

  if (agendaLead) return <div data-ask-record-count={visible.length}>
    {agenda.length > 0 && <section data-ask-agenda-lead className="mt-2">
      <p className="t-eyebrow mb-2 text-muted">Held meeting and agenda records</p>
      <ul className="max-h-80 space-y-2 overflow-y-auto overscroll-contain">
        {agenda.map((record, index) => <li key={`${record.kind}:${record.id}:${index}`} data-ask-record-id={record.id}
          data-ask-meeting-id={record.meetingId ?? (record.kind === "MEETING" ? record.id : undefined)}
          data-ask-document-id={record.documentId}
          className="border-l-2 border-[var(--panel-border)] pl-3 t-body leading-relaxed text-paper">
          <RecordContents record={record} />
        </li>)}
      </ul>
    </section>}
    {prose && <p className="mt-2 t-body leading-relaxed text-paper-dim">{prose}</p>}
    {disclosure}
  </div>;
  if (!summaries.length) return disclosure;
  return (
    <div data-ask-record-count={visible.length}>
      <ul className="mt-2 space-y-2" data-ask-measure-summary>
        {summaries.map((record, index) => (
          <li key={`${record.kind}:${record.id}:${index}`} data-ask-record-id={record.id}
            className="rounded-md bg-[var(--surface)] p-3 t-body leading-relaxed text-paper">
            <p className="t-eyebrow mb-1.5 text-muted">Plain-language summary</p>
            <RecordContents record={record} />
          </li>
        ))}
      </ul>
      {disclosure}
    </div>
  );
}
