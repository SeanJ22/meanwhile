import type { MeetingReaderRecords } from "@/lib/meetings/reader-records";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";

/** Actions and named votes retain their separate source record classes. */
export function MeetingRecords({ records }: { records: MeetingReaderRecords | null }) {
  if (!records) return null;
  const subject = records.bodyId ? { type: "BODY" as const, id: records.bodyId } : null;
  if (records.status !== "HELD") return <CardGapContribution id={`meeting:${records.meetingId}:records`} label="meeting outcomes" subject={subject} />;
  const titles = new Map(records.agenda.map((row) => [row.eventItemId, row.title]));
  return <div data-meeting-records={records.meetingId} className="space-y-3 t-detail leading-relaxed">
    <CardSourcesContribution id={`meeting-records:${records.meetingId}`} sources={[
      ...(records.sourceUrl ? [{ what: "Meeting outcome records", provenance: { sourceUrl: records.sourceUrl, sourceOrg: records.sourceOrg ?? "", collectedAt: "", verifiedAt: null } }] : []),
      ...[...records.agenda, ...records.actions, ...records.rollCalls].map(row => ({ what: { AGENDA: "Agenda items", ACTION_SUMMARY: "Meeting actions", ROLL_CALL: "Roll-call votes" }[row.recordClass], provenance: { sourceUrl: row.provenance.endpoint, sourceOrg: row.provenance.sourceOrg, collectedAt: row.provenance.readOn === "UNKNOWN" ? "" : row.provenance.readOn, verifiedAt: null } })),
    ]} />
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

        </li>)}
      </ol>
    </details>}
    {records.rollCalls.length > 0 && <details>
      <summary className="cursor-pointer text-signal">Recorded roll calls ({records.counts.rollCalls})</summary>
      <ol className="mt-2 max-h-72 space-y-3 overflow-y-auto">
        {records.rollCalls.map((row) => <li key={row.eventItemId} data-roll-call-record={row.eventItemId}>
          {titles.get(row.eventItemId) && <p className="font-semibold">{titles.get(row.eventItemId)}</p>}
          {row.votes.some(vote => !vote.personName || !vote.value) && <CardGapContribution id={`meeting:${records.meetingId}:votes:${row.eventItemId}`} label="vote details" count={row.votes.filter(vote => !vote.personName || !vote.value).length} unit="vote" subject={subject} />}
          <ul>{row.votes.filter(vote => vote.personName || vote.value).map((vote, index) => <li key={`${vote.personId}:${index}`} data-recorded-vote>
            {vote.personName}{vote.personName && vote.value && ": "}{vote.value}
          </li>)}</ul>

        </li>)}
      </ol>
    </details>}
  </div>;
}
