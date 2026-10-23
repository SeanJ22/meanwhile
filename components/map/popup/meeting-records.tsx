"use client";

import type { MeetingReaderRecords } from "@/lib/meetings/reader-records";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { readerText } from "@/lib/text/reader-names";
import { nameTokens } from "@/lib/officials/person-name";
import { useReaderNames } from "@/components/ui/reader-names-context";

export function meetingRecordNames(records: MeetingReaderRecords | null, knownNames: readonly string[] = []): string[] {
  const people = [...(records?.rollCalls ?? []).flatMap(row => row.votes.map(vote => vote.personName)),
    ...(records?.actions ?? []).flatMap(row => [row.mover, row.seconder])];
  return [...knownNames, ...people.flatMap(name => name ? [name, nameTokens(name).at(-1) ?? ""] : [])];
}

/** Actions and named votes retain their separate source record classes. */
export function MeetingRecords({ records, knownNames = [] }: { records: MeetingReaderRecords | null; knownNames?: readonly string[] }) {
  const inheritedNames = useReaderNames();
  if (!records) return null;
  const subject = records.bodyId ? { type: "BODY" as const, id: records.bodyId } : null;
  if (records.status !== "HELD") return <CardGapContribution id={`meeting:${records.meetingId}:records`} label="meeting outcomes" subject={subject} />;
  const titles = new Map(records.agenda.map((row) => [row.eventItemId, row.title]));
  const names = meetingRecordNames(records, [...inheritedNames, ...knownNames]);
  return <div data-meeting-records={records.meetingId} className="space-y-3 t-detail leading-relaxed">
    <CardSourcesContribution id={`meeting-records:${records.meetingId}`} sources={[
      ...(records.sourceUrl ? [{ what: "Meeting outcome records", provenance: { sourceUrl: records.sourceUrl, sourceOrg: records.sourceOrg ?? "", collectedAt: "", verifiedAt: null } }] : []),
      ...[...records.agenda, ...records.actions, ...records.rollCalls].map(row => ({ what: { AGENDA: "Agenda items", ACTION_SUMMARY: "Meeting actions", ROLL_CALL: "Roll-call votes" }[row.recordClass], provenance: { sourceUrl: row.provenance.endpoint, sourceOrg: row.provenance.sourceOrg, collectedAt: row.provenance.readOn === "UNKNOWN" ? "" : row.provenance.readOn, verifiedAt: null } })),
    ]} />
    {records.agenda.length > 0 && <details>
      <summary className="cursor-pointer text-signal">Recorded agenda items ({records.counts.agenda})</summary>
      <ol className="mt-2 max-h-72 space-y-2 overflow-y-auto">
        {records.agenda.map((row) => <li key={row.eventItemId} data-agenda-record={row.eventItemId}>{readerText(row.title, "sentence", names)}</li>)}
      </ol>
    </details>}
    {records.actions.length > 0 && <details open>
      <summary className="cursor-pointer text-signal">Recorded actions ({records.counts.actions})</summary>
      <ol className="mt-2 max-h-72 space-y-3 overflow-y-auto">
        {records.actions.map((row) => <li key={row.eventItemId} data-action-record={row.eventItemId}>
          {(titles.get(row.eventItemId) || row.matterFile) && <p className="font-semibold">{readerText(titles.get(row.eventItemId) ?? row.matterFile ?? "", "sentence", names)}</p>}
          <p>{readerText(row.action ?? "", "sentence", names)}{row.tallyText && <> · {readerText(row.tallyText, "sentence", names)}</>}</p>
          {row.dispositionConflict && <p className="text-muted">{readerText(row.dispositionConflict, "sentence", names)}</p>}

        </li>)}
      </ol>
    </details>}
    {records.rollCalls.length > 0 && <details>
      <summary className="cursor-pointer text-signal">Recorded roll calls ({records.counts.rollCalls})</summary>
      <ol className="mt-2 max-h-72 space-y-3 overflow-y-auto">
        {records.rollCalls.map((row) => <li key={row.eventItemId} data-roll-call-record={row.eventItemId}>
          {titles.get(row.eventItemId) && <p className="font-semibold">{readerText(titles.get(row.eventItemId)!, "sentence", names)}</p>}
          {row.votes.some(vote => !vote.personName || !vote.value) && <CardGapContribution id={`meeting:${records.meetingId}:votes:${row.eventItemId}`} label="vote details" count={row.votes.filter(vote => !vote.personName || !vote.value).length} unit="vote" subject={subject} />}
          <ul>{row.votes.filter(vote => vote.personName || vote.value).map((vote, index) => <li key={`${vote.personId}:${index}`} data-recorded-vote>
            {readerText(vote.personName ?? "", "name")}{vote.personName && vote.value && ": "}{readerText(vote.value ?? "", "sentence")}
          </li>)}</ul>

        </li>)}
      </ol>
    </details>}
  </div>;
}
