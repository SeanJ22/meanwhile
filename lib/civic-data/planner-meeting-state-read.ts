import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { statementQuery } from "../facts/db.ts";
import { readPlacePackage } from "../reader/place.ts";
import { readReaderMeetingSettings } from "../meetings/reader-settings.ts";
import { snapshotCounts } from "../meetings/snapshot.ts";
import type { StateMeetingBody } from "../meetings/edge-serving.ts";

/** A state's boards, sixteen at a time, with their held calendars, history and agenda text, read from the boards' slices as readers read them. */
export async function* readPlannerMeetingBodies(state: string, query: ReadOnlyQuery, now: string): AsyncGenerator<StateMeetingBody> {
  if (!/^[a-z]{2}$/i.test(state)) throw new Error(`PLANNER_MEETING_STATE_INVALID:${state}`);
  const [[bodies], settings] = await Promise.all([
    query([{ text: "SELECT id FROM entity WHERE state=$1::char(2) AND kind='body' ORDER BY id", params: [state.toUpperCase()] }]),
    readReaderMeetingSettings(),
  ]);
  const upper = Date.parse(now) + settings.shownAheadDays * 86_400_000;
  for (let first = 0; first < bodies.length; first += 16) {
    const held = await readPlacePackage({ state, divisionIds: [], bodyIds: bodies.slice(first, first + 16).map(body => String(body.id)), includeHistory: true, includeAgenda: true }, statementQuery(query));
    for (const body of held.bodies) yield { state, bodyId: body.id, load: async () => {
      const snapshot = held.bodySnapshots[body.id]!;
      const meetings = snapshot.meetings.filter(meeting => !Number.isFinite(Date.parse(meeting.startsAt)) || Date.parse(meeting.startsAt) <= upper);
      const ids = new Set(meetings.map(meeting => meeting.id));
      return { snapshot: { ...snapshot, meetings, counts: snapshotCounts(meetings, 0), agendaDocuments: snapshot.agendaDocuments.filter(document => ids.has(document.meetingId)) } };
    } };
  }
}
