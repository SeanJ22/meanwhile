import { carriedRowClause, relativeAge } from "../meetings/freshness.ts";
import type { Meeting, Provenance } from "../sources/types.ts";

import type { RollCallVote } from "../votes/types.ts";
import type { ExecutiveAction } from "./executive-actions.ts";
import type { SeatHolder } from "./lookup.ts";

/** What a battlecard actually drew on, assembled once for every card class. */

export interface CardSource {
  /** Native document/listing identities remain inspectable inside Sources. */
  dataAttrs?: Readonly<Record<`data-${string}`, string | number | undefined>>;
  /** Which facts on this card this source is behind. */
  what: string;
  provenance: Provenance;
  /** A listing status (for example, when a carried sitting was last reached). */
  status?: true;
  /** Captured facts and native identities sharing this publisher page. */
  details?: readonly Omit<CardSource, "details">[];
}

/** Where district and place boundaries come from: the endpoint and vintage the boundary fetch pins. */
export const BOUNDARY_PROVENANCE: Provenance = {
  sourceUrl: "https://www2.census.gov/geo/tiger/",
  sourceOrg: "U.S. Census Bureau (TIGER/Line and Cartographic Boundary files)",
  collectedAt: "2026-08-10",
  verifiedAt: null,
};

/** A held page is one source even when its publisher label is missing or varies. */
function keyOf(provenance: Provenance): string {
  return provenance.sourceUrl?.trim()
    ? JSON.stringify(["url", provenance.sourceUrl])
    : JSON.stringify(["publisher", provenance.sourceOrg.trim()]);
}

/** One publisher page, with every covered fact and captured identity retained. */
export function mergeSources(entries: CardSource[]): CardSource[] {
  const byKey = new Map<string, Map<string, Omit<CardSource, "details">>>();

  for (const entry of entries) {
    for (const detail of entry.details ?? [entry]) {
      const key = keyOf(detail.provenance);
      const source = byKey.get(key) ?? new Map<string, Omit<CardSource, "details">>();
      source.set(JSON.stringify(detail), detail);
      byKey.set(key, source);
    }
  }

  return [...byKey.values()].map(source => {
    const details = [...source.values()];
    if (details.length === 1) return details[0];
    const coverages = details.filter(detail => !detail.status);
    return {
      what: [...new Set((coverages.length ? coverages : details).map(detail => detail.what))].join("; "),
      provenance: {
        ...details[0].provenance,
        sourceOrg: [...new Set(details.map(detail => detail.provenance.sourceOrg.trim()).filter(Boolean))].join("; "),
        collectedAt: details.map(detail => detail.provenance.collectedAt).filter(Boolean).sort().at(-1) ?? "",
        verifiedAt: details.map(detail => detail.provenance.verifiedAt).filter(Boolean).sort().at(-1) ?? null,
      },
      details,
    };
  });
}

export const FIELD_SOURCE_LABELS: Readonly<Record<string, string>> = {
  name: "Name", officeTitle: "Office", partyLabel: "Party", birthDate: "Birth date",
  termNote: "Term wording", termStart: "Term start date", termEnd: "Term end date",
  email: "Office email", phone: "Office phone", websiteUrl: "Official page", contactFormUrl: "Contact form",
  campaignUrl: "Campaign website", photoUrl: "Portrait", social: "Social accounts",
  districtOffices: "District offices", committees: "Committees", memberships: "Offices held",
  title: "Meeting title", bodyName: "Public body", startsAt: "Meeting date and time", endsAt: "Meeting end time",
  timeZone: "Time zone", status: "Meeting status", location: "Meeting place", online: "Online attendance",
  agendaUrl: "Agenda", videoUrl: "Meeting recording", minutesUrl: "Meeting minutes",
  commentPeriod: "Public comment", commentPeriodDetail: "Public comment details", signup: "How to sign up",
  writtenComment: "Written comments", attend: "How to attend", timeLimit: "Speaking time limit",
};

export function fieldSourceLabel(field: string): string {
  return FIELD_SOURCE_LABELS[field] ?? field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/^./, letter => letter.toUpperCase());
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
        sourceOrg: "",
        collectedAt: "",
        verifiedAt: null,
      },
    };
  }
  return null;
}

function retainedHolderSources(holder: SeatHolder): CardSource[] {
  return [...Object.entries(holder.fieldSources ?? {}).map(([field, provenance]) => ({ what: `${holder.name} — ${fieldSourceLabel(field)}`, provenance })), ...Object.entries(holder.retainedFieldSources ?? {}).flatMap(([field, source]) => {
    if (!source) return [];
    const label = fieldSourceLabel(field).toLowerCase();
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
): CardSource[] {
  const entries: CardSource[] = [
    { what: "This district's boundary, type and label", provenance: BOUNDARY_PROVENANCE },
  ];
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
  for (const [field, provenance] of Object.entries(meeting.fieldSources ?? {})) entries.push({ what: `This sitting — ${fieldSourceLabel(field)}`, provenance });
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
