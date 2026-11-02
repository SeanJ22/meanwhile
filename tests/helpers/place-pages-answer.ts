type Row = Record<string, unknown>;
export interface FixturePage { page_id: string; page_kind: string; built_at: string; body_ids?: readonly string[]; version?: number; row: unknown }

const LENT = 1_000_000;
const records = (value: unknown): Row[] => Array.isArray(value) ? value as Row[] : [];
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const ownBoard = (scope: string): string | null => { const match = /^source:[^:]+:body:([^:]+)/.exec(scope); return match ? decodeURIComponent(match[1]!) : null; };

/** Interns a card's pages and stamps the way a slice lists them. */
function stamper() {
  const sources: string[] = [], stamps: unknown[][] = [];
  const stamp = (url: unknown, time: unknown, kind?: unknown) => {
    const source = typeof url === "string" && url ? (sources.includes(url) ? sources.indexOf(url) : sources.push(url) - 1) : null;
    const held = kind === undefined ? [source, new Date(String(time ?? 0)).toISOString()] : [source, new Date(String(time ?? 0)).toISOString(), String(kind)];
    const at = stamps.findIndex(row => JSON.stringify(row) === JSON.stringify(held));
    return at >= 0 ? at : stamps.push(held) - 1;
  };
  return { sources, stamps, stamp };
}

/**
 * What the slice statement answers for a selection whose pages a fixture holds as rows: each page's boards, facts, rosters and sittings split
 * into the cards of its place and of its boards, as the slice job would have written them. A page of a board stands as the card of a place
 * that only lends that board.
 */
export function slicedAnswer(pages: readonly FixturePage[], params: readonly unknown[]): Record<string, unknown>[] {
  const given = params[0] as string[], named = params[1] as string[];
  const out = { places: [] as unknown[], boards: [] as unknown[], filed: [] as unknown[], meta: [] as unknown[], req: [...new Set(pages.flatMap(page => page.body_ids ?? named))],
    entities: {} as Record<string, unknown>, parents: {} as Record<string, unknown>, classes: [] as unknown[], states: {} as Record<string, string> };
  const boardCards = new Map<string, { sittings: unknown[]; parts: Row[]; historyParts: Row[]; archived: Row[]; documents: Row[]; archivedDocuments: Row[]; stamper: ReturnType<typeof stamper> }>();
  const placeCards = new Map<string, { parts: Row[] }>();
  const card = (board: string) => { let held = boardCards.get(board); if (!held) boardCards.set(board, held = { sittings: [], parts: [], historyParts: [], archived: [], documents: [], archivedDocuments: [], stamper: stamper() }); return held; };
  let lent = 0, beyond = given.length;
  for (const page of pages) {
    const row = page.row as Row, entities = records(row.entities), aliases = (row.body_aliases ?? {}) as Record<string, string>, canon = (id: unknown) => aliases[String(id)] ?? String(id);
    const place = page.page_kind === "place" || given.includes(page.page_id);
    const n = place ? (given.indexOf(page.page_id) + 1 || ++beyond) : LENT + ++lent;
    if (place) out.meta.push([n, page.page_id, null, true]);
    const bodies = stamper(), persons = stamper(), shownOf = new Map<string, string>(), personFacts = new Map<string, Record<string, unknown>>(), entityFacts = new Map<string, Record<string, unknown>>();
    const put = (id: string, key: string, value: unknown, quote: unknown, url: unknown, time: unknown, kind: unknown) => {
      const facts = entityFacts.get(id) ?? {}; entityFacts.set(id, facts);
      facts[key] = [value, bodies.stamp(url, time, kind ?? "OFFICIAL"), quote === null || quote === undefined ? null : quote];
    };
    for (const field of [...records(row.fields), ...records(row.comments)]) put(String(field.entity_id), String(field.field), field.value, field.quote, field.url, field.checked_at, field.provenance_kind);
    for (const member of records(row.rosters)) {
      put(String(member.body_id), `member:${member.person_id}`, member.value, member.quote, member.url, member.checked_at, member.provenance_kind);
      const facts: Record<string, unknown> = personFacts.get(String(member.person_id)) ?? {};
      for (const [field, held] of Object.entries((member.person ?? {}) as Record<string, Row>)) facts[field] = [held.value, persons.stamp(held.url, held.checked, "OFFICIAL"), held.quote ?? null];
      personFacts.set(String(member.person_id), facts); if (member.shown_id) shownOf.set(String(member.person_id), String(member.shown_id));
    }
    const bodyEntities = entities.map(entity => {
      const id = String(entity.id), divisions = strings(entity.divisions).length ? strings(entity.divisions) : entity.placed === true && typeof entity.division === "string" ? [entity.division] : [];
      if (place) out.filed.push([n, id, id]);
      if (typeof entity.state === "string") out.states[id] = entity.state;
      out.entities[id] = [String(entity.name ?? id), entity.parent_id ?? null, entity.state ?? null];
      if (typeof entity.parent_id === "string") out.parents[entity.parent_id] = typeof entity.government === "string" ? ["government", entity.government, null, null]
        : [entity.parent_id.startsWith("ocd-division/") ? "place" : "government", entity.parent_id, null, null];
      return { id, k: "body", n: String(entity.name ?? id), ...(typeof entity.parent_id === "string" ? { p: entity.parent_id } : {}), ...(divisions.length ? { d: divisions } : {}),
        ...(entity.placement_basis === "HOST_COUNTY" ? { h: 1 } : {}), f: entityFacts.get(id) ?? {} };
    });
    const people = [...personFacts].map(([id, f]) => ({ id, k: "person", n: id, ...(shownOf.has(id) ? { x: shownOf.get(id) } : {}), f }));
    out.places.push([n, "bodies", { v: 2, sources: bodies.sources, stamps: bodies.stamps, boards: [], entities: bodyEntities, reg: { governments: records(row.governments), divisions: records(row.divisions) } }]);
    if (people.length) out.places.push([n, "governs", { v: 2, sources: persons.sources, stamps: persons.stamps, boards: [], entities: people }]);
    for (const sitting of records(row.sittings)) {
      const held = card(canon(sitting.body_id));
      held.sittings.push([canon(sitting.body_id), sitting.entity_id, sitting.field, sitting.value, held.stamper.stamp(sitting.url, sitting.checked_at), sitting.status ?? "live", sitting.quote ?? null]);
    }
    for (const partition of records(row.meeting_rows)) {
      const scope = String(partition.scope), payload = partition.payload as Row, history = scope.endsWith(":history"), family = scope.startsWith("source:derived:family:");
      const { meetings, agendaDocuments, derivedMembers, agendaDocumentLinks: _links, ...head } = payload;
      const part = (rows: Row[], members?: Row[]) => ({ s: scope, v: String(partition.current_version_id), c: partition.confirmation ?? null, h: head, ...(members ? { m: members } : {}), r: rows });
      const owner = ownBoard(scope);
      const boards = owner ? [canon(owner)] : family ? [...new Set(records(meetings).flatMap(meeting => meeting.bodyId ? [canon(meeting.bodyId)] : []))] : [];
      for (const board of boards) {
        const rows = records(meetings).filter(meeting => canon(meeting.bodyId) === board);
        const members = derivedMembers === undefined ? undefined : records(derivedMembers).filter(member => canon(member.bodyId) === board);
        card(board)[history ? "historyParts" : "parts"].push(part(owner ? records(meetings) : rows, members));
        card(board).documents.push(...records(agendaDocuments).filter(document => rows.concat(records(meetings)).some(meeting => meeting.id === document.meetingId)));
      }
      if (family) {
        const unowned = records(meetings).filter(meeting => !meeting.bodyId);
        if (unowned.length) { const held = placeCards.get(page.page_id) ?? { parts: [] }; placeCards.set(page.page_id, held); held.parts.push(part(unowned)); }
      }
    }
    for (const meeting of records(row.archived_meetings)) card(canon(meeting.bodyId)).archived.push(meeting);
    for (const document of records(row.archived_documents)) {
      const meeting = records(row.archived_meetings).find(item => item.id === document.meetingId);
      if (meeting) card(canon(meeting.bodyId)).archivedDocuments.push(document);
    }
  }
  for (const [board, held] of boardCards) {
    const body = { v: 1, s: board, sources: held.stamper.sources, stamps: held.stamper.stamps, parts: held.parts, sittings: held.sittings };
    out.boards.push(["meetings", body]);
    if (held.historyParts.length || held.archived.length) out.boards.push(["history", { v: 1, s: board, parts: held.historyParts, archived: held.archived }]);
    if (held.documents.length || held.archivedDocuments.length) out.boards.push(["agenda", { v: 1, s: board, documents: held.documents, archived: held.archivedDocuments }]);
  }
  for (const [place, held] of placeCards) out.places.push([given.indexOf(place) + 1 || 1, "meetings", { v: 1, s: place, sources: [], stamps: [], parts: held.parts, sittings: [] }]);
  return [{ read: out }];
}
