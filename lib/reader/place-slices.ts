import type { Query } from "../facts/publish.ts";
import { ROSTER_PERSON_FIELDS } from "../facts/roster-read.ts";
import { stateRegistry, placeRegistry, stateFamily } from "./state-shelf.ts";
import { unpackSlice, type SliceBody, type SliceFact } from "./slices.ts";
import type { AgendaBody, HistoryBody, MeetingsBody, SlicePartition } from "./slice-meetings.ts";
import type { PlaceInput } from "./place-types.ts";
import type { BodyHeaders } from "./place-identity.ts";

type Row = Record<string, unknown>;
interface Held { readonly value: unknown; readonly quote: string | null; readonly time: string; readonly kind: string; readonly url: string | null }
interface Board { readonly id: string; readonly name: string; readonly parent: string | null; readonly aliases: readonly string[]; readonly filed: readonly string[]; readonly host: boolean; readonly facts: Map<string, Held> }
interface Person { readonly facts: Map<string, Held>; readonly shown: string }
interface Cards { meetings?: MeetingsBody; history?: HistoryBody; agenda?: AgendaBody }

const FAMILY = "source:derived:family:";
/** A government not on the registration of the places a page holds is known by the kind its id names (`ak:city:...`). */
const KIND_OF_ID: Readonly<Record<string, string>> = { special: "SPECIAL DISTRICT", city: "MUNICIPAL", school: "SCHOOL DISTRICT", depschool: "DEPENDENT SCHOOL SYSTEM", county: "COUNTY" };
const BODY_FIELDS = new Set(["name", "homepage", "meeting_cadence", "agenda_url", "office_address", "office_phone", "office_email", "mailing_address"]);
const PERSON_KEYS = new Set<string>(ROSTER_PERSON_FIELDS);
/** Where a slice read numbers the places whose cards only lend the entities of boards that are filed nowhere the page names. */
const LENT = 1_000_000;
const textOf = (value: unknown): string | null => value === null || value === undefined ? null : typeof value === "string" ? value : JSON.stringify(value);

/** The facts of one entity of a slice, with the page and time each was checked and its exact quote. */
function heldFacts(slice: SliceBody, facts: Readonly<Record<string, SliceFact>>): Map<string, Held> {
  const out = new Map<string, Held>();
  for (const [key, fact] of Object.entries(facts)) {
    const [value, at, quote] = fact as readonly [unknown, number, (string | null)?], [source, time, kind] = slice.stamps[at]!;
    const scoped = /^(.+)@(\d+)$/.exec(key);
    out.set(scoped ? `${scoped[1]}:${slice.boards[Number(scoped[2])]}` : key, { value, quote: fact.length === 2 ? textOf(value) : quote ?? null, time, kind, url: source === null ? null : slice.sources[source]! });
  }
  return out;
}

/**
 * One statement for a whole selection: the cards of the places (and of the places that only lend the entities of the boards shown), the
 * meetings cards of every board shown, and the little of the entity table that is not on a card. A place shows the boards filed on it and on the
 * places above it, and the boards of any government or board filed there (a village district shows its town's board; a county shows the boards of the towns filed on it),
 * and a board named by id is shown whether or not it is filed on a place the page names.
 */
export const PLACE_SLICES_SQL = `WITH given AS MATERIALIZED (SELECT u.id,u.n::int AS n FROM unnest($1::text[]) WITH ORDINALITY u(id,n)),
req AS MATERIALIZED (SELECT DISTINCT coalesce(x.entity_id,u.id) AS id FROM unnest($2::text[]) u(id) LEFT JOIN entity_external_id x ON x.scheme='body-alias' AND x.value=u.id),
near AS MATERIALIZED (SELECT DISTINCT a.id FROM (SELECT split_part(r.id,'#',1) AS id FROM req r WHERE $3::boolean AND r.id LIKE 'ocd-division/%'
  UNION SELECT ep.place_id FROM entity_place ep WHERE $3::boolean AND ep.entity_id IN (SELECT id FROM req)) a WHERE a.id NOT IN (SELECT id FROM given)),
sel AS MATERIALIZED (SELECT id,n FROM given UNION ALL SELECT id,(SELECT count(*) FROM given)::int+(row_number() OVER (ORDER BY id))::int FROM near),
reach AS MATERIALIZED (WITH RECURSIVE c(place_id,via,parent_id) AS (
  SELECT s.id,e.id,e.parent_id FROM sel s JOIN entity e ON e.id=s.id
  UNION SELECT c.place_id,p.id,p.parent_id FROM c JOIN entity p ON p.id=c.parent_id AND p.state=$6::char(2)
    AND p.id !~ '^ocd-division/country:us/(state|district|territory):[^/]+$'
) SELECT place_id,via FROM c),
kin AS MATERIALIZED (WITH RECURSIVE k(place_id,id) AS (
  SELECT r.place_id,ep.entity_id FROM reach r JOIN entity_place ep ON ep.place_id=r.via JOIN entity e ON e.id=ep.entity_id AND e.kind IN ('government','body')
  UNION SELECT k.place_id,c.id FROM k JOIN entity c ON c.parent_id=k.id AND c.kind IN ('government','body') AND c.state=$6::char(2)
) SELECT place_id,id FROM k),
filed AS MATERIALIZED (SELECT DISTINCT i.place_id,i.raw,coalesce(x.entity_id,e.id) AS id FROM (SELECT place_id,id AS raw FROM kin) i
  JOIN entity e ON e.id=i.raw AND e.kind='body' LEFT JOIN entity_external_id x ON x.scheme='body-alias' AND x.value=e.id),
wanted AS MATERIALIZED (SELECT id FROM filed UNION SELECT id FROM req),
lent AS MATERIALIZED (SELECT DISTINCT ON (w.id) w.id AS board,ep.place_id FROM wanted w JOIN entity_place ep ON ep.entity_id=w.id
  JOIN place_slice s ON s.place_id=ep.place_id AND s.card='bodies' AND s.body IS NOT NULL
  WHERE NOT EXISTS (SELECT 1 FROM entity_place q WHERE q.entity_id=w.id AND q.place_id IN (SELECT via FROM reach)) ORDER BY w.id,pg_column_size(s.body)),
holders AS MATERIALIZED (SELECT id,n FROM sel UNION ALL SELECT place_id,${LENT}+(row_number() OVER (ORDER BY place_id))::int
  FROM (SELECT via AS place_id FROM reach WHERE via NOT IN (SELECT id FROM sel) UNION SELECT place_id FROM lent) l)
SELECT jsonb_build_object(
  'places',(SELECT jsonb_agg(jsonb_build_array(h.n,s.card,s.body)) FROM holders h JOIN place_slice s ON s.place_id=h.id
    WHERE s.card=ANY($4::text[]) AND s.body IS NOT NULL AND (h.n<${LENT} OR s.card IN ('bodies','governs'))),
  'boards',(SELECT jsonb_agg(jsonb_build_array(s.card,s.body)) FROM place_slice s WHERE s.card=ANY($5::text[]) AND s.body IS NOT NULL AND s.place_id IN (SELECT id FROM wanted)),
  'filed',(SELECT jsonb_agg(jsonb_build_array(sel.n,f.id,f.raw)) FROM filed f JOIN sel ON sel.id=f.place_id),
  'req',(SELECT jsonb_agg(id) FROM req),
  'meta',(SELECT jsonb_agg(jsonb_build_array(sel.n,sel.id,e.state,e.id IS NOT NULL)) FROM sel LEFT JOIN entity e ON e.id=sel.id),
  'entities',(SELECT jsonb_object_agg(e.id,jsonb_build_array(e.name,e.parent_id,e.state)) FROM entity e WHERE e.id IN (SELECT id FROM wanted)),
  'parents',(SELECT jsonb_object_agg(p.id,jsonb_build_array(p.kind,p.name,p.parent_id,gp.kind)) FROM entity p LEFT JOIN entity gp ON gp.id=p.parent_id
    WHERE p.id IN (SELECT b.parent_id FROM entity b WHERE b.id IN (SELECT id FROM wanted))),
  'states',(SELECT jsonb_object_agg(b.id,b.state) FROM entity b WHERE b.id IN (SELECT id FROM wanted) AND b.state IS DISTINCT FROM $6::char(2))) AS read`;

export interface SlicedRows { readonly rows: Row[]; readonly headers: BodyHeaders; readonly pages: string[] }

interface Read {
  places: [number, string, unknown][] | null; boards: [string, unknown][] | null; filed: [number, string, string][] | null; meta: [number, string, string | null, boolean][] | null; req: string[] | null;
  entities: Record<string, [string, string | null, string | null]> | null; parents: Record<string, [string, string, string | null, string | null]> | null;
  states: Record<string, string> | null;
}

/**
 * A selection read from slices, as the rows a place's page carries: for each place (and each named board that no place of the selection
 * holds) its boards, their facts, rosters and sittings from the cards of the places and boards, the registry from the state's shelf, and the
 * history and agenda cards when asked for. Nothing is assembled from the fact store and nothing waits on a worker: a card not yet built is a card with nothing on it.
 */
export async function readSlicedRows(input: PlaceInput, query: Query): Promise<SlicedRows> {
  const state = input.state.toUpperCase(), history = input.includeHistory === true, agenda = input.includeAgenda === true, agendaOnly = input.meetingIds !== undefined;
  const placeIds = [...new Set([...input.divisionIds, ...input.namedDivisionIds ?? []])], named = [...new Set(input.bodyIds ?? [])];
  // The country is not a state with a registry of its own; its boards and calendars are read like any other place's.
  const registry = state === "US" ? { model: null, registrationHeld: false } : await stateRegistry(state);
  const family = await stateFamily(state), familyHistory = history ? await stateFamily(state, true) : null;
  if (!placeIds.length && !named.length) {
    const runtime = registry.model ? placeRegistry(registry.model, { divisionIds: [], boardIds: [], aliasOf: new Map(), filed: new Map(), names: new Map() }) : null;
    return { rows: [{ page_id: `ocd-division/country:us${state === "US" ? "" : `/state:${state.toLowerCase()}`}`, page_kind: "empty", built_at: 0, division_ids: [], registration_held: registry.registrationHeld, registry: runtime,
      governments: [], divisions: [], entities: [], fields: [], rosters: [], comments: [], sittings: [],
      meeting_rows: [family, familyHistory].flatMap(shelf => shelf ? [{ scope: shelf.scope, current_version_id: shelf.version, confirmation: shelf.confirmation,
        payload: { ...shelf.header, meetings: [], agendaDocuments: [], ...(shelf.members ? { derivedMembers: [] } : {}) } }] : []), archived_meetings: [], archived_documents: [], archived_document_links: [], agenda_texts: [], parts: {}, publication_attempts: [] }], headers: {}, pages: [] };
  }
  const boardCards = ["meetings", ...history ? ["history"] : [], ...agenda ? ["agenda"] : []];
  const [read] = await query(PLACE_SLICES_SQL, [placeIds, named, input.neighbors ?? false, [...agendaOnly ? ["bodies"] : ["bodies", "governs"], ...boardCards], boardCards, state]);
  const out = read?.read as Read | undefined;
  if (!out) throw new Error("PLACE_SLICES_UNREADABLE");

  const boards = new Map<string, Board>(), people = new Map<string, Person>(), regs = new Map<number, SliceBody["reg"]>(), cards = new Map<string, Cards>();
  const keep = (slice: { s: string }, card: keyof Cards) => { const held = cards.get(slice.s) ?? {}; (held as Record<string, unknown>)[card] = slice; cards.set(slice.s, held); };
  for (const [n, card, body] of out.places ?? []) {
    if (card === "meetings" || card === "history" || card === "agenda") { keep(unpackSlice<{ s: string }>(body), card); continue; }
    const slice = unpackSlice<SliceBody>(body);
    // A card written by an earlier slice job is not read as this one; it is rebuilt by the lane.
    if (slice.v !== 2) continue;
    if (card === "bodies") regs.set(n, slice.reg);
    for (const entity of slice.entities) {
      if (entity.k === "body") { if (!boards.has(entity.id)) boards.set(entity.id, { id: entity.id, name: entity.n, parent: entity.p ?? null, aliases: entity.a ?? [], filed: [...new Set(entity.d ?? [])], host: entity.h === 1, facts: heldFacts(slice, entity.f) }); }
      else if (entity.k === "person") people.set(entity.id, { facts: new Map([...people.get(entity.id)?.facts ?? [], ...heldFacts(slice, entity.f)]), shown: entity.x ?? people.get(entity.id)?.shown ?? "" });
    }
  }
  for (const [card, body] of out.boards ?? []) { const slice = unpackSlice<{ s: string }>(body); keep(slice, card as keyof Cards); }

  const listedAt = new Map<number, Set<string>>();
  for (const [n, id] of out.filed ?? []) listedAt.set(n, (listedAt.get(n) ?? new Set()).add(id));
  const listed = [...new Set([...listedAt.values()].flatMap(set => [...set]))], held = out.entities ?? {};
  const required = [...new Set([...listed, ...out.req ?? []])];
  const entityOf = (id: string): Board => boards.get(id) ?? { id, name: held[id]?.[0] ?? registry.model?.registry.bodies.find(body => body.id === id)?.name ?? id, parent: held[id]?.[1] ?? null, aliases: [], filed: [], host: false, facts: new Map() };
  const shownBoards = new Map(required.map(id => [id, entityOf(id)] as const));
  const aliasOf = new Map([...shownBoards.values()].flatMap(board => board.aliases.map(alias => [alias, board.id] as const)));
  const filed = new Map([...shownBoards.values()].map(board => [board.id, board.filed] as const)), names = new Map([...shownBoards.values()].map(board => [board.id, board.name] as const));
  const headers: Record<string, { id: string; name: string }> = {};
  for (const board of shownBoards.values()) { headers[board.id] = { id: board.id, name: board.name }; for (const alias of board.aliases) headers[alias] = { id: board.id, name: board.name }; }

  const parents = out.parents ?? {}, foreign = out.states ?? {};
  // The class of a board's government is what the registration held on the places it is filed on says of it.
  const classes = new Map([...regs.values()].flatMap(reg => (reg?.governments ?? []).flatMap(government => [government.id, government.jurisdictionId].flatMap(id => id ? [[id, government.governmentClass ?? null] as const] : []))));

  const build = (pageId: string, kind: "place" | "body", n: number | null, divisions: readonly string[], mine: readonly Board[]): Row => {
    const fields: Row[] = [], rosters: Row[] = [], comments: Row[] = [], sittings: Row[] = [], partitions: Row[] = [], archivedMeetings: Row[] = [], archivedDocuments: Row[] = [], documents: Row[] = [];
    const familyRows = new Map<string, Map<string, Row>>(), familyHeads = new Map<string, SlicePartition>(), own = new Set<string>();
    const hold = (part: SlicePartition, board?: string) => {
      if (part.s.startsWith(FAMILY)) { if (!familyHeads.has(part.s)) familyHeads.set(part.s, part); const rows = familyRows.get(part.s) ?? new Map<string, Row>(); for (const meeting of part.r) rows.set(String(meeting.id), meeting); familyRows.set(part.s, rows); return; }
      if (board && part.s.startsWith("source:derived~US-") && !part.s.endsWith(":history")) own.add(board);
      partitions.push({ scope: part.s, current_version_id: part.v, confirmation: part.c, payload: { ...part.h, meetings: part.r, agendaDocuments: [], ...(part.m ? { derivedMembers: part.m } : {}) } });
    };
    const takeCards = (card: Cards | undefined, board?: Board) => {
      for (const part of card?.meetings?.parts ?? []) hold(part, board?.id);
      for (const part of card?.history?.parts ?? []) hold(part, board?.id);
      archivedMeetings.push(...card?.history?.archived ?? []);
      documents.push(...card?.agenda?.documents ?? []);
      archivedDocuments.push(...card?.agenda?.archived ?? []);
    };
    const entities = mine.map(board => {
      const parent = board.parent ? parents[board.parent] : undefined, government = parent?.[0] === "government" ? parent : undefined;
      const home = parent?.[0] === "place" ? board.parent : parent?.[3] === "place" ? parent[2] : null;
      for (const [key, fact] of board.facts) {
        const row = { entity_id: board.id, field: key, value: fact.value, quote: fact.quote, checked_at: fact.time, provenance_kind: fact.kind, url: fact.url, body_name: board.name, parent_id: board.parent };
        if (BODY_FIELDS.has(key)) fields.push(row);
        else if (key.startsWith("comment:")) comments.push(row);
        else if (key.startsWith("member:") && !agendaOnly) {
          const person = people.get(key.slice(7));
          const facts = Object.fromEntries([...person?.facts ?? []].filter(([field]) => PERSON_KEYS.has(field) || field.endsWith(`:${board.id}`) && PERSON_KEYS.has(field.slice(0, -board.id.length - 1)))
            .map(([field, fact]) => [field, { value: fact.value, quote: fact.quote, url: fact.url, checked: fact.time }]));
          rosters.push({ body_id: board.id, body_name: board.name, person_id: key.slice(7), value: fact.value, quote: fact.quote, checked_at: fact.time, provenance_kind: fact.kind, url: fact.url, shown_id: person?.shown ?? "", person: facts });
        }
      }
      const card = cards.get(board.id);
      takeCards(card, board);
      const stamp = (at: number) => card!.meetings!.stamps[at]!;
      for (const [body, entity, field, value, at, status, quote] of card?.meetings?.sittings ?? []) sittings.push({ body_id: body, body_name: board.name, entity_id: entity, field, value,
        quote: quote === undefined ? textOf(value) : quote, checked_at: stamp(at)[1], status, url: stamp(at)[0] === null ? null : card!.meetings!.sources[stamp(at)[0]!] });
      return { id: board.id, kind: "body", name: board.name, parent_id: board.parent, state: foreign[board.id] ?? held[board.id]?.[2] ?? state, linked: false, placed: board.filed.length > 0 || !!government,
        divisions: board.filed, division: home ?? board.id.split("#")[0], placement_basis: board.host ? "HOST_COUNTY" : "SERVICE_AREA",
        government: government?.[1] ?? null, government_id: government ? board.parent : null, government_class: null as string | null, registered_name: null as string | null };
    });
    const reg = n === null || n >= LENT ? undefined : regs.get(n);
    const runtime = registry.model ? placeRegistry(registry.model, { divisionIds: [...divisions], boardIds: mine.map(board => board.id), aliasOf, filed, names,
      peopleIds: rosters.flatMap(row => [String(row.person_id), String(row.shown_id)]) }) : null;
    for (const entity of entities) {
      entity.registered_name = (runtime?.registry.bodies.find(body => body.id === entity.id)?.name as string | undefined) ?? null;
      entity.government_class = (entity.parent_id === null ? null : classes.get(entity.parent_id) ?? KIND_OF_ID[entity.parent_id.split(":")[1] ?? ""]) ?? null;
    }
    if (kind === "place") takeCards(cards.get(pageId));
    // A state's family calendar is on every page of the state; its rows are those the slices hold for this page's boards and for the place itself.
    for (const [shelf, rows] of [[family, false], [familyHistory, true]] as const) {
      if (!shelf) continue;
      const held = familyRows.get(shelf.scope) ?? new Map<string, Row>();
      partitions.push({ scope: shelf.scope, current_version_id: shelf.version, confirmation: shelf.confirmation, payload: { ...shelf.header, meetings: [...held.values()], agendaDocuments: [],
        ...(shelf.members ? { derivedMembers: shelf.members.filter(member => { const board = aliasOf.get(String(member.bodyId)) ?? String(member.bodyId); return mine.some(entity => entity.id === board) && (rows || !own.has(board)); }) } : {}) } });
    }
    // A family calendar the shelf does not hold (its pointer unread just now) is still the calendar the boards' slices name.
    for (const [scope, head] of familyHeads) if (![family, familyHistory].some(shelf => shelf?.scope === scope))
      partitions.push({ scope, current_version_id: head.v, confirmation: head.c, payload: { ...head.h, meetings: [...familyRows.get(scope)!.values()], agendaDocuments: [], ...(head.m ? { derivedMembers: head.m } : {}) } });
    const ordered = partitions.map(partition => partition.payload as { meetings: Row[]; agendaDocuments: Row[] });
    const seen = new Set<string>();
    for (const document of documents) {
      const id = String(document.id);
      const target = ordered.find(payload => payload.meetings.some(meeting => meeting.id === document.meetingId));
      if (!target || seen.has(id)) continue;
      seen.add(id); target.agendaDocuments.push(document);
    }
    return { page_id: pageId, page_kind: kind, built_at: 0, division_ids: [...divisions], registration_held: registry.registrationHeld,
      registry: runtime, governments: reg?.governments ?? [], divisions: reg?.divisions ?? [], government_order: Object.fromEntries((reg?.governments ?? []).map((government, at) => [government.id, reg?.order?.[at] ?? 0])),
      entities, fields, rosters, comments, sittings, meeting_rows: partitions, archived_meetings: archivedMeetings, archived_documents: archivedDocuments, archived_document_links: [], agenda_texts: [], parts: {}, publication_attempts: [] };
  };

  const rows: Row[] = [], pages: string[] = [];
  for (const [n, id, placeState, exists] of out.meta ?? []) {
    // A page of another state is not part of this state's answer.
    if (!exists || placeState !== null && placeState.toUpperCase() !== state) continue;
    rows.push(build(id, "place", n, [id], [...listedAt.get(n) ?? []].map(board => shownBoards.get(board)!)));
    pages.push(id);
  }
  for (const id of out.req ?? []) {
    if (!listed.includes(id)) rows.push(build(id, "body", null, [], [shownBoards.get(id) ?? entityOf(id)]));
    pages.push(id);
  }
  return { rows, headers, pages };
}
