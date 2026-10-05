import type { MeetingReaderRecords } from "@/lib/meetings/reader-records";
import { formatDateMDY } from "@/lib/map/format";

/** Actions and named votes retain their separate source record classes. */
export function MeetingRecords({ records }: { records: MeetingReaderRecords | null }) {
  if (!records || records.status === "NOT_HELD") return null;
  if (records.status === "HOLDING_UNAVAILABLE") return <p className="t-detail leading-relaxed text-muted" data-meeting-records-status="HOLDING_UNAVAILABLE">
    We couldn&apos;t check the separately held meeting outcome records just now. This does not affect the meeting or agenda above.
  </p>;
  if (records.status === "IDENTITY_UNRESOLVED") return <p className="t-detail leading-relaxed text-muted" data-meeting-records-status="IDENTITY_UNRESOLVED">
    We could not verify that the held outcome records belong to this exact sitting, so none are attached here.
  </p>;
  const titles = new Map(records.agenda.map((row) => [row.eventItemId, row.title]));
  return <div data-meeting-records={records.meetingId} className="space-y-3 t-detail leading-relaxed">
    {records.sourceUrl && <p className="text-muted">Meeting record: <a href={records.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-signal underline decoration-dotted">{records.sourceOrg}</a></p>}
    {records.agenda.length > 0 && <details>
      <summary className="cursor-pointer text-signal">Recorded agenda items ({records.counts.agenda})</summary>
      <ol className="mt-2 max-h-72 space-y-2 overflow-y-auto">
        {records.agenda.map((row) => <li key={row.eventItemId} data-agenda-record={row.eventItemId}>{row.title}</li>)}
      </ol>
    </details>}
    {records.actions.length > 0 && <details open>
      <summary className="cursor-pointer text-signal">Recorded actions ({records.counts.actions})</summary>
      <ol className="mt-2 max-h-72 space-y-3 overflow-y-auto">
        {records.actions.map((row) => <li key={row.eventItemId} data-action-record={row.eventItemId}>
          {(titles.get(row.eventItemId) || row.matterFile) && <p className="font-semibold">{titles.get(row.eventItemId) ?? row.matterFile}</p>}
          <p>{row.action}{row.tallyText && <> · {row.tallyText}</>}</p>
          {row.dispositionConflict && <p className="text-muted">{row.dispositionConflict}</p>}
          <a href={row.provenance.endpoint} target="_blank" rel="noreferrer" className="text-signal underline decoration-dotted">{row.provenance.sourceOrg}</a>
          <span className="text-muted"> · read {formatDateMDY(String(row.provenance.readOn))}</span>
        </li>)}
      </ol>
    </details>}
    {records.rollCalls.length > 0 && <details>
      <summary className="cursor-pointer text-signal">Recorded roll calls ({records.counts.rollCalls})</summary>
      <ol className="mt-2 max-h-72 space-y-3 overflow-y-auto">
        {records.rollCalls.map((row) => <li key={row.eventItemId} data-roll-call-record={row.eventItemId}>
          {titles.get(row.eventItemId) && <p className="font-semibold">{titles.get(row.eventItemId)}</p>}
          <ul>{row.votes.map((vote, index) => <li key={`${vote.personId}:${index}`} data-recorded-vote>
            {vote.personName ?? "Member name unavailable"}: {" "}
            {vote.value ?? "Vote value unavailable"}
          </li>)}</ul>
          <a href={row.provenance.endpoint} target="_blank" rel="noreferrer" className="text-signal underline decoration-dotted">{row.provenance.sourceOrg}</a>
        </li>)}
      </ol>
    </details>}
  </div>;
}
