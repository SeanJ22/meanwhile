import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import type { Meeting } from "../sources/types.ts";
import { captureProvenance } from "./capture.ts";
import { hostOf, normalizeText } from "./check.ts";
import { meetingEntityId } from "./meeting-read.ts";
import { readCheckEntity } from "./entity-read.ts";
import { publishClaims, type Clocks, type FactDb, type PublishInput, type Query } from "./publish.ts";
import { saveCaptureCopies } from "./source-copy.ts";

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
  const utc = new Date(meeting.startsAt).toISOString();
  const together = day ? [] : [utc.replaceAll(/[-:]/g, "").replace(".000", ""), utc, `${p.y}${p.mm}${p.dd}T${p.hh}${p.mi}00`, `${p.y}-${p.mm}-${p.dd}T${p.hh}:${p.mi}`];
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

export async function publishMeetingFacts(db: FactDb & { readonly query: Query }, input: {
  readonly meeting: Meeting; readonly capture: WorkerPublicationCapture; readonly producedBy: string;
}, clocks: Clocks, now: Date): Promise<MeetingFactsReport> {
  return publishMeetingFactBatch(db, [{ meeting: input.meeting, capture: input.capture }], input.producedBy, clocks, now);
}

export async function publishMeetingFactBatch(db: FactDb & { readonly query: Query }, readings: readonly {
  readonly meeting: Meeting; readonly capture: WorkerPublicationCapture;
}[], producedBy: string, clocks: Clocks, now: Date): Promise<MeetingFactsReport> {
  const tally = { live: 0, confirmed: 0, held: 0, blanks: 0 };
  for (let at = 0; at < readings.length; at += 48) {
    const batch = readings.slice(at, at + 48);
    const captures = [...new Set(batch.map(row => row.capture))];
    const owners = [...new Map(batch.flatMap(({ meeting, capture }) => {
      const id = meeting.bodyId ?? meeting.ocdId;
      return id ? [[id, { id, kind: meeting.bodyId ? "body" : "place", name: meeting.bodyName,
        state: /\/state:([a-z]{2})/.exec(meeting.ocdId ?? meeting.bodyId ?? "")?.[1]?.toUpperCase() ?? null,
        parent: meeting.bodyId ? meeting.ocdId : null, url: capture.evidence.canonicalUrl }] as const] : [];
    })).values()];
    const entities = batch.map(({ meeting }) => ({ id: meetingEntityId(meeting.id), name: meeting.bodyName,
      state: /\/state:([a-z]{2})/.exec(meeting.ocdId ?? meeting.bodyId ?? "")?.[1]?.toUpperCase() ?? null,
      parent: meeting.bodyId ?? meeting.ocdId ?? null }));
    const copies = await db.transaction(async query => {
      await query(`WITH owners AS (
          INSERT INTO entity (id, kind, name, state, parent_id)
          SELECT x.id, x.kind, x.name, x.state, p.id FROM jsonb_to_recordset($1::jsonb)
            AS x(id text, kind text, name text, state text, parent text) LEFT JOIN entity p ON p.id = x.parent
          ON CONFLICT (id) DO NOTHING RETURNING id
        ) INSERT INTO entity (id, kind, name, state, parent_id)
          SELECT x.id, 'meeting', x.name, x.state, coalesce(p.id, o.id) FROM jsonb_to_recordset($2::jsonb)
            AS x(id text, name text, state text, parent text)
          LEFT JOIN entity p ON p.id = x.parent LEFT JOIN owners o ON o.id = x.parent ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(owners), JSON.stringify(entities)]);
      const channels = batch.flatMap(({ meeting, capture }) => {
        const owner = meeting.bodyId ?? meeting.ocdId;
        if (!owner) return [];
        const url = capture.evidence.canonicalUrl, { pathname } = new URL(url);
        return [{ id: owner, host: `${hostOf(url)}${pathname.slice(0, pathname.lastIndexOf("/")) || ""}` }];
      });
      await query(`WITH channels AS (
          INSERT INTO entity_host (entity_id, host) SELECT DISTINCT id, host FROM jsonb_to_recordset($1::jsonb) AS x(id text, host text)
          ON CONFLICT DO NOTHING
        ) INSERT INTO entity_place (entity_id, place_id)
          SELECT x.id, ep.place_id FROM jsonb_to_recordset($2::jsonb) AS x(id text, parent text)
          JOIN entity_place ep ON ep.entity_id = x.parent ON CONFLICT DO NOTHING`, [JSON.stringify(channels), JSON.stringify(entities)]);
      return saveCaptureCopies(query, captures);
    });
    const authorities = new Map(await Promise.all(owners.map(async owner => [owner.id, (await readCheckEntity(db.query, owner.id))!] as const)));
    const claims: PublishInput[] = [];
    for (const { meeting, capture } of batch) {
      const id = meetingEntityId(meeting.id), owner = meeting.bodyId ?? meeting.ocdId;
      const authority = owner ? authorities.get(owner)! : (await readCheckEntity(db.query, id))!;
      const entity = { ...authority, id, fullName: meeting.bodyName, externalIds: [] };
      const copy = copies[captures.indexOf(capture)]!, provenance = captureProvenance(capture, entity.hosts);
      const claim = (field: string, value: unknown, valueText: string, quote = valueText) => claims.push({ entity, field,
        fieldKind: field === "agenda_url" ? "agenda" : "meeting", provenance, value, valueText, quote, copy, producedBy, costUsd: 0 });
      claim("title", meeting.title, meeting.title);
      const sitting = sittingOnPage(copy.text, meeting);
      claim("starts_at", { startsAt: meeting.startsAt, timeZone: meeting.timeZone, precision: meeting.startPrecision ?? "MINUTE" },
        sitting?.valueText ?? meeting.startsAt, sitting?.quote ?? "");
      if (meeting.location) claim("location", { name: meeting.location.name, address: meeting.location.address }, meeting.location.address ?? meeting.location.name);
      if (meeting.agendaUrl) claim("agenda_url", meeting.agendaUrl, meeting.agendaUrl);
      if (meeting.videoUrl) claim("video_url", meeting.videoUrl, meeting.videoUrl);
    }
    for (const outcome of await publishClaims(db, claims, clocks, now)) {
      if ("blank" in outcome) tally.blanks++;
      else if (outcome.decision === "PUBLISH") tally.live++;
      else if (outcome.decision === "CONFIRM") tally.confirmed++;
      else tally.held++;
    }
  }
  return tally;
}
