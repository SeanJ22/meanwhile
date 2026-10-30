import { REGISTRY_STATES } from "../civic-data/state-scopes.ts";
import { findingFact, type BoxFinding, type BoxLink, type BoxRepository } from "../control-plane/box.ts";
import { newestFirst, type WorkInput, type WorkList } from "../core/work.ts";
import { splitSubject } from "../facts/entities.ts";
import type { Query } from "../facts/publish.ts";
import { HANDOFFS, type Handoff } from "./handoff.ts";
import { platformOf } from "./platform-of.ts";

/** What hunters find waits in the Box for a short hop only: a link moves to the work list as a link to read, a handoff as a fact row for its reader. Small rows cross; no finding is opened except a handoff. */
export const BOX_LINKS_PER_TURN = 500;

const stateOf = (id: string): string => {
  const found = (/^([a-z]{2}):/.exec(id)?.[1] ?? /\/(?:state|territory|district):([a-z]{2})(?:\/|$)/.exec(id)?.[1] ?? /^government:US-([A-Z]{2}):/.exec(id)?.[1])?.toUpperCase();
  return found && (REGISTRY_STATES as readonly string[]).includes(found) ? found : "US";
};

const leadOf = (link: BoxLink): WorkInput | null => {
  if (!/^https?:\/\//i.test(link.url) || !URL.canParse(link.url)) return null;
  const placeId = link.governmentId ?? splitSubject(link.subjectId).root;
  return { kind: "lead", state: stateOf(placeId), placeId, subjectId: link.subjectId, url: link.url, value: { platform: platformOf(link.url) }, priority: newestFirst(link.foundAt),
    dueAt: link.foundAt, origin: { from: "loader" }, source: { source: "Found by a hunter", foundOn: link.foundOn, boxId: link.id } };
};

/** The state each work item was about, from the jurisdiction its plan recorded or the divisions its obligation scopes. A subject's own spelling is not trusted for this. */
export function workStates(query: Query) {
  return async (workItemIds: readonly string[]): Promise<ReadonlyMap<string, string>> => {
    if (!workItemIds.length) return new Map();
    const rows = await query(`SELECT w.id, coalesce((regexp_match(upper(w.value#>>'{autonomousPlan,contract,jurisdiction,state}'),'^(?:US-)?([A-Z]{2})$'))[1],
        (regexp_match(upper(w.value#>>'{autonomousPlan,jurisdiction}'),'^(?:US-)?([A-Z]{2})$'))[1]) AS state FROM cp_work_items w WHERE w.id = ANY($1::text[])
      UNION ALL SELECT c.value->>'workItemId', upper((regexp_match(division,'^ocd-division/country:us/state:([a-z]{2})(?:/|$)'))[1])
        FROM cp_occurrences c JOIN cp_obligations b ON b.id = c.value->>'obligationId'
        CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(b.value->'scopeDivisions', '[]')) a(division) WHERE c.value->>'workItemId' = ANY($1::text[])`, [workItemIds]);
    return new Map(rows.flatMap(row => row.state === null ? [] : [[String(row.id), String(row.state)] as const]));
  };
}

const handoffOf = (handoff: Handoff, finding: BoxFinding, state: string | undefined): WorkInput => {
  const placeId = splitSubject(finding.subjectId).root, found = finding.lastRecordedAt ?? finding.origins[0]!.recordedAt;
  return { kind: "fact", state: state ?? stateOf(placeId), placeId, subjectId: finding.subjectId, field: findingFact(finding)?.field ?? "finding", claimKey: finding.id, url: finding.sourceUrl,
    quote: finding.exactQuote, value: { platform: handoff, finding }, priority: newestFirst(found), dueAt: found, origin: { from: "loader" },
    source: { source: "Found by a hunter", foundOn: finding.sourceUrl, boxId: finding.id } };
};

/** One turn of the move: returns how many findings left the Box. A link that names no address leaves too, since nothing can read it. */
export async function moveBoxLinks(input: { readonly box: BoxRepository; readonly list: WorkList; readonly now: () => Date; readonly limit?: number;
  /** Where a handed-off finding is placed by its work item (`workStates`); without it, by its subject. */
  readonly states?: (workItemIds: readonly string[]) => Promise<ReadonlyMap<string, string>> }): Promise<number> {
  const limit = input.limit ?? BOX_LINKS_PER_TURN, now = input.now().toISOString();
  let moved = 0;
  const links = await input.box.waitingLinks(limit);
  if (links.length) {
    await input.list.ensure(links.flatMap(link => leadOf(link) ?? []));
    moved += await input.box.moved(links.map(link => link.id), now);
  }
  for (const [handoff, reason] of HANDOFFS) {
    const rows = await input.box.waitingFor(reason, limit);
    if (!rows.length) continue;
    const states = await input.states?.([...new Set(rows.flatMap(row => row.origins.map(origin => origin.workItemId)))]);
    await input.list.ensure(rows.map(row => handoffOf(handoff, row, row.origins.map(origin => states?.get(origin.workItemId)).find(Boolean))));
    moved += await input.box.moved(rows.map(row => row.id), now);
  }
  return moved;
}
