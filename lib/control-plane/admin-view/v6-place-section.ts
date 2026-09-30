import { CHECKLIST_PROFILE } from "../readiness/checklist-score.ts";
import type { OwedState } from "./place-scorecard.ts";
import { OWED_STATE_WORDS, pageOwed, scorePlace, type GroupScore, type OwedListItem, type OwedRowLike } from "./place-scorecard.ts";
import { GROUP_NAMES, PLACE_GROUPS, ADMIN_V6_CHECKLIST_CONTRACT } from "./v6-checklist-section.ts";
import type { PlaceOwedRead } from "./place-owed-read.ts";
import { US_STATES } from "../readiness/catalog.ts";
import { sendWordsFor } from "./blocker-causes.ts";

/**
 * **`admin-v6/checklist@1` FOR ANY PLACE: SEAN'S SCORE AND THE OWED LIST BEHIND IT.**
 *
 * Structurally matches Admin v6 `ChecklistView` (model.ts) without importing the
 * UI bundle. `score` is the place's capture scorecard (place-scorecard.ts);
 * `placeGroups` fills the existing status bars; `items` is one window of the
 * owed list for the chosen group. The score never gates publishing.
 */
export const PLACE_ITEM_PAGE = 50;

/** The place-group order the checklist uses (its own profile order, place groups only). */
const GROUP_ORDER: readonly string[] = [...new Set(CHECKLIST_PROFILE.definitions.map((d) => d.group))];

const DEFINITIONS = CHECKLIST_PROFILE.definitions.map((d) => ({ id: d.id, group: d.group, requirement: d.requirement, owner: d.owner, label: d.label }));
const SYSTEM_GROUPS = GROUP_ORDER.filter((g) => !PLACE_GROUPS.has(g)).map((group) => ({ group, name: GROUP_NAMES[group] ?? group, counts: null, audit: null }));

/** Owed state → the checklist screen's seven statuses (ITEM_STATUS_ORDER: checked, published, collected, can-do, needs-fix, unsure, absent). */
const STATUS_INDEX: Readonly<Record<OwedState, number>> = { published: 1, held: 2, stale: 3, missing: 3, unpublished: 6 };
const STATUS_NAME: Readonly<Record<OwedState, "published" | "collected" | "can-do" | "absent">> = {
  published: "published", held: "collected", stale: "can-do", missing: "can-do", unpublished: "absent",
};

export interface AdminV6PlaceScore {
  readonly placeKey: string;
  readonly placeLabel: string;
  readonly covers: string;
  readonly observedAt: string;
  readonly divisionCount: number;
  readonly overall: GroupScore;
  readonly groups: readonly GroupScore[];
}
export interface AdminV6PlaceItem {
  readonly key: string;
  readonly definitionId: string;
  readonly name: string;
  readonly subject: string;
  readonly period: string;
  readonly status: "published" | "collected" | "can-do" | "absent";
  readonly missing: string;
  readonly appliesBecause: string;
  readonly owner: string;
  readonly next: string;
  readonly parts: readonly { readonly text: string; readonly status: string; readonly proof: string; readonly tone: "good" | "warn" | "muted" }[];
  readonly sourceUrl: string | null;
  readonly actions: readonly { readonly kind: "send-agents"; readonly target: string; readonly label: string; readonly payload: { readonly words: string } }[];
}
export interface AdminV6PlaceChecklistView {
  readonly profileVersion: string;
  readonly definitionCount: number;
  readonly definitions: typeof DEFINITIONS;
  readonly groupNames: Readonly<Record<string, string>>;
  readonly placeGroups: readonly { readonly group: string; readonly name: string; readonly counts: readonly number[] }[];
  readonly items: readonly AdminV6PlaceItem[];
  readonly systemGroups: typeof SYSTEM_GROUPS;
  readonly score: AdminV6PlaceScore;
}

/** What the runner should read as this place: the state, plus the ZIP or the county's own name as the one term. */
export function placeSendWords(placeKey: string, label: string): string | null {
  const m = /^(?:geo:|st:)([a-z]{2})(?:.([a-z_]+).([0-9A-Za-z]+))?$/.exec(placeKey);
  const state = m ? US_STATES.find((s) => s.code === m[1])?.name ?? null : null;
  if (!m || state === null) return null;
  const county = m[2] === "county" ? label.replace(/s+County$/i, "").trim() : null;
  return sendWordsFor({ stateNames: [state], zip: m[2] === "zcta" ? m[3] : county, subject: null, label: null });
}

function itemOf(item: OwedListItem, placeKey: string, words: string | null): AdminV6PlaceItem {
  const status = STATUS_NAME[item.state];
  const open = item.state === "missing" || item.state === "stale";
  return {
    key: item.key, definitionId: item.checklistId, name: item.requirement.split(" — ")[0] ?? item.requirement,
    subject: item.subject, period: "Current", status,
    missing: item.state === "published" ? "Nothing missing for this item."
      : item.state === "held" ? "Captured from an official source and waiting to publish."
      : item.state === "unpublished" ? "The government does not publish this."
      : item.state === "stale" ? "Captured before, and its freshness window has passed. Agents refresh it from the source we already know."
      : "No agent has captured this yet. It stays open as standing work.",
    appliesBecause: `Owed to ${item.subjectKind === "division" ? "the place itself" : `a ${item.subjectKind}`} this place is served by.`,
    owner: open ? "Agents" : "Nobody — held", next: open ? "Send agents to capture it." : "Nothing to do.",
    parts: [{ text: item.requirement, status: OWED_STATE_WORDS[item.state], tone: open ? "warn" : "good",
      proof: item.sourceUrl ? `Saved from ${item.sourceUrl}${item.checkedAt ? `, checked ${item.checkedAt}` : ""}.` : "No saved official page yet." }],
    sourceUrl: item.sourceUrl,
    actions: open && words !== null ? [{ kind: "send-agents", target: placeKey, label: "Send agents", payload: { words } }] : [],
  };
}

export interface PlaceSectionQuery { readonly group: string | null; readonly states: readonly OwedState[] | null; readonly q: string | null; readonly offset: number; readonly limit: number }

export function v6PlaceSection(read: PlaceOwedRead, query: PlaceSectionQuery): {
  readonly contract: typeof ADMIN_V6_CHECKLIST_CONTRACT; readonly scope: string; readonly revision: string; readonly asOf: string;
  readonly data: AdminV6PlaceChecklistView; readonly missingParts: readonly string[];
  readonly page: { readonly total: number; readonly nextCursor: string | null; readonly prevCursor: string | null };
} {
  const rows = read.rows as readonly OwedRowLike[];
  const score = scorePlace(rows, GROUP_NAMES, GROUP_ORDER);
  const windowed = pageOwed(rows, query);
  const placeGroups = score.groups.filter((g) => PLACE_GROUPS.has(g.group)).map((g) => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    counts[STATUS_INDEX.published] += g.published; counts[STATUS_INDEX.held] += g.held;
    counts[STATUS_INDEX.stale] += g.stale + g.missing; counts[STATUS_INDEX.unpublished] += g.unpublished;
    return { group: g.group, name: g.name, counts };
  });
  return {
    contract: ADMIN_V6_CHECKLIST_CONTRACT, scope: read.placeKey,
    revision: `place:${read.placeKey}:${read.observedAt}:${query.group ?? "all"}:${query.states?.join("+") ?? "all"}:${query.offset}:${query.q ?? ""}`,
    asOf: read.observedAt,
    data: {
      profileVersion: CHECKLIST_PROFILE.version, definitionCount: CHECKLIST_PROFILE.definitionCount, definitions: DEFINITIONS,
      groupNames: GROUP_NAMES, placeGroups, items: windowed.items.map((i) => itemOf(i, read.placeKey, placeSendWords(read.placeKey, read.label))), systemGroups: SYSTEM_GROUPS,
      score: { placeKey: read.placeKey, placeLabel: read.label, covers: read.covers, observedAt: read.observedAt,
        divisionCount: read.divisions.length, overall: score.overall, groups: score.groups },
    },
    missingParts: [
      "The owed list is what the checklist says a place is owed for the governments, districts and bodies we know about. Governments we haven’t found yet are listed as “discover every …” items, so a total here can grow as agents find more.",
      "Captured means we hold it from an official source. It is not a check of the public page, and it never holds back publishing.",
    ],
    page: { total: windowed.total, nextCursor: windowed.nextOffset === null ? null : String(windowed.nextOffset), prevCursor: windowed.prevOffset === null ? null : String(windowed.prevOffset) },
  };
}

/** A scope with no owed list (the whole country, or a geography type without one): the real definitions stay, and the score says plainly it is not measured here. */
export function v6PlaceNotMeasured(placeKey: string, says: string, asOf: string) {
  return {
    contract: ADMIN_V6_CHECKLIST_CONTRACT, scope: placeKey, revision: `place:${placeKey}:not-measured`, asOf,
    data: { profileVersion: CHECKLIST_PROFILE.version, definitionCount: CHECKLIST_PROFILE.definitionCount, definitions: DEFINITIONS,
      groupNames: GROUP_NAMES, placeGroups: null, items: null, systemGroups: SYSTEM_GROUPS, score: null },
    missingParts: [says],
    page: { total: null, nextCursor: null, prevCursor: null },
  };
}
