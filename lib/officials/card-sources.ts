import { carriedRowClause, relativeAge } from "../meetings/freshness.ts";
import type { Meeting, Provenance } from "../sources/types.ts";

import type { RollCallVote } from "../votes/types.ts";
import type { ExecutiveAction } from "./executive-actions.ts";
import type { SeatHolder } from "./lookup.ts";
import { tribalSeatForHolder, tribalSeatCardSources } from "./tribal-seats.ts";

/** What a battlecard actually drew on, assembled once for every card class. */

export interface CardSource {
  /** Native document/listing identities remain inspectable inside Sources. */
  dataAttrs?: Readonly<Record<`data-${string}`, string | number | undefined>>;
  /** Which facts on this card this source is behind. */
  what: string;
  provenance: Provenance;
  /** A status line about the listing (e.g. when a carried row was last reached), not a source: shown without a source-kind label. */
  status?: true;
}

/** Where district and place boundaries come from: the endpoint and vintage the boundary fetch pins. */
export const BOUNDARY_PROVENANCE: Provenance = {
  sourceUrl: "https://www2.census.gov/geo/tiger/",
  sourceOrg: "U.S. Census Bureau (TIGER/Line and Cartographic Boundary files)",
  collectedAt: "2026-08-10",
  verifiedAt: null,
};

/** Merge key: two rows from the same publisher and page are one source. */
function keyOf(provenance: Provenance): string {
  return `${provenance.sourceOrg}|${provenance.sourceUrl ?? ""}|${provenance.quote ?? ""}`;
}

/** Merge same-source entries, keeping the earliest `what` and stating the count and what is counted. */
export function mergeSources(entries: CardSource[]): CardSource[] {
  const byKey = new Map<string, { entry: CardSource; extra: number }>();

  for (const entry of entries) {
    // Captured versions and carried sittings retain their native identity.
    const key = keyOf(entry.provenance) + (entry.dataAttrs ? `|${JSON.stringify(entry.dataAttrs)}` : "");
    const existing = byKey.get(key);
    if (existing) existing.extra += 1;
    else byKey.set(key, { entry, extra: 0 });
  }

  return [...byKey.values()].map(({ entry, extra }) =>
    extra === 0
      ? entry
      : { ...entry, what: `${entry.what}, and ${extra} more from this source` },
  );
}

/** A person row's own record, when the row carries one. */
function holderSource(holder: SeatHolder, what: string): CardSource | null {
  if (holder.provenance) return { what, provenance: holder.provenance };
  // A holder with a bare URL and no publisher or date is still a source; dropping it would imply better citation.
  if (holder.sourceUrl) {
    return {
      what,
      provenance: {
        sourceUrl: holder.sourceUrl,
        sourceOrg: "the publishing body",
        collectedAt: "",
        verifiedAt: null,
      },
    };
  }
  return null;
}

function retainedHolderSources(holder: SeatHolder): CardSource[] {
  return [...Object.entries(holder.fieldSources ?? {}).map(([field, provenance]) => ({ what: `${holder.name} — ${field}`, provenance })), ...Object.entries(holder.retainedFieldSources ?? {}).flatMap(([field, source]) => {
    if (!source) return [];
    const label = { termNote: "term wording", termStart: "term start date", termEnd: "term end date", email: "office email", phone: "office phone", websiteUrl: "official page link" }[field] ?? field;
    return [{ what: `${holder.name}'s previously verified ${label}, retained after an incomplete update`,
      provenance: { ...source, verifiedAt: null } }];
  })];
}

/** Every record behind a district or division battlecard: the boundary, the representatives and the sittings. */
export function districtCardSources(
  representation: SeatHolder[],
  meetings: Meeting[],
  /** The saved page that states a body's office address and phone, when the card shows them. */
  officeContact?: Provenance | null,
  /** A supplemental boundary carries its own sources rather than Census attribution. */
  boundarySources?: readonly Provenance[],
): CardSource[] {
  const entries: CardSource[] = (boundarySources ?? [BOUNDARY_PROVENANCE]).map(provenance =>
    ({what:"This district's boundary, type and label", provenance}));
  if (officeContact) entries.push({ what: "The body's office address and phone", provenance: officeContact });

  for (const holder of representation) {
    const source = holderSource(holder, `Who represents it — ${holder.name}`);
    if (source) entries.push(source);
    entries.push(...retainedHolderSources(holder));
  }

  for (const meeting of meetings) {
    entries.push({ what: `A meeting on this card — ${meeting.title}`, provenance: meeting.provenance });
  }

  return mergeSources(entries);
}

/** Every record behind a MEETING battlecard. */
export function meetingCardSources(
  meeting: Meeting,
  representation: SeatHolder[],
  evidence: MeetingCardEvidence = {},
): CardSource[] {
  const entries: CardSource[] = [
    { what: `This sitting — ${meeting.title}${meeting.venueGap ? ` · ${meeting.venueGap.kind === "NOT_STATED_BY_PUBLISHER" ? "Meeting place not stated by" : "Published meeting place from"} ${meeting.venueGap.publisher}` : ""}`, provenance: meeting.provenance },
  ];
  for (const [field, provenance] of Object.entries(meeting.fieldSources ?? {})) entries.push({ what: `This sitting — ${field}`, provenance });
  if (meeting.carried) {
    const clause = carriedRowClause(meeting.carried);
    entries.push({ what: `Last reached ${relativeAge(meeting.carried.lastFreshAt)}${clause ? ` — ${clause}` : ""}`, dataAttrs: { "data-meeting-carried-source": meeting.id }, status: true, provenance: { ...meeting.provenance, collectedAt: meeting.carried.lastFreshAt } });
  }
  if (meeting.agendaUrl) entries.push({ what: "The published agenda link", provenance: { ...meeting.provenance, sourceUrl: meeting.agendaUrl } });
  for (const [kind, label] of Object.entries(MEETING_SOURCE_LABELS)) {
    for (const provenance of evidence[kind as keyof MeetingCardEvidence] ?? []) entries.push({ what: label, provenance });
  }
  // The recording is linked from the publisher's own record of the sitting, so that record is its source.
  if (meeting.videoUrl) entries.push({ what: "The recording of this sitting", provenance: meeting.provenance });

  for (const holder of representation) {
    const source = holderSource(holder, `Who sits on this body — ${holder.name}`);
    if (source) entries.push(source);
    entries.push(...retainedHolderSources(holder));
  }

  return mergeSources(entries);
}

/** Every record behind a person battlecard; each section passes the records it actually displays. */
export function personCardSources(
  holder: SeatHolder,
  extra: CardSource[] = [],
  sections: PersonCardEvidence = {},
): CardSource[] {
  const entries: CardSource[] = [];

  const spine = holderSource(
    holder,
    holder.retainedFieldSources && Object.keys(holder.retainedFieldSources).length
      ? `Who they are and their current office; newly verified contact details`
      : `Who they are, their office and how to reach them`,
  );
  if (spine) entries.push(spine);

  entries.push(...retainedHolderSources(holder));

  const tribal = tribalSeatForHolder(holder);
  if (tribal) entries.push(...tribalSeatCardSources(tribal));

  entries.push(...extra, ...moneyCardSources(sections.money ?? []), ...voteCardSources(sections.votes ?? []),
    ...actionCardSources(sections.actions ?? []));

  return mergeSources(entries);
}

/** Polarization Research Lab measurements, credited to the lab; never a score or label of the person. */
export function prlCardSource(profile: { attribution: { text: string; url: string }; sourceUrl: string; readAt: string }): CardSource {
  return {
    what: "The shares of their public statements about policy, criticism and more — measured by the Polarization Research Lab, not by Meanwhile",
    provenance: {
      sourceUrl: profile.sourceUrl || profile.attribution.url,
      sourceOrg: profile.attribution.text,
      collectedAt: profile.readAt.slice(0, 10),
      verifiedAt: null,
    },
  };
}

/** What the Sources tab states beside its name, computed from the array the tab renders. */
export function sourceCountLabel(sources: CardSource[]): string | null {
  if (sources.length === 0) return null;
  return String(sources.length);
}


const MEETING_SOURCE_LABELS = { agendas: "Agenda contents", minutes: "Meeting minutes", records: "Meeting decisions and records",
  commentAccess: "How to take part", cadence: "The regular meeting schedule" } as const;
export type MeetingCardEvidence = { readonly [K in keyof typeof MEETING_SOURCE_LABELS]?: readonly Provenance[] };
export interface PersonCardEvidence {
  readonly money?: readonly { readonly provenance: Provenance }[];
  readonly votes?: readonly Pick<RollCallVote, "title" | "chamber" | "rollCallUrl" | "retrievedAt">[];
  readonly actions?: readonly Pick<ExecutiveAction, "designation" | "sourceUrl" | "documentUrl" | "sourceOrg" | "collectedAt">[];
}
/** FEC and state records already carry the exact filing provenance. */
export function moneyCardSources(records: NonNullable<PersonCardEvidence["money"]>): CardSource[] {
  return mergeSources(records.map(record => ({ what: "Money reported in the filings", provenance: record.provenance })));
}
export function voteCardSources(votes: NonNullable<PersonCardEvidence["votes"]>): CardSource[] {
  return mergeSources(votes.map(vote => ({ what: `Recorded vote — ${vote.title}`, provenance: {
    sourceUrl: vote.rollCallUrl, sourceOrg: vote.chamber === "house" ? "U.S. House of Representatives" : "U.S. Senate",
    collectedAt: vote.retrievedAt, verifiedAt: null,
  } })));
}
export function actionCardSources(actions: NonNullable<PersonCardEvidence["actions"]>): CardSource[] {
  return mergeSources(actions.flatMap(action => {
    const provenance = { sourceUrl: action.sourceUrl, sourceOrg: action.sourceOrg, collectedAt: action.collectedAt, verifiedAt: null };
    return [{ what: `Official action — ${action.designation}`, provenance }, ...(action.documentUrl && action.documentUrl !== action.sourceUrl
      ? [{ what: `Published document — ${action.designation}`, provenance: { ...provenance, sourceUrl: action.documentUrl } }] : [])];
  }));
}
