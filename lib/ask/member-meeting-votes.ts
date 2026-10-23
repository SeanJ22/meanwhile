import type { BindableEntity } from "../routing/named-entity.ts";
import { normalizeName } from "../routing/exact-name.ts";
import { readerOfficialsQuestion } from "./reader-officials.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { membersOfBody } from "../registry/body-membership.ts";
import { readReaderEdgeMeetings } from "../meetings/edge-serving.ts";
import { readSelectedMeetingOutcomes } from "../outcomes/store.ts";
import { linkLocalVotes, localVotesForMember } from "../outcomes/local-votes.ts";
import { composeLocalMemberVotes } from "./person-votes.ts";
import { officeholderEvidence } from "./officeholder.ts";
import { selectSitting } from "./select.ts";
import { currentReaderSelection, withReaderSelection } from "../db/reader-route.ts";
import type { EvidenceRecord, EvidenceSubject } from "./evidence.ts";
import type { AskSitting } from "./answer.ts";
import { statesForRegistryDivisions } from "../civic-data/state-scopes.ts";

export function memberMeetingVoteQuestion(question: string) {
  const match = /^what did ((?:my|our) .+?) vote on at (?:the|its|their) (?:last|latest|most recent) (council|school board|county board) meeting(?: and how did it turn out)?$/.exec(normalizeName(question));
  if (!match) return null;
  const office = readerOfficialsQuestion(`Who is ${match[1]}?`);
  const local = new Set(["mayor", "municipal_council", "school_board", "county_supervisor", "county_commissioner"]);
  return office && office.keys.every(key => local.has(key))
    ? { office, divisionType: match[2] === "council" ? "place" : match[2] === "school board" ? "school_district" : "county" } : null;
}

/** The latest actual sitting, and the member's own linked votes in that sitting. */
export async function readMemberMeetingVotes(question: string, bodies: readonly BindableEntity[], divisions: readonly string[], now: number) {
  const ask = memberMeetingVoteQuestion(question);
  if (!ask) return null;
  const owned = bodies.filter(body => body.ocdId && divisions.includes(body.ocdId) &&
    (body.id === `${body.ocdId}#governing` || body.id === `${body.ocdId}#board`))
    .map(body => ({ body, roster: membersOfBody(body.id).members }));
  const matchesOffice = (title: string) => ask.office.keys.includes(officeIdentity(title) ?? "");
  const choices = owned.filter(({body}) => body.divisionType === ask.divisionType)
    .flatMap(({body, roster}) => {
      return roster.filter(seat => matchesOffice(seat.officeTitle))
        .map(seat => ({ body, seat, roster }));
    });
  // Unusual jurisdiction types and unclassified roster titles still use the
  // full reader. An unrecognised office must never hide a held person's votes.
  if (!choices.length && owned.some(({body, roster}) => body.divisionType === ask.divisionType
    ? roster.length > 0 : roster.some(seat => matchesOffice(seat.officeTitle)))) return null;
  const subject: EvidenceSubject | null = choices.length === 1 ? { kind: "PERSON", id: choices[0].seat.id, name: choices[0].seat.name, office: choices[0].seat.officeTitle } : null;
  const records: EvidenceRecord[] = choices.length === 1 ? [officeholderEvidence(choices[0].seat)] : [];
  const meetings: AskSitting[] = [];
  const missing = { subject, records, meetings, composed: { answer: "We don't have that answer yet.", citedUrls: [] as string[], missingAnswer: true },
    choices: choices.length > 1 ? choices.map(({seat}) => seat.name) : [], readFailed: false };
  if (choices.length !== 1) return missing;
  const { body, seat, roster } = choices[0];
  const selected = currentReaderSelection();
  return withReaderSelection({ ...selected, states: statesForRegistryDivisions([body.ocdId!]), keys: new Set([body.id, body.ocdId!]) }, async () => {
    try {
      const options = { bodyIds: [body.id], includeAgenda: false, now: new Date(now).toISOString() };
      let calendar = await readReaderEdgeMeetings({ ...options, window: "SHOWN" });
      const latest = () => calendar.kind === "PROMOTED" || calendar.kind === "BOOTSTRAP"
        ? selectSitting("LAST", calendar.value.meetings.filter(meeting => meeting.bodyId === body.id), now) : null;
      if (!latest()) calendar = await readReaderEdgeMeetings({ ...options, window: "HELD" });
      const meeting = latest();
      if (!meeting) return { ...missing, readFailed: calendar.kind === "STORE_UNREACHABLE" };
      meetings.push({ ...meeting, bodyId: meeting.bodyId ?? null, ocdId: meeting.ocdId ?? null });
      const outcomes = await readSelectedMeetingOutcomes(statesForRegistryDivisions([body.ocdId!]), body.id, [meeting.id]);
      // The roster was resolved in the caller's registry context; retain it
      // when the database selection narrows to this body's own records.
      const linked = linkLocalVotes(outcomes.sittings.filter(sitting => sitting.meetingId === meeting.id), () => roster);
      const votes = localVotesForMember(linked.records, seat.id);
      records.push(...votes.map(vote => ({ kind: "ROLL_CALL_VOTE" as const, id: vote.id, subjectId: seat.id,
        text: `${vote.person} voted ${vote.position} on ${vote.subject}.${vote.result ? ` Result: ${vote.result}.` : ""}`,
        occurredAt: vote.date, sourceUrl: vote.sourceUrl, retrievedAt: vote.retrievedAt,
        rollCall: { position: vote.position, what: vote.subject, when: vote.date, result: vote.result ?? "Result not held" } })));
      return { ...missing, composed: composeLocalMemberVotes({ name: seat.name, topic: null, votes }) ?? missing.composed };
    } catch {
      return { ...missing, readFailed: true };
    }
  });
}
