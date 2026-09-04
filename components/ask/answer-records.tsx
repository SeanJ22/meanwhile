import type { EvidenceRecord } from "@/lib/ask/evidence";
import { hostOf } from "@/lib/ask/host";
import { formatDateMDY } from "@/lib/map/format";

/** Every grounded record remains reachable, including when prose is available. */
export function AskAnswerRecords({ records, initiallyOpen }: { records: readonly EvidenceRecord[]; initiallyOpen: boolean }) {
  const visible = records.filter((record) => record.kind !== "CONTACT");
  if (!visible.length) return null;
  return (
    <details className="mt-2" open={initiallyOpen} data-ask-record-count={visible.length}>
      <summary className="cursor-pointer text-[0.6875rem] text-link">Records ({visible.length})</summary>
      <ul className="mt-1.5 max-h-80 space-y-2 overflow-y-auto overscroll-contain">
        {visible.map((record, index) => (
          <li key={`${record.kind}:${record.id}:${index}`} data-ask-record-id={record.id}
            className="border-l-2 border-[var(--panel-border)] pl-3 text-[0.75rem] leading-relaxed text-paper-dim">
            <p>{record.text}</p>
            {record.sourceUrl && (
              <a href={record.sourceUrl} target="_blank" rel="noreferrer noopener"
                className="text-[0.6875rem] text-link underline decoration-dotted underline-offset-2">
                {record.sourceOrg ?? hostOf(record.sourceUrl)}
              </a>
            )}
            {record.retrievedAt && <span className="text-[0.625rem] text-muted"> · Read {formatDateMDY(record.retrievedAt.slice(0, 10))}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
