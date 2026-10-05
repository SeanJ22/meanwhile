import type { Meeting, Provenance } from "../sources/types.ts";

import type { RollCallVote } from "../votes/types.ts";
import type { ExecutiveAction } from "./executive-actions.ts";
import type { SeatHolder } from "./lookup.ts";

/**
 * **What a battlecard actually drew on — assembled once, for every card
 * class.** (Item 1, 2026-08-16.)
 *
 * ## The defect this exists to end
 *
 * The Sources tab rendered "Nothing on this card came from an external
 * record" on the Tucson Unified District card — a card whose every fact came
 * from an external record: the boundary from Census TIGER/Line, the governing
 * board from the district's own roster page, the sittings from the district's
 * own agenda vendor. The sentence was live on production and it was false.
 *
 * The cause was one line: `districtSubject` in `map-entry.tsx` passed
 * `sources: []`. The tab was never wired to the provenance the data
 * underneath had been carrying all along. Only the meeting card ever built a
 * source list, and it built its own inline — a parallel join, which is the
 * shape this repo has now been bitten by four times.
 *
 * So there is one assembler. Every card class calls it, and the honest empty
 * sentence renders only where it comes back empty — which, in a product whose
 * whole claim is sourced accuracy, should be almost nowhere.
 *
 * ## One row per distinct source, not one row per fact
 *
 * A district card can list thirty sittings from one vendor. Thirty identical
 * provenance blocks is not transparency, it is noise that hides the two rows
 * a reader would actually check. Rows are merged by (org, url) and the `what`
 * line names how many facts each source is behind — the count and its
 * denominator, per the repo's standing rule.
 *
 * ## The count is stated, and the guard holds it
 *
 * `sourceCountLabel` is what the tab renders beside its name. It is computed
 * from the same array the tab maps over, so the stated N cannot drift from
 * the rendered rows; `tests/card-sources.test.ts` asserts that per card
 * class, and asserts that a card holding any externally sourced fact never
 * renders the empty sentence.
 */

export interface CardSource {
  /** Which facts on this card this source is behind. */
  what: string;
  provenance: Provenance;
}

/**
 * Where the district and place boundaries — and therefore every district
 * card's identity, type and label — come from.
 *
 * Not invented here: this is the endpoint `scripts/fetch-districts.ts`
 * actually fetches, and the vintage it pins. A card that renders a boundary
 * is making a claim about where a government's authority stops, and that
 * claim has a publisher.
 */
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

/**
 * Merge same-source entries, keeping the earliest-seen `what` and counting
 * the rest.
 *
 * The merged `what` states the count AND what is being counted, so a source
 * behind one fact and a source behind thirty read differently — a bare
 * number with no denominator is exactly the shape the count rule forbids.
 */
export function mergeSources(entries: CardSource[]): CardSource[] {
  const byKey = new Map<string, { entry: CardSource; extra: number }>();

  for (const entry of entries) {
    const key = keyOf(entry.provenance);
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
  // A holder with a bare URL and no publisher/date is still a source, and
  // saying so beats dropping it: an omitted row implies everything shown was
  // cited by something better.
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

/**
 * Every record behind a DISTRICT or DIVISION battlecard.
 *
 * Three classes of fact, and all three are external: the boundary that makes
 * the card exist, the people the card says represent it, and the sittings it
 * lists.
 */
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
    { what: `This sitting — ${meeting.title}`, provenance: meeting.provenance },
  ];
  for (const [field, provenance] of Object.entries(meeting.fieldSources ?? {})) entries.push({ what: `This sitting — ${field}`, provenance });
  if (meeting.agendaUrl) entries.push({ what: "The published agenda link", provenance: { ...meeting.provenance, sourceUrl: meeting.agendaUrl } });
  for (const [kind, label] of Object.entries(MEETING_SOURCE_LABELS)) {
    for (const provenance of evidence[kind as keyof MeetingCardEvidence] ?? []) entries.push({ what: label, provenance });
  }
  // BX-10: the recording is linked from the publisher's own record of the sitting, so that record is its source.
  if (meeting.videoUrl) entries.push({ what: "The recording of this sitting", provenance: meeting.provenance });

  for (const holder of representation) {
    const source = holderSource(holder, `Who sits on this body — ${holder.name}`);
    if (source) entries.push(source);
    entries.push(...retainedHolderSources(holder));
  }

  return mergeSources(entries);
}

/**
 * Every record behind a PERSON battlecard.
 *
 * The roster row is the spine — name, office, party, contact, term. The
 * directory adds its own row when the card is drawing on it (item 7), and the
 * photo carries the door it shipped through, because a portrait is a claim
 * about a face and the photo rule is the reason it may be shown at all.
 *
 * Money, votes and official actions join this same Sources list. Their
 * sections pass the records they actually display; absent sections add no rows.
 */
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

/**
 * The Polarization Research Lab's measurements, credited to the lab in the
 * card's Sources. Meanwhile names the measurement and its maker and never
 * scores, rates or labels the person itself.
 */
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

/**
 * What the Sources tab states beside its name.
 *
 * Computed from the array the tab renders, never counted a second way — a
 * stated N that is derived separately from the rows is how a count comes to
 * disagree with what is on screen.
 */
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
