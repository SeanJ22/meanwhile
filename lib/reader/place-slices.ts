import type { Query } from "../facts/publish.ts";
import { ROSTER_PERSON_FIELDS } from "../facts/roster-read.ts";
import { stateRegistry, placeRegistry, stateFamily } from "./state-shelf.ts";
import { LAST_CARD, unpackSlice, type SliceBody, type SliceFact } from "./slices.ts";
import type { MeetingsBody } from "./slice-meetings.ts";
import type { PlaceInput } from "./place-types.ts";
import { identityCtes, identityHeaders } from "./place.ts";
import type { BodyHeaders } from "./place-identity.ts";

type Row = Record<string, unknown>;
interface Held { readonly value: unknown; readonly quote: string | null; readonly time: string; readonly kind: string; readonly url: string | null }
interface Board { readonly id: string; readonly name: string; readonly parent: string | null; readonly aliases: readonly string[]; readonly filed: readonly string[]; readonly host: boolean; readonly facts: Map<string, Held> }
interface Person { readonly facts: Map<string, Held> }

const FAMILY = "source:derived:family:";
const BODY_FIELDS = new Set(["name", "homepage", "meeting_cadence", "agenda_url", "office_address", "office_phone", "office_email", "mailing_address"]);
const PERSON_KEYS = new Set<string>(ROSTER_PERSON_FIELDS);
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

/** One statement: the slices of the places, those of the boards filed on them, and what the places' saved pages say about which boards they show (see `place_page.depends`). */
const readSql = () => `WITH sel AS MATERIALIZED (SELECT u.id,u.n FROM unnest($1::text[]) WITH ORDINALITY u(id,n)), selected AS MATERIALIZED (SELECT id FROM sel), ${identityCtes},
boards AS MATERIALIZED (SELECT DISTINCT coalesce(x.entity_id,e.id) AS id FROM entity_place ep JOIN entity e ON e.id=ep.entity_id AND e.kind='body'
  LEFT JOIN entity_external_id x ON x.scheme='body-alias' AND x.value=e.id WHERE ep.place_id IN (SELECT id FROM sel)),
shown AS MATERIALIZED (SELECT sel.n,sel.id,p.place_id,coalesce(p.depends,ARRAY(SELECT o.entity_id FROM place_page_dependency o WHERE o.page_id=p.place_id)) AS ids FROM sel LEFT JOIN place_page p ON p.place_id=sel.id)
SELECT jsonb_build_object('headers',${identityHeaders()},
  'places',(SELECT jsonb_agg(jsonb_build_array(sel.n,s.card,s.body)) FROM sel JOIN place_slice s ON s.place_id=sel.id WHERE s.card=ANY($2::text[]) AND s.body IS NOT NULL),
  'boards',(SELECT jsonb_agg(jsonb_build_array(s.card,s.body)) FROM place_slice s WHERE s.card=ANY($3::text[]) AND s.body IS NOT NULL AND s.place_id IN (SELECT id FROM boards)),
  'unbuilt',(SELECT jsonb_agg(a.id) FROM (SELECT id FROM sel UNION SELECT id FROM boards) a WHERE NOT EXISTS(SELECT 1 FROM place_slice s WHERE s.place_id=a.id AND s.card=$4)),
  'places_meta',(SELECT jsonb_agg(jsonb_build_array(sel.n,e.state,(SELECT extract(epoch FROM p.built_at) FROM place_page p WHERE p.place_id=sel.id))) FROM sel LEFT JOIN entity e ON e.id=sel.id),
  'shown',(SELECT jsonb_agg(jsonb_build_array(n,CASE WHEN place_id IS NULL THEN NULL ELSE ARRAY(SELECT x FROM unnest(ids) x WHERE x IN (SELECT id FROM boards)) END,
    CASE WHEN place_id IS NULL THEN NULL ELSE ARRAY(SELECT x FROM unnest(ids) x WHERE x NOT IN (SELECT id FROM boards) AND EXISTS(SELECT 1 FROM entity b WHERE b.id=x AND b.kind='body')) END)) FROM shown),
  'parents',(SELECT jsonb_object_agg(p.id,jsonb_build_array(p.kind,p.name,p.parent_id,gp.kind)) FROM entity p LEFT JOIN entity gp ON gp.id=p.parent_id
    WHERE p.id IN (SELECT b.parent_id FROM entity b WHERE b.id IN (SELECT id FROM boards))),
  'classes',(SELECT jsonb_agg(jsonb_build_array(g.value->>'id',g.value->>'jurisdictionId',g.value->>'governmentClass')) FROM civic_data_promotions p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.current_version_id AND r.collection='governments',
    LATERAL (SELECT reader_payload_value(r.value) AS value) g WHERE p.key='REGISTRATION:US-'||$5||':registration:v1'
    AND (g.value->>'jurisdictionId' IN (SELECT b.parent_id FROM entity b WHERE b.id IN (SELECT id FROM boards)) OR g.value->>'id' IN (SELECT b.parent_id FROM entity b WHERE b.id IN (SELECT id FROM boards)))),
  'states',(SELECT jsonb_object_agg(b.id,b.state) FROM entity b WHERE b.id IN (SELECT id FROM boards) AND b.state IS DISTINCT FROM $5::char(2))) AS read`;

/** The id a roster shows for a person is the first one stored for them, as the saved page took it. */
const SHOWN_SQL = `SELECT p.id,(SELECT x.value FROM entity_external_id x WHERE x.entity_id=p.id AND x.scheme='roster-member' ORDER BY x.ctid LIMIT 1) AS shown FROM unnest($1::text[]) p(id)`;

export interface SlicedRows { readonly rows: Row[]; readonly headers: BodyHeaders; readonly pages: string[] }

/**
 * A selection of places read from their slices, as the rows their saved pages carry: the boards each place's page shows (its `depends`),
 * their facts, rosters and sittings from the slices of the places and boards, and the registry from the state's shelf. Null when any slice
 * this needs is missing, or a board or person the page shows is in none of the slices read: the selection is then answered from its saved pages.
 */
export async function readSlicedRows(input: PlaceInput, ids: readonly string[], query: Query): Promise<SlicedRows | null> {
  if (input.bodyIds?.length || input.allBodies || input.neighbors || input.bodyFactsOnly || input.meetingIds || input.includeHistory || input.includeAgenda || !ids.length) return null;
  const state = input.state.toUpperCase();
  const [read] = await query(readSql(), [ids, ["bodies", "governs", "meetings"], ["meetings"], LAST_CARD, state]);
  const out = read?.read as { headers: BodyHeaders; places: [number, string, unknown][] | null; boards: [string, unknown][] | null; unbuilt: string[] | null; places_meta: [number, string | null, number | null][];
    shown: [number, string[] | null, string[] | null][]; parents: Record<string, [string, string, string | null, string | null]> | null; classes: [string, string, string | null][] | null; states: Record<string, string> | null } | undefined;
  if (process.env.SLICE_DEBUG) console.log("GATE", JSON.stringify({ unbuilt: out?.unbuilt?.slice(0, 3), nolist: out?.shown.filter(([, l]) => !l).length, missing: out?.shown.flatMap(([, , m]) => m ?? []).slice(0, 3) }));
  if (!out || out.unbuilt?.length || out.shown.some(([, listed, missing]) => !listed || missing?.length)) return null;
  const [registry, family] = await Promise.all([stateRegistry(state), stateFamily(state)]);
  if (!registry.model) return null;

  const boards = new Map<string, Board>(), people = new Map<string, Person>(), regs = new Map<number, SliceBody["reg"]>(), meetings = new Map<string, MeetingsBody>();
  for (const [n, card, body] of out.places ?? []) {
    if (card === "meetings") { const slice = unpackSlice<MeetingsBody>(body); meetings.set(slice.s, slice); continue; }
    const slice = unpackSlice<SliceBody>(body);
    if (card === "bodies") regs.set(n, slice.reg);
    for (const entity of slice.entities) {
      if (entity.k === "body") { if (!boards.has(entity.id)) boards.set(entity.id, { id: entity.id, name: entity.n, parent: entity.p ?? null, aliases: entity.a ?? [], filed: [...new Set(entity.d ?? [])], host: entity.h === 1, facts: heldFacts(slice, entity.f) }); }
      else if (entity.k === "person") people.set(entity.id, { facts: new Map([...people.get(entity.id)?.facts ?? [], ...heldFacts(slice, entity.f)]) });
    }
  }
  for (const [, body] of out.boards ?? []) { const slice = unpackSlice<MeetingsBody>(body); meetings.set(slice.s, slice); }
  const listedBoards = new Set(out.shown.flatMap(([, listed]) => listed ?? []));
  const seated = [...new Set([...boards.values()].filter(board => listedBoards.has(board.id)).flatMap(board => [...board.facts.keys()].filter(key => key.startsWith("member:")).map(key => key.slice(7))))];
  const shown = new Map((seated.length ? await query(SHOWN_SQL, [seated]) : []).map(row => [String(row.id), String(row.shown ?? "")] as const));
  // Every place's own meetings card holds the sittings no board owns, and is read with the places'.
  const place = new Map(ids.map((id, index) => [index + 1, id] as const));
  const parents = out.parents ?? {}, foreign = out.states ?? {}, classes = out.classes ?? [];
  const aliasOf = new Map([...boards.values()].flatMap(board => board.aliases.map(alias => [alias, board.id] as const)));
  const filed = new Map([...boards.values()].map(board => [board.id, board.filed] as const)), names = new Map([...boards.values()].map(board => [board.id, board.name] as const));
  const states = new Map(out.places_meta.map(([n, s, at]) => [n, { state: s, at: at ?? 0 }] as const));
  const rows: Row[] = [];
  for (const [n, listed] of out.shown) {
    const id = place.get(n)!, meta = states.get(n)!;
    // A page of another state is not part of this state's answer.
    if (meta.state !== null && meta.state.toUpperCase() !== state) continue;
    const mine = (listed as string[]).map(board => boards.get(board)).filter((board): board is Board => !!board);
    if (mine.length !== listed!.length) { if (process.env.SLICE_DEBUG) console.log("NOBOARD", (listed as string[]).filter(b => !boards.has(b)).slice(0, 3)); return null; }
    const fields: Row[] = [], rosters: Row[] = [], comments: Row[] = [], sittings: Row[] = [], partitions: Row[] = [], familyRows = new Map<string, Row>(), own = new Set<string>();
    const hold = (part: MeetingsBody["parts"][number], board?: string) => {
      if (part.s.startsWith(FAMILY)) { for (const meeting of part.r) familyRows.set(String(meeting.id), meeting); return; }
      if (board && part.s.startsWith("source:derived~US-")) own.add(board);
      partitions.push({ scope: part.s, current_version_id: part.v, confirmation: part.c, payload: { ...part.h, meetings: part.r, agendaDocuments: [], ...(part.m ? { derivedMembers: part.m } : {}) } });
    };
    const entities = mine.map(board => {
      const parent = board.parent ? parents[board.parent] : undefined, government = parent?.[0] === "government" ? parent : undefined;
      const home = parent?.[0] === "place" ? board.parent : parent?.[3] === "place" ? parent[2] : null;
      for (const [key, fact] of board.facts) {
        const row = { entity_id: board.id, field: key, value: fact.value, quote: fact.quote, checked_at: fact.time, provenance_kind: fact.kind, url: fact.url, body_name: board.name, parent_id: board.parent };
        if (BODY_FIELDS.has(key)) fields.push(row);
        else if (key.startsWith("comment:")) comments.push(row);
        else if (key.startsWith("member:")) {
          const person = people.get(key.slice(7));
          const facts = Object.fromEntries([...person?.facts ?? []].filter(([field]) => PERSON_KEYS.has(field) || field.endsWith(`:${board.id}`) && PERSON_KEYS.has(field.slice(0, -board.id.length - 1)))
            .map(([field, held]) => [field, { value: held.value, quote: held.quote, url: held.url, checked: held.time }]));
          rosters.push({ body_id: board.id, body_name: board.name, person_id: key.slice(7), value: fact.value, quote: fact.quote, checked_at: fact.time, provenance_kind: fact.kind, url: fact.url, shown_id: shown.get(key.slice(7)) ?? "", person: facts });
        }
      }
      for (const part of meetings.get(board.id)?.parts ?? []) hold(part, board.id);
      const card = meetings.get(board.id), stamp = (at: number) => card!.stamps[at]!;
      for (const [body, entity, field, value, at, status, quote] of card?.sittings ?? []) sittings.push({ body_id: body, body_name: board.name, entity_id: entity, field, value,
        quote: quote === undefined ? textOf(value) : quote, checked_at: stamp(at)[1], status, url: stamp(at)[0] === null ? null : card!.sources[stamp(at)[0]!] });
      return { id: board.id, kind: "body", name: board.name, parent_id: board.parent, state: foreign[board.id] ?? state, linked: false, placed: board.filed.length > 0 || !!government,
        divisions: board.filed, division: home ?? board.id.split("#")[0], placement_basis: board.host ? "HOST_COUNTY" : "SERVICE_AREA",
        government: government?.[1] ?? null, government_id: government ? board.parent : null, government_class: null as string | null, registered_name: null as string | null };
    });
    const reg = regs.get(n), runtime = placeRegistry(registry.model, { divisionIds: [id], boardIds: mine.map(board => board.id), aliasOf, filed, names,
      peopleIds: rosters.flatMap(row => [String(row.person_id), String(row.shown_id)]) });
    for (const entity of entities) entity.registered_name = (runtime.registry.bodies.find(body => body.id === entity.id)?.name as string | undefined) ?? null;
    for (const entity of entities) entity.government_class = classes.find(([gid, jurisdiction]) => gid === entity.parent_id || jurisdiction === entity.parent_id)?.[2] ?? null;
    const placeCard = meetings.get(id);
    for (const part of placeCard?.parts ?? []) hold(part);
    // The state's family calendar is on every page of the state; its rows are those the slices hold for this page's boards and for the place itself.
    if (family) partitions.push({ scope: family.scope, current_version_id: family.version, confirmation: family.confirmation, payload: { ...family.header, meetings: [...familyRows.values()], agendaDocuments: [],
      ...(family.members ? { derivedMembers: family.members.filter(member => mine.some(board => board.id === (aliasOf.get(String(member.bodyId)) ?? String(member.bodyId))) && !own.has(aliasOf.get(String(member.bodyId)) ?? String(member.bodyId))) } : {}) } });
    rows.push({ page_id: id, page_kind: "place", built_at: meta.at * 1000, division_ids: [id], registration_held: registry.registrationHeld,
      registry: runtime, governments: reg?.governments ?? [], divisions: reg?.divisions ?? [],
      entities, fields, rosters, comments, sittings, meeting_rows: partitions, archived_meetings: [], archived_documents: [], archived_document_links: [], agenda_texts: [], parts: {}, publication_attempts: [] });
  }
  if (process.env.SLICE_DEBUG) console.log("SLICED");
  return { rows, headers: out.headers, pages: ids.slice() };
}
