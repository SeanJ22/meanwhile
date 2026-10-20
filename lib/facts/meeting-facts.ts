import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import type { Meeting } from "../sources/types.ts";
import { captureProvenance } from "./capture.ts";
import { normalizeText } from "./check.ts";
import { ensureEntity, learnDoorChannel } from "./entities.ts";
import { meetingEntityId } from "./meeting-read.ts";
import { readCheckEntity } from "./entity-read.ts";
import { openBlank, publishClaim, type Clocks, type FactDb, type PublishOutcome, type Query } from "./publish.ts";
import { saveCaptureCopy } from "./source-copy.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function localParts(startsAt: string, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(startsAt)).map(part => [part.type, part.value]));
  const [y, m, d, h, mi] = [parts.year!, Number(parts.month), Number(parts.day), Number(parts.hour), parts.minute!];
  const pad = (n: number) => String(n).padStart(2, "0");
  return { y, m, d, h, mi, mm: pad(m), dd: pad(d), hh: pad(h), h12: h % 12 || 12, pm: h >= 12 };
}

/** Where the page states this sitting's date (and, when it gives one, its start time), in the publisher's own writing. */
export function sittingOnPage(text: string, meeting: Pick<Meeting, "startsAt" | "timeZone" | "startPrecision">): { readonly valueText: string; readonly quote: string } | null {
  const page = normalizeText(text);
  const p = localParts(meeting.startsAt, meeting.timeZone);
  const month = MONTHS[p.m - 1]!;
  const day = meeting.startPrecision === "DAY";
  const together = day ? [] : [`${p.y}${p.mm}${p.dd}T${p.hh}${p.mi}00`, `${p.y}-${p.mm}-${p.dd}T${p.hh}:${p.mi}`];
  for (const token of together) if (page.includes(token)) return { valueText: token, quote: token };
  const dates = [`${p.y}-${p.mm}-${p.dd}T00:00:00`, `${p.y}-${p.mm}-${p.dd}`, `${p.y}${p.mm}${p.dd}`, `${p.m}/${p.d}/${p.y}`, `${p.mm}/${p.dd}/${p.y}`,
    `${month} ${p.d}, ${p.y}`, `${month.slice(0, 3)} ${p.d}, ${p.y}`, `${month.slice(0, 3)}. ${p.d}, ${p.y}`, `${p.d} ${month} ${p.y}`];
  const suffixes = p.pm ? ["PM", "pm", "p.m.", "P.M."] : ["AM", "am", "a.m.", "A.M."];
  const times = [...suffixes.flatMap(s => [`${p.h12}:${p.mi} ${s}`, `${p.h12}:${p.mi}${s}`, ...(p.mi === "00" ? [`${p.h12} ${s}`, `${p.h12}${s}`] : [])]), `${p.hh}:${p.mi}`];
  // The last place a page states it is the readable one: a JSON or calendar copy ends with its values written out.
  for (const date of dates) {
    for (let at = page.lastIndexOf(date); at !== -1; at = at ? page.lastIndexOf(date, at - 1) : -1) {
      if (day) return { valueText: date, quote: date };
      const window = page.slice(at, at + date.length + 200);
      const time = times.map(t => ({ t, i: window.indexOf(t, date.length) })).filter(row => row.i !== -1).sort((a, b) => a.i - b.i)[0];
      if (time) return { valueText: date, quote: window.slice(0, time.i + time.t.length) };
    }
  }
  return null;
}

export interface MeetingFactsReport { readonly live: number; readonly confirmed: number; readonly held: number; readonly blanks: number }

/** One sitting read from its body's door becomes facts, each found on the saved copy: title, start, place and links. */
export async function publishMeetingFacts(db: FactDb & { readonly query: Query }, input: {
  readonly meeting: Meeting; readonly capture: WorkerPublicationCapture; readonly producedBy: string;
}, clocks: Clocks, now: Date): Promise<MeetingFactsReport> {
  const { meeting, capture } = input;
  const id = meetingEntityId(meeting.id);
  const state = /\/(?:state|district|territory):([a-z]{2})/.exec(meeting.ocdId ?? meeting.bodyId ?? "")?.[1]?.toUpperCase() ?? null;
  const owner = meeting.bodyId ?? meeting.ocdId;
  if (owner) {
    await ensureEntity(db.query, { id: owner, kind: meeting.bodyId ? "body" : "place", name: meeting.bodyName, state, parentId: meeting.bodyId ? meeting.ocdId : null });
    await learnDoorChannel(db.query, owner, capture.evidence.canonicalUrl);
  }
  await ensureEntity(db.query, { id, kind: "meeting", name: meeting.bodyName, state, parentId: owner ?? null });
  if (owner) await db.query("INSERT INTO entity_place (entity_id, place_id) SELECT $1, place_id FROM entity_place WHERE entity_id = $2 ON CONFLICT DO NOTHING", [id, owner]);
  const entity = (await readCheckEntity(db.query, id))!;
  const copy = await db.transaction(query => saveCaptureCopy(query, capture));
  const provenance = captureProvenance(capture, entity.hosts);
  const tally = { live: 0, confirmed: 0, held: 0, blanks: 0 };
  const count = (outcome: PublishOutcome) => {
    if ("blank" in outcome) tally.blanks++;
    else if (outcome.decision === "PUBLISH") tally.live++;
    else if (outcome.decision === "CONFIRM") tally.confirmed++;
    else tally.held++;
  };
  const claim = async (field: string, value: unknown, valueText: string, quote: string = valueText) =>
    count(await publishClaim(db, { entity, field, fieldKind: field === "agenda_url" ? "agenda" : "meeting", provenance, value, valueText, quote, copy,
      producedBy: input.producedBy, costUsd: 0 }, clocks, now));
  await claim("title", meeting.title, meeting.title);
  const sitting = sittingOnPage(copy.text, meeting);
  const start = { startsAt: meeting.startsAt, timeZone: meeting.timeZone, precision: meeting.startPrecision ?? "MINUTE" };
  if (sitting) await claim("starts_at", start, sitting.valueText, sitting.quote);
  else {
    await openBlank(db.query, { entityId: id, field: "starts_at", stage: "CHECK", reason: "CHECK_FAILED:QUOTE_NOT_ON_SAVED_COPY",
      detail: `${meeting.startsAt} is not written on ${capture.evidence.canonicalUrl}`, retryMinutes: clocks.retryMinutes("meeting") });
    tally.blanks++;
  }
  if (meeting.location) await claim("location", { name: meeting.location.name, address: meeting.location.address }, meeting.location.address ?? meeting.location.name);
  if (meeting.agendaUrl) await claim("agenda_url", meeting.agendaUrl, meeting.agendaUrl);
  if (meeting.videoUrl) await claim("video_url", meeting.videoUrl, meeting.videoUrl);
  return tally;
}
