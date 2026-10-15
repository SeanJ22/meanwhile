import { refreshVenueResolutionsFromPromoted } from "../../civic-data/curated-reader-read-model.ts";
import type { AdapterVerification, DerivedInputRef } from "../../civic-data/derived-authority.ts";
import { bodySourceWiringFor, DERIVED_WIRING_SOURCE_NAMES, type DerivedWiringKind, type DerivedWiringRow } from "../../civic-data/derived-meeting-wiring.ts";
import type { PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import { MEETING_HELD_HORIZON_DAYS, MEETING_HELD_LOOKBACK_DAYS } from "../../meetings/constants.ts";
import { makeIcalSource, parseIcs } from "../../sources/ical/index.ts";
import { ZeroRowExtractionError } from "../../sources/normalize-account.ts";
import { makeOfficialPageEventsSource, officialLinkingPageFrom } from "../../sources/official-page-events/index.ts";
import { makeDiligentSource } from "../../sources/diligent/index.ts";
import { makeBoardBookSource } from "../../sources/boardbook/index.ts";
import { makeGranicusSource } from "../../sources/granicus/index.ts";
import { makeNovusAgendaSource } from "../../sources/novusagenda/index.ts";
import { makeBoardDocsSource } from "../../sources/boarddocs/index.ts";
import { makePrimeGovSource } from "../../sources/primegov/index.ts";
import { makeCivicPlusSource } from "../../sources/civicplus/index.ts";
import { makeMunicodeSource } from "../../sources/municode/index.ts";
import { makeEscribeSource } from "../../sources/escribe/index.ts";
import { makeCivicClerkSource } from "../../sources/civicclerk/index.ts";
import { makeIqm2Source } from "../../sources/iqm2/index.ts";
import { makeSwagitSource } from "../../sources/swagit/index.ts";
import { normalizeWithDrops as normalizeLegistar } from "../../sources/legistar/index.ts";
import { legistarClientsFromWiring } from "../../sources/legistar/client-registry.ts";
import type { LegistarEvent } from "../../sources/legistar/types.ts";
import type { Meeting } from "../../sources/types.ts";
import { sameRoute, type WiringVerification } from "./derived-wiring.ts";

type VaultedEvidence = Extract<DerivedInputRef, { kind: "VAULTED_EVIDENCE" }>;

/** One held calendar to read for one reviewed row. */
export interface HeldCalendarReading {
  /** Official pages already held with the calendar; bytes are the authority chain. */
  readonly linkingPages?: readonly {canonicalUrl:string;text:string}[];
  /** The caller's key for this reading. */
  readonly key: string;
  readonly row: DerivedWiringRow;
  /** The held bytes as text, or why they could not be read. */
  readonly held: { readonly text: string; readonly contentType: string } | { readonly unreadable: string };
  readonly evidence: VaultedEvidence;
  /** The names of the government's other reviewed bodies. */
  readonly others: readonly string[];
}

export type HeldCalendarReadings =
  | { readonly kind: "UNREADABLE"; readonly detail: string }
  | { readonly kind: "READ"; readonly verifications: ReadonlyMap<string, WiringVerification> };

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function adapterThrowVerification(error: unknown, route: string): WiringVerification {
  return error instanceof ZeroRowExtractionError
    ? { changed: `the reviewed filter selects none of ${route}'s events: ${error.message}` }
    : { refused: `the adapter could not read ${route}: ${message(error)}` };
}

export async function readHeldCalendars(input: {
  readonly options: PromotedCivicDataReadOptions;
  readonly now: string;
  readonly adapterDigest: (kind: DerivedWiringKind) => string;
  readonly readings: readonly HeldCalendarReading[];
}): Promise<HeldCalendarReadings> {
  if (input.readings.length === 0) return { kind: "READ", verifications: new Map() };
  try {
    await refreshVenueResolutionsFromPromoted(input.options);
  } catch (error) {
    return { kind: "UNREADABLE", detail: `The venue resolutions every adapter reading resolves through could not be read: ${message(error)}` };
  }
  const verifications = new Map<string, WiringVerification>();
  const pages=input.readings.flatMap(reading=>[...(reading.linkingPages ?? []),...('unreadable' in reading.held?[]:[{canonicalUrl:reading.row.route,text:reading.held.text}])]);
  for (const reading of input.readings) verifications.set(reading.key, await readOne({...reading,linkingPages:pages}, input.now, input.adapterDigest));
  return { kind: "READ", verifications };
}

async function readOne(reading: HeldCalendarReading, now: string, adapterDigest: (kind: DerivedWiringKind) => string): Promise<WiringVerification> {
  const { row } = reading;
  if ("unreadable" in reading.held) return { refused: `the vaulted bytes could not be read: ${reading.held.unreadable}` };
  const { text, contentType } = reading.held;
  const fetchImpl = (async (request: string | URL | Request) => {
    const url = typeof request === "string" ? request : request instanceof URL ? request.toString() : request.url;
    // The retained response's original date query remains evidence, never a claim that different bytes were fetched.
    return sameRoute(url, row.route)
      ? new Response(text, { status: 200, headers: { "content-type": contentType || "text/html" } })
      : new Response("not held in the vault", { status: 404 });
  }) as typeof fetch;
  let total = 0;
  if (row.kind === "ICAL") {
    if (!/BEGIN:VCALENDAR/i.test(text)) return { changed: `${row.route} no longer reads as an iCal calendar` };
    total = parseIcs(text).length;
    if (total === 0) return { refused: `${row.route} holds no event in this read` };
  }
  let meetings: readonly Meeting[];
  try {
    const wiring = bodySourceWiringFor(row);
    if (row.kind === "LEGISTAR") {
      const events = JSON.parse(text) as LegistarEvent[];
      if (!Array.isArray(events)) return { changed: "The Legistar route no longer returns events" };
      const clients = legistarClientsFromWiring([wiring]);
      const ownEvents = events.filter(event => event.EventBodyId === clients[0]?.eventBodyId);
      meetings = normalizeLegistar(ownEvents.map(event => ({ event, slug: wiring.config.slug,
        collectedAt: reading.evidence.retrievedAt, items: [] })), new Date(now), clients).meetings;
    } else if (row.kind === "SWAGIT") {
      meetings = makeSwagitSource([wiring]).normalizeWithDrops([{ wiring, pages: [{ url: row.route, text }], collectedAt: reading.evidence.retrievedAt }], new Date(now)).meetings;
    } else if (["CIVICPLUS", "CIVICCLERK", "BOARDBOOK", "BOARDDOCS", "IQM2", "MUNICODE", "GRANICUS", "ESCRIBE", "NOVUSAGENDA", "PRIMEGOV"].includes(row.kind)) {
      // The exact retained route is the adapter's input. Running its fetch
      // here would ask for additional URLs whose bytes were never vaulted.
      const collectedAt = reading.evidence.retrievedAt;
      if (row.kind === "MUNICODE") {
        meetings = makeMunicodeSource([wiring]).normalizeWithDrops([{ wiring, pages: [{ url: row.route, text }], collectedAt }], new Date(now)).meetings;
      } else if (row.kind === "GRANICUS") {
        meetings = makeGranicusSource([wiring]).normalizeWithDrops([{ wiring, html: text, collectedAt }], new Date(now)).meetings;
      } else if (row.kind === "ESCRIBE") {
        meetings = makeEscribeSource([wiring]).normalizeWithDrops([{ wiring, text, collectedAt }], new Date(now)).meetings;
      } else if (row.kind === "CIVICPLUS") {
        meetings = makeCivicPlusSource([wiring]).normalizeWithDrops([{ wiring, ical: "", agendaPages: [{ url: wiring.config.agendaCenterUrl, text, collectedAt }], collectedAt }], new Date(now)).meetings;
      } else if (row.kind === "CIVICCLERK") {
        const events = JSON.parse(text)?.value;
        if (!Array.isArray(events)) return { changed: "The CivicClerk route no longer returns a list of events" };
        meetings = makeCivicClerkSource([wiring]).normalizeWithDrops([{ wiring, events, collectedAt }], new Date(now)).meetings;
      } else if (row.kind === "BOARDBOOK") {
        meetings = makeBoardBookSource([wiring]).normalizeWithDrops([{ wiring, html: text, collectedAt }], new Date(now)).meetings;
      } else if (row.kind === "PRIMEGOV") {
        meetings = makePrimeGovSource([wiring]).normalizeWithDrops([{ wiring, text, sourceUrl: row.route, collectedAt }], new Date(now)).meetings;
      } else if (row.kind === "NOVUSAGENDA") {
        meetings = makeNovusAgendaSource([wiring]).normalizeWithDrops([{ wiring, pages: [{ url: row.route, html: text }], collectedAt }], new Date(now)).meetings;
      } else if (row.kind === "IQM2") {
        meetings = makeIqm2Source([wiring]).normalizeWithDrops([{ wiring, html: text, collectedAt }], new Date(now)).meetings;
      } else {
        meetings = makeBoardDocsSource([wiring]).normalizeWithDrops([{ wiring, text, collectedAt }], new Date(now)).meetings;
      }
    } else {
    const source = row.kind === "ICAL" ? makeIcalSource([wiring], fetchImpl) : row.kind === "DILIGENT" ? makeDiligentSource([wiring], fetchImpl) : makeOfficialPageEventsSource([wiring], fetchImpl,url=>officialLinkingPageFrom(url,reading.linkingPages ?? []));
    const nowMs = Date.parse(now);
    const raw = row.kind === "DILIGENT" ? [{ wiring, meetings: JSON.parse(text), collectedAt: reading.evidence.retrievedAt }] : await source.fetch({
      lat: 39.5, lng: -98.35, radiusKm: 5000,
      startsAfter: new Date(nowMs - MEETING_HELD_LOOKBACK_DAYS * 86_400_000).toISOString(),
      startsBefore: new Date(nowMs + MEETING_HELD_HORIZON_DAYS * 86_400_000).toISOString(),
    });
    meetings = source.normalizeWithDrops(raw as never[], new Date(nowMs)).meetings;
    }
  } catch (error) {
    return adapterThrowVerification(error, row.route);
  }
  const own = meetings.filter((m) => m.bodyId === row.bodyId);
  const emptyBody = total === 0 && ((row.kind === "LEGISTAR" && /^\d+$/.test(row.config.eventBodyId)) || (row.kind === "BOARDDOCS" && row.config.committeeId) || (row.kind === "CIVICCLERK" && row.config.bodyMatch && /eventCategoryId eq \d+/.test(new URL(row.route).searchParams.get("$filter") ?? "")));
  if (own.length === 0 && !emptyBody) return { changed: `the reviewed filter selects none of ${row.route}'s ${total > 0 ? `${total} ` : ""}event(s)` };
  const name = row.bodyName.toLowerCase();
  const foreign = own.find((m) => !m.title.toLowerCase().includes(name) && reading.others.some((o) => m.title.toLowerCase().includes(o.toLowerCase())));
  if (foreign !== undefined) {
    return { wrongAttribution: `"${foreign.title}" (${foreign.startsAt}) names another reviewed body of ${row.jurisdictionId}, not ${row.bodyName}` };
  }
  const verified: AdapterVerification = {
    adapter: DERIVED_WIRING_SOURCE_NAMES[row.kind],
    closureDigest: adapterDigest(row.kind),
    verifiedAt: now,
    sittings: own.length,
    evidence: reading.evidence,
  };
  return { verified, selected: own.map((m) => `${m.startsAt}|${m.title}`) };
}
