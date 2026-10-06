import type { CandidacyRemoval } from "@/lib/ballot/types";
import { formatDateMDY } from "@/lib/map/format";

/** A sourced filing change is retained without listing a removed candidacy as current. */
export function FilingChanges({ removals }: { removals: readonly CandidacyRemoval[] }) {
  if (!removals.length) return null;
  return (
    <details className="mt-3 t-detail leading-relaxed text-paper-dim" data-filing-change-count={removals.length}>
      <summary className="cursor-pointer text-link">Filing changes ({removals.length})</summary>
      <ul className="mt-2 space-y-2">
        {removals.map((record) => (
          <li key={record.id} data-filing-change-id={record.id}>
            <p>{record.statement}</p>
            <p className="mt-1 t-caption text-muted">
              {record.lastListed.sourceUrl && <a className="text-link underline" href={record.lastListed.sourceUrl} target="_blank" rel="noreferrer">Earlier filing</a>}
              {" · Read "}{formatDateMDY(record.lastListed.collectedAt)}
              {record.absentFrom.sourceUrl && <> · <a className="text-link underline" href={record.absentFrom.sourceUrl} target="_blank" rel="noreferrer">Revised filing</a></>}
              {" · Read "}{formatDateMDY(record.absentFrom.collectedAt)}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}
