import type { EvidenceRecord } from "@/lib/ask/evidence";
import { hostOf } from "@/lib/ask/host";
import { formatDateMDY } from "@/lib/map/format";

function RecordContents({ record }: { record: EvidenceRecord }) {
  return (
    <>
      <p>{record.text}</p>
      {record.sourceUrl ? (
        <a href={record.sourceUrl} target="_blank" rel="noreferrer noopener"
          className="text-[0.6875rem] text-link underline decoration-dotted underline-offset-2">
          {record.sourceOrg ?? hostOf(record.sourceUrl)}
        </a>
      ) : record.sourceOrg ? <span className="text-[0.6875rem] text-muted">{record.sourceOrg}</span> : null}
      {record.retrievedAt && <span className="text-[0.625rem] text-muted"> · Read {formatDateMDY(record.retrievedAt.slice(0, 10))}</span>}
    </>
  );
}

/** Every grounded record remains reachable, including when prose is available. */
export function AskAnswerRecords({ records, initiallyOpen }: { records: readonly EvidenceRecord[]; initiallyOpen: boolean }) {
  const visible = records.filter((record) => record.kind !== "CONTACT");
  if (!visible.length) return null;

  // ASK-24: when there is no generated answer, the held plain-language
  // definition leads. Move its record out of the detail list without copying
  // or rewriting it; procedure and official text remain one disclosure away.
  const summaries = initiallyOpen ? visible.filter((record) => record.kind === "MEASURE_SUMMARY") : [];
  const detailRecords = summaries.length ? visible.filter((record) => record.kind !== "MEASURE_SUMMARY") : visible;
  const disclosure = detailRecords.length > 0 ? (
    <details className="mt-2" open={initiallyOpen && summaries.length === 0}
      data-ask-record-count={summaries.length ? undefined : visible.length}
      data-ask-detail-count={summaries.length ? detailRecords.length : undefined}>
      <summary className="cursor-pointer text-[0.6875rem] text-link">
        {summaries.length ? "Further records" : "Records"} ({detailRecords.length})
      </summary>
      <ul className="mt-1.5 max-h-80 space-y-2 overflow-y-auto overscroll-contain">
        {detailRecords.map((record, index) => (
          <li key={`${record.kind}:${record.id}:${index}`} data-ask-record-id={record.id}
            className="border-l-2 border-[var(--panel-border)] pl-3 text-[0.75rem] leading-relaxed text-paper-dim">
            <RecordContents record={record} />
          </li>
        ))}
      </ul>
    </details>
  ) : null;

  if (!summaries.length) return disclosure;
  return (
    <div data-ask-record-count={visible.length}>
      <ul className="mt-2 space-y-2" data-ask-measure-summary>
        {summaries.map((record, index) => (
          <li key={`${record.kind}:${record.id}:${index}`} data-ask-record-id={record.id}
            className="rounded-md bg-[var(--surface)] p-3 text-[0.8125rem] leading-relaxed text-paper">
            <p className="t-eyebrow mb-1.5 text-muted">Plain-language summary</p>
            <RecordContents record={record} />
          </li>
        ))}
      </ul>
      {disclosure}
    </div>
  );
}
