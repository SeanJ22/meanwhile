import type { Body } from "../registry/types.ts";
import type { OcdId } from "../sources/types.ts";

/**
 * Which body actually acted on each part of an agenda.
 *
 * **This is not a hypothetical.** Pima County's Board of Supervisors meeting of
 * 2026-08-11 (EventId 1824, 124 items) carries the headings "BOARD OF
 * SUPERVISORS SITTING AS OTHER BOARDS", then "LIBRARY DISTRICT BOARD", then
 * "SITTING AS THE BOARD OF SUPERVISORS". The contract for library periodicals
 * sitting between the second and third of those is **Library District
 * business**, decided by the Library District's board. One meeting, one host,
 * more than one acting body.
 *
 * Without this, every one of those 124 items records as county-board business,
 * which is the misattribution tracker **D19** exists to prevent. `Meeting.ocdId`
 * is a single field and cannot express it — hence a join, which the Phase 5.1
 * brief already says is not optional.
 *
 * **The rule that shapes the whole file: an unresolved heading attributes to
 * NOTHING.** Never to the host. Falling back to the host is precisely the wrong
 * answer, because the host is the body we can already see is not responsible —
 * the agenda said so in capital letters. A segment we cannot resolve is recorded
 * as unresolved and its items are attributed to no body at all, which is a
 * smaller, truer claim than the one it replaces.
 *
 * It is also the 4.7.6 point in miniature: a large share of the country's
 * ~39,555 special districts are reachable through a county feed already in
 * Legistar, rather than through 39,555 separate source hunts. But only if the
 * items can be told apart once they arrive.
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
 * One row of the meeting-to-body join.
 *
 * Shaped as the table it will become. `lib/db/schema.ts` is still empty and this
 * lives in memory like the rest of the read path, but the columns are settled
 * here so the migration is a transcription rather than a redesign: a meeting has
 * many bodies, a body has many meetings, and the row carries **why** it thinks
 * so. `evidence` is the published heading, so an attribution can always be
 * checked against the source rather than trusted.
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
 * Headings that hand control to another board, or take it back.
 *
 * Read off Pima's published agenda rather than invented, and deliberately
 * narrow. Over-detection is the dangerous direction here: a false switch moves
 * real county business onto a body that never considered it, which is the same
 * misattribution this file exists to prevent, just pointing the other way.
 */
const OPENS_OTHER_BOARDS = /\bsitting\s+as\s+other\s+boards\b/i;
const RETURNS_TO_HOST = /\b(sitting|acting)\s+as\s+the\s+board\s+of\s+supervisors\b/i;
const GENERIC_SITTING_AS = /\b(sitting|acting)\s+as\b/i;

/**
 * Typography that is not a body (g10, found by running the live path).
 *
 * Inside the sitting-as region a bare heading names the acting board, and the
 * first live run took Pima's page-break markers at their word: **"PAGE BREAK"
 * opened a segment**, so the item that followed it was cut off the district
 * actually acting and attributed to a board that does not exist. Measured
 * against fifteen live Pima agendas, the region contains eight distinct
 * headings — seven real district boards and this one artifact, five times.
 *
 * The two rules are deliberately different in kind. The first is STRUCTURAL:
 * a heading with no letter in it (`* * *`, a rule of underscores, the
 * signature line) cannot be naming a government. The second is a NAMED list
 * of one, because "PAGE BREAK" is real text and only a clerk's layout habit
 * makes it meaningless — exactly the kind of judgment that has to be written
 * down with its evidence rather than inferred by a cleverer regex.
 *
 * An artifact neither opens a segment nor closes one. The body that was
 * acting keeps acting across the page break, which is what a page break
 * means.
 */
const LAYOUT_ARTIFACT_HEADINGS = [/^page\s*break$/i];

function isLayoutArtifact(text: string): boolean {
  if (!/\p{L}/u.test(text)) return true;
  return LAYOUT_ARTIFACT_HEADINGS.some((pattern) => pattern.test(text));
}

/**
 * Is this item a heading rather than business?
 *
 * A heading has no matter file — Legistar attaches one to anything with a
 * legislative record behind it. That single field does most of the work, and
 * leaning on it rather than on capitalisation keeps the parse from depending on
 * a clerk's house style.
 */
function isHeading(item: AgendaItem): boolean {
  return !item.matterFile;
}

/** Squash whitespace so a heading compares and displays consistently. */
function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Split an agenda into the bodies that acted on it.
 *
 * Walks in agenda order. A "sitting as other boards" heading opens a region in
 * which each subsequent bare heading names the acting body; a "sitting as the
 * board of supervisors" heading closes it. Outside that region everything
 * belongs to the host.
 *
 * **The conventions are one client's**, observed on Pima's agendas. Another
 * Legistar client may mark this differently or not at all, and an agenda with no
 * such headings correctly yields a single host segment — which is the common
 * case and must stay cheap.
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

    // An item carrying a matter file is business even with no title, and Pima's
    // agenda has exactly one of those. Skipping on empty text first dropped it
    // silently — 49 items with a matter file, 48 attributed, and nothing said
    // so. Only a *heading* may be discarded for being blank, because a heading
    // with no text names no body.
    if (!text && isHeading(item)) continue;

    if (isHeading(item)) {
      // Typography first, before anything reads this as a body: a page break
      // is not a change of government, and treating it as one steals the
      // items after it from the district that is actually acting.
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
 * Try to name the body a "sitting as" heading refers to.
 *
 * **Scoped deliberately hard.** It only ever considers bodies whose division
 * sits inside the host's own division, and it requires the registry to have a
 * body whose division label the heading actually contains. That is not the name
 * matching `CLAUDE.md` forbids — it is not joining two geographic datasets on
 * colloquial names; it is reading one publisher's own heading and asking whether
 * this repo holds a corresponding division, with every failure reported.
 *
 * For the live Pima case it **returns nothing, and that is the correct answer.**
 * The Pima County Public Library District is a special district; Census
 * publishes no boundary for it, so the registry has no division and no body.
 * Recording the segment as unresolved is a true statement. Guessing the county
 * board would be the exact error this exists to stop.
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
 * The one place a heading is compared against the registry.
 *
 * Extracted so the segment path and the row path (`resolveMeetingBodies`,
 * below) cannot drift into two slightly different ideas of what counts as a
 * match — which is how a scoping rule this narrow quietly widens.
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
 * Resolve join rows that were built without the registry in hand (D19, g10).
 *
 * The adapter runs `segmentAgenda`, which is pure and needs nothing but the
 * agenda; the registry lives on disk and is loaded by the ingest run. So the
 * rows arrive UNRESOLVED with their evidence intact and this upgrades the ones
 * the registry can name, at the layer that actually holds it. An adapter that
 * had to load `registry.json` to normalize would be an adapter that cannot run
 * in a test, and every other adapter would inherit the requirement.
 *
 * HOST rows pass through untouched, and an already-RESOLVED row is never
 * re-decided. A row this cannot name keeps `bodyId: null` and `ocdId: null` —
 * **the host's identifiers are never written onto it**, which is the whole
 * rule, stated once more at the only other place that could break it.
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

/**
 * What an ingest run should report about attribution.
 *
 * Printed rather than swallowed for the same reason every other count in this
 * repo is: an unresolved segment is a work item — a special district reachable
 * through a county feed, waiting for somewhere to be recorded — and a number
 * nobody prints is a number nobody chases.
 */
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
