import type { Body } from "../registry/types.ts";
import type { OcdId } from "../sources/types.ts";

/**
 * Which body actually acted on each part of an agenda. A county board's
 * agenda can carry a "sitting as other boards" region in which another board
 * (e.g. a library district) acts; one meeting, more than one acting body.
 *
 * An unresolved heading attributes to nothing, never to the host: the agenda
 * itself said the host was not acting. Its items are recorded as attributed to
 * no body.
 */

/** How a segment's acting body relates to the meeting's host. */
export type SegmentRole =
  /** The host body acting as itself. */
  | "HOST"
  /** The host sitting as some other board. */
  | "SITTING_AS";

/** Whether we could say which body this is, and if not, why not. */
export type AttributionState =
  /** The meeting's host body, which the source names directly. */
  | "HOST_BODY"
  /** Matched to a registry body. */
  | "RESOLVED"
  /** Named on the agenda, and nothing in the registry corresponds to it. */
  | "UNRESOLVED";

export interface AgendaSegment {
  /** The heading that opened this segment, exactly as published. */
  heading: string;
  /** The agenda item the heading itself is, so the citation is exact. */
  headingItemId: number | null;
  role: SegmentRole;
  attribution: AttributionState;
  /** The registry body, when one was matched. */
  bodyId: string | null;
  ocdId: OcdId | null;
  /** Why nothing was matched. Null when something was. */
  unresolvedReason: string | null;
  /** The substantive items under this heading — headings themselves excluded. */
  itemIds: number[];
}

/**
 * One row of the meeting-to-body join: a meeting has many bodies, a body has
 * many meetings, and `evidence` is the published heading, so an attribution
 * can be checked against the source.
 */
export interface MeetingBody {
  meetingId: string;
  /** Null is a legitimate, load-bearing value — see the file comment. */
  bodyId: string | null;
  ocdId: OcdId | null;
  role: SegmentRole;
  attribution: AttributionState;
  /** The agenda heading this was read from. Never paraphrased. */
  evidence: string;
  itemCount: number;
}

/** The item shape this needs. Structural, so the Legistar types stay in their adapter. */
export interface AgendaItem {
  id: number;
  sequence: number | null;
  title: string;
  /** Legistar's matter file number. A heading has none; a real item does. */
  matterFile: string | null;
}

/**
 * Headings that hand control to another board, or take it back. Deliberately
 * narrow: a false switch moves real business onto a body that never
 * considered it.
 */
const OPENS_OTHER_BOARDS = /\bsitting\s+as\s+other\s+boards\b/i;
const RETURNS_TO_HOST = /\b(sitting|acting)\s+as\s+the\s+board\s+of\s+supervisors\b/i;
const GENERIC_SITTING_AS = /\b(sitting|acting)\s+as\b/i;

/**
 * Typography that is not a body. Inside the sitting-as region a bare heading
 * names the acting board, so these must not open a segment:
 * - structurally, a heading with no letter (`* * *`, a rule of underscores);
 * - by name, "PAGE BREAK".
 * An artifact neither opens nor closes a segment; the acting body keeps acting.
 */
const LAYOUT_ARTIFACT_HEADINGS = [/^page\s*break$/i];

function isLayoutArtifact(text: string): boolean {
  if (!/\p{L}/u.test(text)) return true;
  return LAYOUT_ARTIFACT_HEADINGS.some((pattern) => pattern.test(text));
}

/**
 * Is this item a heading rather than business? A heading has no matter file;
 * relying on that field keeps the parse independent of a clerk's house style.
 */
function isHeading(item: AgendaItem): boolean {
  return !item.matterFile;
}

/** Squash whitespace so a heading compares and displays consistently. */
function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Split an agenda into the bodies that acted on it. Walks in agenda order: a
 * "sitting as other boards" heading opens a region in which each subsequent
 * bare heading names the acting body; a "sitting as the board of
 * supervisors" heading closes it. Outside that region everything belongs to
 * the host. These conventions are one Legistar client's; an agenda without
 * such headings yields a single host segment.
 */
export function segmentAgenda(
  items: AgendaItem[],
  hostBody: { bodyId: string | null; ocdId: OcdId | null; name: string },
): AgendaSegment[] {
  const ordered = [...items].sort(
    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.id - b.id,
  );

  const hostSegment = (heading: string, headingItemId: number | null): AgendaSegment => ({
    heading,
    headingItemId,
    role: "HOST",
    attribution: "HOST_BODY",
    bodyId: hostBody.bodyId,
    ocdId: hostBody.ocdId,
    unresolvedReason: null,
    itemIds: [],
  });

  const segments: AgendaSegment[] = [hostSegment(hostBody.name, null)];
  let current = segments[0];
  let inOtherBoards = false;

  for (const item of ordered) {
    const text = clean(item.title);

    // An item carrying a matter file is business even with no title. Only a
    // heading may be discarded for being blank.
    if (!text && isHeading(item)) continue;

    if (isHeading(item)) {
      // Typography first: a page break is not a change of government.
      if (isLayoutArtifact(text)) continue;

      if (OPENS_OTHER_BOARDS.test(text)) {
        // Announces the region; does not itself name a body. Nothing is
        // attributed until a heading actually names one.
        inOtherBoards = true;
        continue;
      }

      if (RETURNS_TO_HOST.test(text)) {
        inOtherBoards = false;
        current = hostSegment(text, item.id);
        segments.push(current);
        continue;
      }

      // Inside the region, a bare heading names the acting board. Outside it, a
      // heading is just a section title ("CALL TO THE PUBLIC") and must not
      // start a segment — the host keeps acting.
      if (inOtherBoards || GENERIC_SITTING_AS.test(text)) {
        current = {
          heading: text,
          headingItemId: item.id,
          role: "SITTING_AS",
          attribution: "UNRESOLVED",
          bodyId: null,
          ocdId: null,
          unresolvedReason: "not yet matched to a registry body",
          itemIds: [],
        };
        segments.push(current);
      }
      continue;
    }

    current.itemIds.push(item.id);
  }

  // A segment with no business under it is a heading nobody used. Dropping it
  // keeps the join from carrying rows that attribute nothing to anybody, while
  // always keeping the host segment so a meeting is never left with no body.
  return segments.filter((s, i) => i === 0 || s.itemIds.length > 0);
}

/**
 * Try to name the body a "sitting as" heading refers to. Only bodies whose
 * division sits inside the host's own division are considered, and the
 * registry must hold a body whose division label the heading contains. A
 * special district with no published boundary stays unresolved, never the
 * host.
 */
export function resolveSegment(
  segment: AgendaSegment,
  bodies: Body[],
  divisionLabels: Map<string, string>,
  hostOcdId: OcdId | null,
): AgendaSegment {
  if (segment.role === "HOST") return segment;

  const verdict = matchHeading(segment.heading, bodies, divisionLabels, hostOcdId);
  if (verdict.body) {
    return {
      ...segment,
      attribution: "RESOLVED",
      bodyId: verdict.body.id,
      ocdId: verdict.body.ocdId,
      unresolvedReason: null,
    };
  }
  return {
    ...segment,
    attribution: "UNRESOLVED",
    bodyId: null,
    ocdId: null,
    unresolvedReason: verdict.reason,
  };
}

/**
 * The one place a heading is compared against the registry, shared by the
 * segment path and the row path (`resolveMeetingBodies`).
 */
function matchHeading(
  heading: string,
  bodies: Body[],
  divisionLabels: Map<string, string>,
  hostOcdId: OcdId | null,
): { body: Body | null; reason: string | null } {
  const text = heading.toLowerCase();

  const candidates = bodies.filter((body) => {
    if (!body.ocdId) return false;
    // Only inside the host's own division. A county board cannot sit as a board
    // in another county, and widening this is how a name match goes wrong.
    if (hostOcdId && !body.ocdId.startsWith(hostOcdId)) return false;
    const label = divisionLabels.get(body.ocdId);
    return !!label && text.includes(label.toLowerCase());
  });

  if (candidates.length === 1) return { body: candidates[0], reason: null };
  return {
    body: null,
    reason:
      candidates.length > 1
        ? `heading matches ${candidates.length} divisions; ambiguous`
        : "no division in the registry corresponds to this heading",
  };
}

/**
 * Resolve join rows that were built without the registry in hand: the
 * adapter's `segmentAgenda` is pure, so rows arrive UNRESOLVED with their
 * evidence and are upgraded here where the registry is loaded. HOST rows pass
 * through, an already RESOLVED row is never re-decided, and a row this cannot
 * name keeps `bodyId: null` and `ocdId: null`: the host's identifiers are
 * never written onto it.
 */
export function resolveMeetingBodies(
  rows: MeetingBody[],
  bodies: Body[],
  divisionLabels: Map<string, string>,
  hostOcdId: OcdId | null,
): MeetingBody[] {
  return rows.map((row) => {
    if (row.role === "HOST" || row.attribution === "RESOLVED") return row;
    const verdict = matchHeading(row.evidence, bodies, divisionLabels, hostOcdId);
    if (!verdict.body) return row;
    return {
      ...row,
      attribution: "RESOLVED" as const,
      bodyId: verdict.body.id,
      ocdId: verdict.body.ocdId,
    };
  });
}

/** Flatten resolved segments into join rows. */
export function meetingBodiesFor(
  meetingId: string,
  segments: AgendaSegment[],
): MeetingBody[] {
  return segments.map((s) => ({
    meetingId,
    bodyId: s.bodyId,
    ocdId: s.ocdId,
    role: s.role,
    attribution: s.attribution,
    evidence: s.heading,
    itemCount: s.itemIds.length,
  }));
}

/** What an ingest run should report about attribution; an unresolved segment is a work item. */
export function attributionSummary(rows: MeetingBody[]): {
  host: number;
  resolved: number;
  unresolved: number;
  itemsUnattributed: number;
} {
  return {
    host: rows.filter((r) => r.attribution === "HOST_BODY").length,
    resolved: rows.filter((r) => r.attribution === "RESOLVED").length,
    unresolved: rows.filter((r) => r.attribution === "UNRESOLVED").length,
    itemsUnattributed: rows
      .filter((r) => r.attribution === "UNRESOLVED")
      .reduce((n, r) => n + r.itemCount, 0),
  };
}
