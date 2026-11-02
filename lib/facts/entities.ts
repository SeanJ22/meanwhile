import { ensureGoverningBody } from "../core/door.ts";
export { ensureGoverningBody } from "../core/door.ts";
import { markSlices, slicesOf } from "../core/slice-marks.ts";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "../reference/csv.ts";
import { readCensusGovernmentFacts, type CensusGovernmentFacts } from "../registration/jurisdictions.ts";
import type { FactDb, Query } from "./publish.ts";
import { hostOf, isOfficialUrl } from "./check.ts";
import { siteUrl } from "./entity-read.ts";
import { subBodyId } from "../civic-data/meeting-body-crosswalk.ts";
import { governingBoardName, type GoverningContext } from "../civic-data/governing-board-name.ts";
import { isCensusPlaceholderDivision } from "../registry/census-placeholders.ts";
import { fileEntityPlaces, type EntityPlace } from "./entity-places.ts";
import type { Entity } from "../core/shapes.ts";
import { enqueueReaderPlaces } from "../reader/cache.ts";
import { registeredPlaceIds } from "../place-map/build.ts";
import { bodyNameKey, publishedBodyLabel } from "../civic-data/published-body-name.ts";
import { ID_ALIAS, identityKeys, isSeatNameScheme, personId, strongestKeys, survivingIds } from "../core/ids.ts";
import { matchPerson, type PersonEvidence } from "../identity/match-person.ts";
import { foldAccents, parsePersonName } from "../identity/name-parts.ts";
import { sendToDetective } from "./identity-blank.ts";

interface EntityRow extends Entity {
  /** The registered government a reviewed door names as a board's owner. */
  readonly government?: string | null;
  readonly places?: readonly EntityPlace[];
}

interface EntityBatch {
  readonly entities: EntityRow[];
  readonly hosts: [entityId: string, host: string][];
  readonly externalIds: [entityId: string, scheme: string, value: string][];
  readonly places: [entityId: string, placeId: string, boundaryYear?: number, basis?: EntityPlace["basis"]][];
}

export const COUNTRY = "ocd-division/country:us";
const emptyBatch = (): EntityBatch => ({ entities: [], hosts: [], externalIds: [], places: [] });

type Division = readonly [ocdId: string, layer: string, geoid: string, name: string];
type Government = readonly [pid6: string, jurisdictionId: string, name: string, govType: string, divisionIndex: number, pairing: string, ...unknown[]];
export interface Registration { readonly state: string; readonly divisions: readonly Division[]; readonly governments: readonly Government[] }

export interface RegistryBody {
  readonly id: string;
  readonly ocdId: string | null;
  readonly name: string | null;
  readonly bodyClass: string;
  readonly homepageUrl: string | null;
  readonly censusId?: string | null;
  readonly alsoServesOcdIds?: readonly string[];
}

function hostOfAddress(address: string): string | null {
  if (!address.trim()) return null;
  try {
    return new URL(siteUrl(address)).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch { return null; }
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());

/** Census names Alaska's dependent districts as REAAs; TIGER names the same school territory as a school district. */
function schoolPlaces(state: string, name: string): string[] {
  const district = name.replace(/-/g, "_");
  const stem = district.replace(/_regional_educational_attendance_area(?:_reaa)?$/, "");
  return [...new Set([district, ...(stem !== district ? [`${stem}_school_district`] : [])])]
    .map(slug => `ocd-division/country:us/state:${state.toLowerCase()}/school_district:${slug}`);
}

/** A state, district or territory itself: where a board waits until its government or place is known. */
const BARE_ROOT = "^ocd-division/country:us/(state|district|territory):[^/]+$";
const localPlace = (id: string) => id.startsWith(`${COUNTRY}/`) && id.slice(COUNTRY.length + 1).includes("/");

/** One state's places, governments and registry bodies; an undrawn district is filed under its host county. */
export interface Legislator { readonly ocdPersonId: string; readonly name: string }

function stateEntities(reg: Registration, census: ReadonlyMap<string, CensusGovernmentFacts>, bodies: readonly RegistryBody[],
  legislators: readonly Legislator[] = [], registeredOwners: ReadonlyMap<string,string> = new Map()): EntityBatch {
  const out = emptyBatch();
  const placeIds = registeredPlaceIds(reg);
  reg = {...reg,divisions:reg.divisions.map(([id,layer,geoid,name]) => [placeIds.get(`${layer}:${geoid}`) ?? id,layer,geoid,name])};
  const state = reg.state.toUpperCase();
  const known = new Set(reg.divisions.map(d => d[0]));
  const parentOf = (id: string): string => {
    for (let at = id.lastIndexOf("/"); at > COUNTRY.length; at = id.lastIndexOf("/", at - 1)) {
      if (known.has(id.slice(0, at))) return id.slice(0, at);
    }
    return COUNTRY;
  };
  const countyByFips = new Map(reg.divisions.filter(d => d[1] === "county").map(d => [d[2].slice(2), d[0]]));
  const stateDivision = reg.divisions.find(d => d[1] === "state")?.[0] ?? null;
  for (const [ocdId, layer, geoid, name] of [...reg.divisions].sort((a, b) => a[0].length - b[0].length)) {
    out.entities.push({ id: ocdId, kind: "place", name, state, parentId: parentOf(ocdId) });
    if (geoid) out.externalIds.push([ocdId, layer === "district" ? "boundary-feature" : `census-geoid:${layer}`, geoid]);
  }
  for (const [pid6, jurisdictionId, name, govType, divisionIndex] of reg.governments) {
    const facts = census.get(pid6);
    const county = facts?.countyFips ? countyByFips.get(facts.countyFips.slice(-3)) : undefined;
    const school = govType === "DEPENDENT SCHOOL SYSTEM" ? schoolPlaces(state, jurisdictionId.split(":").at(-1)!).find(id => known.has(id)) : undefined;
    const place = divisionIndex >= 0 ? reg.divisions[divisionIndex]?.[0] : school ?? county ?? stateDivision;
    out.entities.push({ id: jurisdictionId, kind: "government", name: titleCase(name), state, parentId: place ?? null });
    if (pid6 && /^\d+$/.test(pid6)) out.externalIds.push([jurisdictionId, "census-pid6", pid6]);
    if (place) out.places.push([jurisdictionId, place, 0, govType === "SPECIAL DISTRICT" && divisionIndex < 0 && county ? "HOST_COUNTY" : "SERVICE_AREA"]);
    const host = facts ? hostOfAddress(facts.web) : null;
    if (host) out.hosts.push([jurisdictionId, host]);
  }
  const governmentByPid = new Map(reg.governments.map(g => [g[0], g[1]]));
  const governmentIds = new Set(reg.governments.map(g => g[1]));
  const governmentOnDivision = new Map<string, string[]>();
  for (const government of reg.governments) {
    const division = reg.divisions[government[4]];
    if (!division) continue;
    const ownLayer = government[3] === "COUNTY" ? "county" : government[3] === "MUNICIPAL" ? "place"
      : government[3] === "TOWNSHIP" ? "cousub" : /^(?:SCHOOL DISTRICT|DEPENDENT SCHOOL SYSTEM)$/.test(government[3]) ? "school" : null;
    if (ownLayer !== division[1] && !(ownLayer === "school" && ["unsd", "elsd", "scsd"].includes(division[1]))) continue;
    const owners = governmentOnDivision.get(division[0]) ?? [];
    owners.push(government[1]); governmentOnDivision.set(division[0], owners);
  }
  const governmentNames = new Map(reg.governments.map(g => [g[1], titleCase(g[2])]));
  const divisionName = new Map(reg.divisions.map(d => [d[0], d[3]]));
  for (const body of bodies) {
    if (body.ocdId && isCensusPlaceholderDivision({ ocdId: body.ocdId })) continue;
    const place = body.ocdId && known.has(body.ocdId) ? body.ocdId : null;
    const root = splitSubject(body.id).root;
    // A named government's identity or native Census key establishes ownership. A served county does not.
    const general = place && [place + "#governing", place + "#board"].includes(body.id) ? governmentOnDivision.get(place) : undefined;
    const government = (body.censusId ? governmentByPid.get(body.censusId) : undefined)
      ?? (governmentIds.has(root) ? root : undefined) ?? (general?.length === 1 ? general[0] : undefined) ?? registeredOwners.get(body.id);
    const ownerName = (government && governmentNames.get(government)) ?? (place && divisionName.get(place)) ?? body.id;
    const role = body.bodyClass === "GOVERNING" ? (place?.includes("/school_district:") ? "school board" : "governing board") : body.bodyClass.toLowerCase().replace(/_/g, " ");
    const name = body.name ?? `${ownerName} ${role}`;
    out.entities.push({ id: body.id, kind: "body", name, state, parentId: government ?? place ?? stateDivision });
    const governmentPlaces = government ? out.places.filter(([id]) => id === government).map(([,place]) => place) : [];
    for (const served of [...new Set([...governmentPlaces.length ? governmentPlaces : [place], ...body.alsoServesOcdIds ?? []])]) {
      if (served && known.has(served)) out.places.push([body.id, served]);
    }
    const host = body.homepageUrl ? hostOfAddress(body.homepageUrl) : null;
    if (host) out.hosts.push([body.id, host]);
  }
  for (const person of legislators) {
    out.entities.push({ id: person.ocdPersonId, kind: "person", name: person.name, state, parentId: null });
    out.externalIds.push([person.ocdPersonId, "openstates", person.ocdPersonId]);
    if (stateDivision) out.places.push([person.ocdPersonId, stateDivision]);
  }
  return out;
}

async function insertEntities(query: Query, batch: EntityBatch): Promise<void> {
  const size = 2000;
  for (let i = 0; i < batch.entities.length; i += size) {
    const rows = batch.entities.slice(i, i + size);
    // A government moves when its reference territory moves, and a registry body when its government does; every other held row keeps what it has.
    const changed = await query(`WITH held AS MATERIALIZED (SELECT id,parent_id FROM entity WHERE id=ANY($1::text[])), changed AS (
      INSERT INTO entity (id, kind, name, state, parent_id)
      SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::char(2)[], $5::text[])
      ON CONFLICT (id) DO UPDATE SET parent_id = EXCLUDED.parent_id,state=EXCLUDED.state,
        name = CASE WHEN entity.kind = 'body' AND entity.name ~ ' governing$' THEN EXCLUDED.name ELSE entity.name END
        WHERE entity.kind IN ('government', 'body') AND EXCLUDED.kind = entity.kind
          AND (entity.parent_id IS DISTINCT FROM EXCLUDED.parent_id OR entity.state IS DISTINCT FROM EXCLUDED.state
            OR (entity.kind = 'body' AND entity.name ~ ' governing$' AND entity.name IS DISTINCT FROM EXCLUDED.name))
      RETURNING id,kind,parent_id
    ) SELECT changed.id,held.parent_id AS old_parent FROM changed JOIN held ON held.id=changed.id
      WHERE changed.kind='body' AND held.parent_id IS DISTINCT FROM changed.parent_id`,
    [rows.map(r => r.id), rows.map(r => r.kind), rows.map(r => r.name), rows.map(r => r.state), rows.map(r => r.parentId)]);
    // A corrected owner withdraws that owner's borrowed office claim, while the body's own venue and office stay intact.
    if (changed.length) {
      const moved = [changed.map(row => String(row.id)), changed.map(row => String(row.old_parent))];
      await query(`UPDATE fact pin SET status='pulled',held_reason='GOVERNMENT_OFFICE_OWNER_CHANGED',checked_at=now()
      FROM entity meeting,entity old_owner,unnest($1::text[],$2::text[]) AS moved(body_id,old_parent)
      WHERE meeting.parent_id=moved.body_id AND meeting.kind='meeting' AND pin.entity_id=meeting.id
        AND pin.field='map_pin' AND pin.status='live' AND pin.provenance_kind<>'OWNER' AND pin.value->>'basis'='GOVERNMENT_OFFICE'
        AND old_owner.id=moved.old_parent AND old_owner.kind='government'
        AND (lower(pin.value->>'name')=lower(old_owner.name) OR EXISTS (
          SELECT 1 FROM fact address JOIN source_copy source ON source.id=address.source_copy_id
          WHERE address.entity_id=old_owner.id AND address.field='office_address' AND address.status='live'
            AND address.value#>>'{}'=pin.value->>'address'
            AND source.url=pin.value#>>'{provenance,sourceUrl}'))`,
      moved);
      if ((await query("SELECT to_regclass('civic_data_rows') IS NOT NULL AS held"))[0]?.held === true) {
        await query(`WITH affected AS MATERIALIZED (
          SELECT DISTINCT 'meeting:'||r.row_id AS meeting_id,moved.body_id,body.state,body.name,pin.value,address.source_copy_id,address.quote
          FROM unnest($1::text[],$2::text[]) AS moved(body_id,old_parent)
          JOIN entity old_owner ON old_owner.id=moved.old_parent AND old_owner.kind='government'
          JOIN entity body ON body.id=moved.body_id
          JOIN civic_data_rows r ON r.body_id=moved.body_id AND r.collection='meetings'
          JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id
          CROSS JOIN LATERAL (SELECT reader_payload_value(r.value->'mapPin') AS value) pin
          CROSS JOIN LATERAL (SELECT f.source_copy_id,f.quote FROM fact f JOIN source_copy s ON s.id=f.source_copy_id
            WHERE f.entity_id=old_owner.id AND f.field='office_address' AND f.status='live'
              AND f.value#>>'{}'=pin.value->>'address' AND s.url=pin.value#>>'{provenance,sourceUrl}'
            ORDER BY f.checked_at DESC LIMIT 1) address
          WHERE pin.value->>'basis'='GOVERNMENT_OFFICE' AND pin.value->>'bodyId'=moved.body_id
            AND NOT EXISTS (SELECT 1 FROM fact choice WHERE choice.entity_id='meeting:'||r.row_id
              AND choice.field='map_pin' AND choice.status='live' AND choice.provenance_kind='OWNER')
        ), created AS (
          INSERT INTO entity(id,kind,name,state,parent_id)
          SELECT DISTINCT ON(meeting_id) meeting_id,'meeting',name,state,body_id FROM affected ORDER BY meeting_id
          ON CONFLICT(id) DO NOTHING RETURNING id
        ) INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,held_reason,produced_by)
          SELECT meeting_id,'map_pin',value,value->>'address','pulled','OFFICIAL',source_copy_id,quote,now(),
            'GOVERNMENT_OFFICE_OWNER_CHANGED','registration-ownership' FROM affected
          WHERE NOT EXISTS (SELECT 1 FROM fact retired WHERE retired.entity_id=affected.meeting_id AND retired.field='map_pin'
              AND retired.status='pulled' AND retired.held_reason='GOVERNMENT_OFFICE_OWNER_CHANGED' AND retired.value=affected.value)`, moved);
      }
    }
  }
  for (let i = 0; i < batch.externalIds.length; i += size) {
    const rows = batch.externalIds.slice(i, i + size);
    await query(`INSERT INTO entity_external_id (entity_id, scheme, value)
      SELECT * FROM unnest($1::text[], $2::text[], $3::text[]) ON CONFLICT (scheme, value) DO NOTHING`,
    [rows.map(r => r[0]), rows.map(r => r[1]), rows.map(r => r[2])]);
  }
  for (let i = 0; i < batch.hosts.length; i += size) {
    const rows = batch.hosts.slice(i, i + size);
    await query(`INSERT INTO entity_host (entity_id, host) SELECT * FROM unnest($1::text[], $2::text[]) ON CONFLICT DO NOTHING`,
      [rows.map(r => r[0]), rows.map(r => r[1])]);
  }
  for (let i = 0; i < batch.places.length; i += size) {
    const rows = batch.places.slice(i, i + size);
    await query(`INSERT INTO entity_place (entity_id,place_id,boundary_year,placement_basis)
      SELECT * FROM unnest($1::text[],$2::text[],$3::int[],$4::text[])
      ON CONFLICT(entity_id,place_id,boundary_year) DO UPDATE SET placement_basis=EXCLUDED.placement_basis`,
      [rows.map(r => r[0]), rows.map(r => r[1]), rows.map(r => r[2] ?? 0), rows.map(r => r[3] ?? "SERVICE_AREA")]);
  }
  const governments = batch.entities.filter(e => e.kind === "government").map(e => e.id);
  await query(`UPDATE entity b SET state=g.state FROM entity g WHERE b.parent_id=g.id AND b.kind='body'
    AND g.id=ANY($1::text[]) AND b.state IS DISTINCT FROM g.state`,[governments]);
  await query(`DELETE FROM entity_place held WHERE held.entity_id=ANY($1::text[])
    AND NOT EXISTS (SELECT 1 FROM unnest($2::text[],$3::text[]) AS wanted(entity_id,place_id)
      WHERE wanted.entity_id=held.entity_id AND wanted.place_id=held.place_id)`,
  [governments,batch.places.map(p => p[0]),batch.places.map(p => p[1])]);
  await query(`DELETE FROM entity_place unknown WHERE unknown.boundary_year=0 AND unknown.entity_id=ANY($1::text[])
    AND EXISTS (SELECT 1 FROM entity_place dated WHERE dated.entity_id=unknown.entity_id AND dated.place_id=unknown.place_id AND dated.boundary_year>0)`,[governments]);
  // Boards inherit every government association, including the boundary vintage and an explicit host-county filing.
  await query(`INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis)
    SELECT b.id,p.place_id,p.boundary_year,p.placement_basis FROM entity b JOIN entity_place p ON p.entity_id=b.parent_id
    WHERE (b.id=ANY($1::text[]) OR b.parent_id=ANY($2::text[])) AND b.kind='body'
    ON CONFLICT(entity_id,place_id,boundary_year) DO UPDATE SET placement_basis=EXCLUDED.placement_basis`,
  [batch.entities.filter(e => e.kind === "body").map(e => e.id),governments]);
  await query(`INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis)
    SELECT f.person_id,p.place_id,p.boundary_year,
      CASE WHEN bool_or(p.placement_basis='SERVICE_AREA') THEN 'SERVICE_AREA' ELSE 'HOST_COUNTY' END FROM entity b
    JOIN entity_place p ON p.entity_id=b.id
    CROSS JOIN LATERAL (
      SELECT substr(field,8) AS person_id FROM fact WHERE entity_id=b.id AND status='live' AND field LIKE 'member:%'
      UNION SELECT id FROM entity WHERE parent_id=b.id AND kind='meeting'
    ) f JOIN entity subject ON subject.id=f.person_id
    WHERE b.kind='body' AND b.parent_id=ANY($1::text[])
    GROUP BY f.person_id,p.place_id,p.boundary_year
    ON CONFLICT(entity_id,place_id,boundary_year) DO UPDATE SET placement_basis=EXCLUDED.placement_basis`,
  [governments]);
  await query(`DELETE FROM entity_place held USING entity b WHERE b.id=held.entity_id AND b.kind='body'
    AND b.id=ANY($1::text[]) AND NOT EXISTS (
      SELECT 1 FROM unnest($2::text[],$3::text[]) AS wanted(entity_id,place_id)
      WHERE wanted.entity_id=b.id AND wanted.place_id=held.place_id)
    AND NOT EXISTS (SELECT 1 FROM entity_place p WHERE p.entity_id=b.parent_id AND p.place_id=held.place_id)`,
  [batch.entities.filter(e => e.kind === "body").map(e => e.id),batch.places.map(p => p[0]),batch.places.map(p => p[1])]);
  await query(`DELETE FROM entity_place unknown USING entity e WHERE e.id=unknown.entity_id AND unknown.boundary_year=0
    AND e.state=ANY($1::char(2)[]) AND EXISTS (SELECT 1 FROM entity_place dated WHERE dated.entity_id=unknown.entity_id
      AND dated.place_id=unknown.place_id AND dated.boundary_year>0)`,[[...new Set(batch.entities.flatMap(e => e.state ?? []))]]);
  await query(`DELETE FROM entity_place root USING entity e WHERE e.id=root.entity_id
    AND (root.entity_id=ANY($1::text[]) OR e.parent_id=ANY($2::text[])) AND root.place_id ~ '${BARE_ROOT}'
    AND EXISTS (SELECT 1 FROM entity_place local WHERE local.entity_id=root.entity_id AND local.place_id !~ '${BARE_ROOT}')`,
  [batch.entities.map(e => e.id),governments]);
}

/** Saves `alias` as another name for `survivor`, so a reader link, a stored reaction or a source that still says `alias` finds the survivor. */
async function saveAlias(query: Query, survivor: string, alias: string): Promise<void> {
  await query(`INSERT INTO entity_external_id (entity_id, scheme, value) VALUES ($1, '${ID_ALIAS}', $2)
    ON CONFLICT (scheme, value) DO UPDATE SET entity_id = EXCLUDED.entity_id`, [survivor, alias]);
}

/** An id that was merged into another stays an alias, so a later load cannot recreate it; a person already held under the same Open States id is not added a second time. */
async function canonicalEntities(query: Query, batch: EntityBatch): Promise<EntityBatch> {
  const tracked = batch.entities.filter(row => row.kind === "body" || row.kind === "person");
  if (!tracked.length) return batch;
  const aliases = new Map(await survivingIds(query, tracked.map(row => row.id)));
  const persons = new Set(tracked.filter(row => row.kind === "person").map(row => row.id));
  const keyed = batch.externalIds.filter(([id]) => persons.has(id));
  const held = keyed.length ? await query(`SELECT x.entity_id, x.scheme, x.value FROM entity_external_id x
    JOIN unnest($1::text[], $2::text[]) w(scheme, value) ON x.scheme = w.scheme AND x.value = w.value`, [keyed.map(row => row[1]), keyed.map(row => row[2])]) : [];
  const holder = new Map(held.map(row => [`${row.scheme}\u0000${row.value}`, String(row.entity_id)]));
  for (const [id, scheme, value] of keyed) {
    const other = holder.get(`${scheme}\u0000${value}`);
    if (other && other !== id && !aliases.has(id)) { aliases.set(id, other); await saveAlias(query, other, id); }
  }
  // An alias's target is already held with its verified name, government and territory.
  return { entities: batch.entities.filter(row => !aliases.has(row.id)),
    hosts: batch.hosts.filter(([id]) => !aliases.has(id)), externalIds: batch.externalIds.filter(([id]) => !aliases.has(id)),
    places: batch.places.filter(([id]) => !aliases.has(id)) };
}

interface PersonIds {
  readonly name: string;
  readonly state: string | null;
  /** [scheme, value]: bioguide, fec, openstates, legistar-person, ... */
  readonly externalIds: readonly (readonly [string, string])[];
  readonly placeId?: string | null;
  readonly places?: readonly EntityPlace[];
}

/** The seats a set of keys puts a person in: the bodies whose rosters named them. */
const seatsOf = (externalIds: readonly (readonly [string, string])[]) =>
  externalIds.flatMap(([scheme]) => isSeatNameScheme(scheme) ? [scheme.slice("roster-name:".length)] : []);

/** People already held that share an identifier with these, and (when asked) people of the same state with the same surname. */
async function heldPeople(query: Query, person: PersonIds, namesakes: boolean): Promise<readonly (PersonEvidence & { readonly id: string })[]> {
  const surname = parsePersonName(person.name).last;
  const sharing = `SELECT x.entity_id FROM entity_external_id x JOIN unnest($1::text[], $2::text[]) w(scheme, value) ON x.scheme = w.scheme AND x.value = w.value`;
  const named = `SELECT id FROM entity WHERE kind = 'person' AND state IS NOT DISTINCT FROM $3::char(2) AND lower(regexp_replace(name, '[.,''"\`]', ' ', 'g')) LIKE '%' || $4::text || '%'`;
  const withNamesakes = namesakes && surname !== "";
  const rows = await query(`WITH held AS (${sharing}${withNamesakes ? ` UNION ${named}` : ""})
    SELECT e.id, e.name, e.state, coalesce(jsonb_agg(jsonb_build_array(x.scheme, x.value)) FILTER (WHERE x.scheme IS NOT NULL), '[]'::jsonb) AS external
    FROM held JOIN entity e ON e.id = held.entity_id AND e.kind = 'person' LEFT JOIN entity_external_id x ON x.entity_id = e.id GROUP BY e.id`,
  [person.externalIds.map(([scheme]) => scheme), person.externalIds.map(([, value]) => value), ...withNamesakes ? [person.state, surname] : []]);
  return rows.map(row => {
    const external = row.external as [string, string][];
    return { id: String(row.id), name: foldAccents(String(row.name)), state: row.state as string | null, keys: identityKeys(String(row.id), external), seats: seatsOf(external) };
  });
}

/**
 * One permanent id per person. A shared identifier (Open States, bioguide, FEC, a state's filer id, a publisher's member id)
 * finds the same entity; so does the same name in a seat the person already holds. A name alone never does: that person is
 * added separately and a detective is asked. When several held people fit equally, nobody is picked: the question goes to
 * a detective and the caller gets the candidates back.
 */
export async function resolvePerson(db: FactDb, person: PersonIds, retryMinutes = 24 * 60): Promise<string | { readonly tie: readonly string[] }> {
  return db.transaction(async query => {
    const schemes = person.externalIds.map(([scheme]) => scheme), values = person.externalIds.map(([, value]) => value);
    const probe: PersonEvidence = { id: "probe", name: foldAccents(person.name), state: person.state, keys: identityKeys(null, person.externalIds), seats: seatsOf(person.externalIds) };
    let found = matchPerson(probe, await heldPeople(query, person, false));
    // Namesakes are looked for only when no identifier or seat already settled it, so a refresh of a known person reads no more than before.
    if (found.kind === "NEW" || found.kind === "NAME_ONLY") found = matchPerson(probe, await heldPeople(query, person, true));
    const about = { name: person.name, state: person.state, externalIds: person.externalIds };
    if (found.kind === "TIE") {
      const candidates = found.candidates.map(candidate => candidate.id).sort();
      await sendToDetective(query, { entityId: candidates[0]!, field: `identity:${strongestKeys(person.externalIds)[0]!.join(":")}`, reason: "IDENTITY_TIE",
        candidates, about: { ...about, why: found.reason }, retryMinutes });
      return { tie: candidates };
    }
    const id = found.kind === "MATCH" ? found.candidate.id : personId(person.state, person.externalIds);
    const added = found.kind === "MATCH" ? [] : await query("INSERT INTO entity (id, kind, name, state) VALUES ($1, 'person', $2, $3) ON CONFLICT (id) DO NOTHING RETURNING id", [id, person.name, person.state]);
    if (found.kind === "NAME_ONLY" && added.length) await sendToDetective(query, { entityId: id, field: "identity", reason: "IDENTITY_NAME_ONLY",
      candidates: [id, ...found.candidates.map(candidate => candidate.id)], about, retryMinutes });
    const aliases = await query(`INSERT INTO entity_external_id (entity_id, scheme, value) SELECT $1, * FROM unnest($2::text[], $3::text[])
      ON CONFLICT (scheme, value) DO NOTHING RETURNING entity_id`, [id, schemes, values]);
    const places:EntityPlace[]=[...person.places ?? [],...(person.placeId?[{placeId:person.placeId,boundaryYear:0,basis:"SERVICE_AREA" as const}]:[])];
    await fileEntityPlaces(query,id,places,undefined,added.length || aliases.length?[id]:[]);
    return id;
  });
}

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

/** Native Census IDs can be filed under the wrong state. Retain only the requested
 * governments while reading each source state separately; never hold a national map. */
function censusFactsForIds(root:string,ids:ReadonlySet<string>,currentState:string,current:ReadonlyMap<string,CensusGovernmentFacts>):ReadonlyMap<string,CensusGovernmentFacts> {
  const found=new Map<string,CensusGovernmentFacts>();
  for(const state of registeredStates(root)) {
    const facts=state===currentState?current:readCensusGovernmentFacts(root,[state]).byPid;
    for(const id of ids) {
      const row=facts.get(id);
      if(row)found.set(id,row);
    }
  }
  return found;
}

/** A source correction can move a government, its boards and their held service
 * links across a state line. Read both footprints before publishing that batch. */
async function batchStates(query:Query,batch:EntityBatch):Promise<string[]> {
  const rows=await query(`WITH affected AS MATERIALIZED (
    SELECT id,state,parent_id FROM entity WHERE id=ANY($1::text[]) OR parent_id=ANY($2::text[])
  ) SELECT state FROM affected WHERE state IS NOT NULL
    UNION SELECT p.state FROM affected a JOIN entity_place ep ON ep.entity_id=a.id JOIN entity p ON p.id=ep.place_id WHERE p.state IS NOT NULL
    UNION SELECT p.state FROM affected a JOIN entity p ON p.id=a.parent_id WHERE p.state IS NOT NULL`,
  [batch.entities.map(row=>row.id),batch.entities.filter(row=>row.kind==='government').map(row=>row.id)]);
  return rows.map(row=>String(row.state));
}

/** Loads each state whose inputs changed since its last load; an unchanged state costs one read. */
export async function ensureFactEntities(db: FactDb & { readonly query: Query }, root: string, states: readonly string[]): Promise<readonly string[]> {
  const registryFiles = ["lib/registry/registry.json", "lib/registry/promoted-bodies.json"].map(path => readFileSync(join(root, path)));
  const bodies = registryFiles.flatMap(bytes => (JSON.parse(bytes.toString("utf8")) as { bodies: RegistryBody[] }).bodies);
  const [header, ...people] = parseCsv(readFileSync(join(root, "data", "reference", "openstates_legislators.csv"), "utf8"));
  const column = (name: string) => header!.indexOf(name);
  const [idAt, nameAt, stateAt] = [column("ocd_person_id"), column("name"), column("jurisdiction")];
  const loaded = new Map((await db.query("SELECT source, sha256 FROM fact_store_load")).map(r => [String(r.source), String(r.sha256)]));
  const registrationHeld = (await db.query("SELECT to_regclass('civic_data_promotions') IS NOT NULL AS held"))[0]?.held === true;
  const keyedHeld = (await db.query("SELECT to_regclass('civic_data_rows') IS NOT NULL AS held"))[0]?.held === true;
  const country = await db.query(`INSERT INTO entity (id, kind, name, state) VALUES ($1, 'place', 'United States', NULL) ON CONFLICT (id) DO NOTHING RETURNING id`, [COUNTRY]);
  if (country.length) await enqueueReaderPlaces({ places: [COUNTRY] }, db.query);
  const mapHeld = (await db.query("SELECT to_regclass('place_boundary') IS NOT NULL AS held"))[0]?.held === true;
  const done: string[] = [];
  for (const st of states) {
    const file = readFileSync(join(root, "data", "derived", "registration", `${st}.json`));
    const registration = JSON.parse(file.toString("utf8")) as Registration;
    const census = readCensusGovernmentFacts(root,[st]).byPid;
    const stateBodies = [...new Map(bodies.filter(body => (body.ocdId ?? body.id).includes(`/state:${st}`) || body.id.startsWith(`curated:${st}/`))
      .map(body => [body.id, body])).values()];
    const ownerRows = keyedHeld ? await db.query(`SELECT body.id,min(owner.id) AS owner_id FROM unnest($2::text[]) body(id)
      JOIN civic_data_rows r ON r.record_class='REGISTRATION' AND r.collection='governments' AND r.aliases @> ARRAY[body.id]
      JOIN civic_data_promotions p ON p.key=r.promotion_key AND p.current_version_id=r.version_id
      JOIN entity owner ON owner.kind='government' AND owner.id IN(r.value->>'jurisdictionId',r.value->>'id')
      WHERE r.promotion_key=$1 GROUP BY body.id HAVING count(DISTINCT owner.id)=1 ORDER BY body.id`,
      [`REGISTRATION:US-${st.toUpperCase()}:registration:v1`,stateBodies.map(body=>body.id)]) : [];
    const registeredOwners = new Map(ownerRows.map(row=>[String(row.id),String(row.owner_id)]));
    const legislators = people.filter(row => row[stateAt]?.toLowerCase() === st && row[idAt]?.startsWith("ocd-person/"))
      .map(row => ({ ocdPersonId: row[idAt]!, name: row[nameAt]! }));
    // Published service territory is data. A Census office location never overrides a source-established local association.
    const associations = registrationHeld ? [...await db.query(`SELECT g->>'id' AS native_id,g->>'jurisdictionId' AS id,
        jsonb_agg(DISTINCT jsonb_build_object('placeId',a->>'divisionId','boundaryYear',coalesce(a->'boundaryYear','0'::jsonb),'basis','SERVICE_AREA')) AS places
      FROM civic_data_promotions p CROSS JOIN LATERAL jsonb_array_elements(p.payload->'governments') g
      CROSS JOIN LATERAL jsonb_array_elements(g->'associations') a
      WHERE p.key=$1 AND a->>'basis' IN ('SOURCE_CODE','GOVERNING_FUNCSTAT','SOURCE_BOUNDARY','COUNTY_IN_NAME')
        AND a->>'divisionId' LIKE $2 GROUP BY g->>'id',g->>'jurisdictionId' ORDER BY g->>'id'`,
      [`REGISTRATION:US-${st.toUpperCase()}:registration:v1`, `${COUNTRY}/state:${st.toLowerCase()}/%`])] : [];
    const misplaced = registration.governments.filter(g => g[3] === 'SPECIAL DISTRICT' && !census.has(g[0]));
    if (misplaced.length) {
      const located=censusFactsForIds(root,new Set(misplaced.map(g=>g[0])),st,census);
      const counties = misplaced.flatMap(g => {
        const county = located.get(g[0])?.countyFips;
        return county ? [{id:g[1],county}] : [];
      });
      associations.push(...await db.query(`SELECT r.id,r.id AS native_id,c.state,true AS held_place,
        jsonb_build_array(jsonb_build_object('placeId',c.id,'boundaryYear',0,'basis','HOST_COUNTY')) AS places
        FROM jsonb_to_recordset($1::jsonb) AS r(id text,county text)
        JOIN entity_external_id x ON x.scheme='census-geoid:county' AND x.value=r.county
        JOIN entity c ON c.id=x.entity_id AND c.kind='place' ORDER BY r.id`,[JSON.stringify(counties)]));
    }
    // Census geographic county codes establish the host county even when a contact lives in another state.
    if (registrationHeld) associations.push(...await db.query(`SELECT g->>'id' AS native_id,g->>'jurisdictionId' AS id,c.state,
      jsonb_build_array(jsonb_build_object('placeId',c.id,'boundaryYear',0,'basis','HOST_COUNTY')) AS places,true AS held_place
      FROM civic_data_promotions p CROSS JOIN LATERAL jsonb_array_elements(p.payload->'governments') g
      JOIN entity_external_id x ON x.scheme='census-geoid:county' AND x.value=g->>'countyFips'
      JOIN entity c ON c.id=x.entity_id AND c.kind='place'
      WHERE p.key=$1 AND replace(g->>'governmentClass','_',' ')='SPECIAL DISTRICT'
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(g->'associations','[]'::jsonb)) a
          WHERE a->>'basis' IN ('SOURCE_CODE','GOVERNING_FUNCSTAT','SOURCE_BOUNDARY','COUNTY_IN_NAME'))
      ORDER BY g->>'id'`,[`REGISTRATION:US-${st.toUpperCase()}:registration:v1`]));
    if (mapHeld) associations.push(...await db.query(`SELECT e.id,e.id AS native_id,p.state,true AS held_place,
      jsonb_agg(DISTINCT jsonb_build_object('placeId',ep.place_id,'boundaryYear',ep.boundary_year,
        'basis',CASE WHEN b.county_attachment THEN 'HOST_COUNTY' ELSE 'SERVICE_AREA' END)) AS places
      FROM entity e JOIN entity_place ep ON ep.entity_id=e.id JOIN place_boundary b ON b.place_id=ep.place_id AND b.boundary_year=ep.boundary_year
      JOIN entity p ON p.id=ep.place_id
      WHERE e.id=ANY($1::text[]) AND b.layer='district'
      GROUP BY e.id,p.state ORDER BY e.id,p.state`,[registration.governments.map(g => g[1])]));
    const hash = sha256(Buffer.concat([file, Buffer.from(JSON.stringify(["ENTITY_OWNERSHIP_V3", stateBodies, legislators, associations,ownerRows]))]));
    if (loaded.get(`registration:${st}`) === hash) continue;
    const batch = stateEntities(registration, census, stateBodies, legislators,registeredOwners);
    const places = new Set(batch.entities.filter(row => row.kind === "place").map(row => row.id));
    for (const association of associations) {
      const territory = (association.places as EntityPlace[]).filter(p => association.held_place || places.has(p.placeId));
      if (!territory.length) continue;
      territory.sort((a,b) => a.placeId.localeCompare(b.placeId));
      for (const id of [association.id, association.native_id]) {
        const index = batch.entities.findIndex(row => row.id === id && row.kind === "government");
        if (index < 0) continue;
        batch.entities[index] = { ...batch.entities[index]!,state:association.state ? String(association.state) : batch.entities[index]!.state,parentId: territory[0]!.placeId };
        batch.places.splice(0, batch.places.length, ...batch.places.filter(([entity]) => entity !== id),
          ...territory.map(p => [String(id), p.placeId, p.boundaryYear, p.basis] as EntityBatch["places"][number]));
      }
    }
    const marks = await db.transaction(async query => {
      const canonical=await canonicalEntities(query,batch),before=await batchStates(query,canonical);
      await insertEntities(query,canonical);
      const settled = await settleBoards(query, st.toUpperCase());
      await query(`INSERT INTO fact_store_load (source, sha256) VALUES ($1, $2)
        ON CONFLICT (source) DO UPDATE SET sha256 = EXCLUDED.sha256, loaded_at = now()`, [`registration:${st}`, hash]);
      await enqueueReaderPlaces({ states: [...new Set([st,...before,...await batchStates(query,canonical)])] }, query);
      // Each place a board was newly filed on rebuilds its slices.
      return settled.length ? slicesOf(query, settled) : [];
    });
    await markSlices(marks);
    done.push(st);
  }
  return done;
}

/**
 * Loads states in rotation after `previous` until one is already current, marking each state it checks so the
 * next pass resumes after it. A changed importer or registration file reaches every state in one pass; when
 * nothing changed, this reads one state, as the one-state rotation did.
 */
export async function loadChangedStates(states: readonly string[], previous: string | null,
  load: (state: string) => Promise<readonly string[]>, checked: (state: string) => Promise<void>, more: () => boolean): Promise<readonly string[]> {
  const at = (states.indexOf(previous ?? "") + 1) % states.length, loaded: string[] = [];
  for (const state of [...states.slice(at), ...states.slice(0, at)]) {
    if (!more()) break;
    const done = await load(state);
    await checked(state);
    if (!done.length) break;
    loaded.push(...done);
  }
  return loaded;
}

export function registeredStates(root: string): readonly string[] {
  return readdirSync(join(root, "data", "derived", "registration")).filter(name => /^[a-z]{2}\.json$/.test(name)).map(name => name.slice(0, 2)).sort();
}

/** The surviving person or board for an exact saved identity alias; any other id is its own. */
export async function canonicalEntityId(query: Query, id: string): Promise<string> {
  const [alias] = await query(`SELECT entity_id FROM entity_external_id WHERE scheme = '${ID_ALIAS}' AND value = $1`, [id]);
  return alias ? String(alias.entity_id) : id;
}

/** The registered government a board belongs to: the one its id names, else the one its door names; null when neither is held. */
async function bodyGovernment(query: Query, id: string, named: string | null | undefined): Promise<string | null> {
  for (const candidate of [splitSubject(id).root, named]) {
    if (!candidate) continue;
    const government = await registeredGovernment(query, candidate);
    if ((await query("SELECT 1 FROM entity WHERE id = $1 AND kind = 'government'", [government])).length) return government;
  }
  return null;
}

/**
 * Who a board belongs to when nothing has named its government: the place its id is named for (`<place>#body:<slug>`), the registered
 * government of a Census of Governments id (`government:US-XX:cog:<id>#…`), or the one local government that alone holds the site the
 * board publishes on. A site shared by two governments, or none, names nobody: the board waits, and its page says so.
 */
async function boardOwner(query: Query, id: string, state: string | null): Promise<string | null> {
  const { root, tail } = splitSubject(id);
  if (tail) {
    const [place] = await query("SELECT id FROM entity WHERE id=$1 AND kind='place' AND (state IS NULL OR $2::char(2) IS NULL OR state=$2::char(2))", [root, state]);
    if (place) return root;
    const government = await registeredGovernment(query, root);
    const [held] = await query("SELECT id FROM entity WHERE id=$1 AND kind='government'", [government]);
    if (held) return government;
  }
  const hosted = await query(`SELECT DISTINCT g.id FROM entity_host mine JOIN entity_host site ON site.host=mine.host
    JOIN entity g ON g.id=site.entity_id AND g.kind='government' AND ($2::char(2) IS NULL OR g.state=$2::char(2))
    WHERE mine.entity_id=$1 AND EXISTS (SELECT 1 FROM entity_place p WHERE p.entity_id=g.id AND p.place_id !~ '${BARE_ROOT}')
      AND NOT EXISTS (SELECT 1 FROM entity_host other JOIN entity og ON og.id=other.entity_id AND og.kind='government' AND og.id<>g.id WHERE other.host=site.host)`, [id, state]);
  return hosted.length === 1 ? String(hosted[0]!.id) : null;
}

/**
 * Gives each of a state's boards that sit on no place the owner its id or its site names, and files it where that owner is filed. Run with
 * the state's load, so boards the doors created before they could name an owner, and registry boards hung on the bare state, reach the
 * pages of the places they serve. Returns the boards that were filed.
 */
export async function settleBoards(query: Query, state: string): Promise<readonly string[]> {
  const unplaced = await query(`SELECT b.id,b.parent_id FROM entity b WHERE b.kind='body' AND b.state=$1::char(2)
    AND NOT EXISTS (SELECT 1 FROM entity_place p WHERE p.entity_id=b.id)
    AND NOT EXISTS (SELECT 1 FROM entity_external_id x WHERE x.scheme='body-alias' AND x.value=b.id) ORDER BY b.id`, [state]);
  const filed: string[] = [];
  for (const board of unplaced) {
    const id = String(board.id), parent = board.parent_id === null ? null : String(board.parent_id);
    const owner = parent !== null && !new RegExp(BARE_ROOT).test(parent) ? parent : await boardOwner(query, id, state);
    if (owner === null) continue;
    if (owner !== parent) await query("UPDATE entity SET parent_id=$2 WHERE id=$1", [id, owner]);
    if ((await fileEntityPlaces(query, id, [], owner)).moved) filed.push(id);
  }
  return filed;
}

/** Mints an entity found after the backfill and returns its durable identity; aliased boards reuse the surviving entity.
 * A board hangs on its registered government, and a held board left on a bare state root moves to the government or local place a writer now names. */
export async function ensureEntity(query: Query, row: EntityRow): Promise<string> {
  const id = row.kind === "body" || row.kind === "person" ? await canonicalEntityId(query, row.id) : row.id;
  if (id !== row.id) {
    if (row.places?.length) await fileEntityPlaces(query,id,row.places);
    return id;
  }
  if (row.kind === "body" && publishedBodyLabel(row.name).kind !== "body") {
    const body = await publishedBody(query, row);
    // A named body can still be published before its government has been loaded.
    // Keep the body name, not the calendar's sitting label.
    if (!body && publishedBodyLabel(row.name).name)
      return ensureEntity(query, { ...row, name: publishedBodyLabel(row.name).name! });
    if (!body) throw new Error("MEETING_BODY_OWNER_UNKNOWN");
    if (body.id !== row.id) {
      await query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES($1,'body-alias',$2) ON CONFLICT DO NOTHING", [body.id, row.id]);
      if (row.places?.length) await fileEntityPlaces(query, body.id, row.places);
    }
    return body.id;
  }
  const parentId = row.kind !== "body" ? row.parentId : await bodyGovernment(query, id, row.government) ?? (row.parentId && !new RegExp(BARE_ROOT).test(row.parentId) ? row.parentId : null) ?? await boardOwner(query, id, row.state) ?? row.parentId;
  const changed = await query(`WITH held AS MATERIALIZED (SELECT parent_id FROM entity WHERE id=$1), changed AS (
    INSERT INTO entity (id, kind, name, state, parent_id)
    SELECT $1, $2, $3, $4, (SELECT id FROM entity WHERE id = coalesce(
      (SELECT entity_id FROM entity_external_id WHERE scheme = 'body-alias' AND value = $5), $5))
    ON CONFLICT (id) DO UPDATE SET parent_id = EXCLUDED.parent_id
      WHERE entity.kind = 'body' AND EXCLUDED.kind = 'body' AND entity.state IS NOT DISTINCT FROM EXCLUDED.state
        AND (entity.parent_id IS NULL OR entity.parent_id ~ '${BARE_ROOT}') AND EXCLUDED.parent_id !~ '${BARE_ROOT}'
    RETURNING id
  ) SELECT id,(SELECT parent_id FROM held) AS old_parent FROM changed`,
  [id, row.kind, row.name, row.state, parentId]);
  const changedEntities=changed.length?[id,...changed.flatMap(row=>typeof row.old_parent==="string"?[row.old_parent]:[])]:[];
  if (["body","government","meeting"].includes(row.kind)) await fileEntityPlaces(query,id,row.places ?? [],parentId,changedEntities);
  else if(changedEntities.length)await enqueueReaderPlaces({entities:changedEntities},query);
  return id;
}

interface GovernmentRef { readonly id: string; readonly state: string | null; readonly placeId: string; readonly name: string }
export interface BodyRef { readonly id: string; readonly name: string; readonly state: string | null; readonly parentId: string | null }

/** Resolve a calendar label within its own government. Existing named boards win; an unnamed sitting uses its owner's board. */
export async function publishedBody(query: Query, row: { readonly id: string; readonly name: string; readonly parentId?: string | null; readonly government?: string | null }): Promise<BodyRef | null> {
  const label = publishedBodyLabel(row.name);
  const registered = await bodyGovernment(query, row.id, row.government);
  const government = await governmentAt(query, [registered, row.government ?? null, row.parentId ?? null, splitSubject(row.id).root]);
  // A source may arrive before its government entity. An already held body
  // under the same exact place can still identify a named sitting.
  if (!government && label.name) {
    const root = splitSubject(row.id).root;
    const siblings = await query(`SELECT id,name,state,parent_id FROM entity b WHERE kind='body' AND id LIKE $1 AND id<>$2
      AND split_part(id,'#',1)=$3
      AND NOT EXISTS(SELECT 1 FROM entity_external_id x WHERE x.scheme='body-alias' AND x.value=b.id)`, [`${root}#%`, row.id, root]);
    const matches = siblings.filter(body => publishedBodyLabel(String(body.name)).kind === "body" && bodyNameKey(String(body.name)) === bodyNameKey(label.name!));
    if (matches.length === 1) {
      const match = matches[0];
      return { id: String(match.id), name: String(match.name), state: match.state as string | null, parentId: match.parent_id as string | null };
    }
  }
  if (!government) return null;
  const siblings = await query(`SELECT id,name,state,parent_id FROM entity b WHERE kind='body'
    AND (parent_id=$1 OR id LIKE $2) AND id<>$3
    AND NOT EXISTS(SELECT 1 FROM entity_external_id x WHERE x.scheme='body-alias' AND x.value=b.id)`,
  [government.id, `${government.placeId}#%`, row.id]);
  const key = ` ${bodyNameKey(row.name)} `;
  const matched = siblings.filter(body => publishedBodyLabel(String(body.name)).kind === "body")
    .map(body => ({ body, at: key.indexOf(` ${bodyNameKey(String(body.name))} `) }))
    .filter(candidate => candidate.at >= 0)
    .sort((a, b) => a.at - b.at || String(b.body.name).length - String(a.body.name).length)[0]?.body;
  if (matched) return { id: String(matched.id), name: String(matched.name), state: matched.state as string | null, parentId: matched.parent_id as string | null };
  if (label.name) return bodyNamed(query, government.id, null, label.name);
  return ensureGoverningBody(query, government.id);
}

/** The government a finding is about, with the place it sits on; the first of the given ids that is one. A dependent school system the fact store lacks is added on its district's place when that place is held. */
export async function governmentAt(query: Query, ids: readonly (string | null)[]): Promise<GovernmentRef | null> {
  for (const id of ids.flatMap(row => row ? [row.split("#")[0]!] : [])) {
    const [government] = await query(`SELECT g.id, g.name, g.state, g.parent_id FROM entity g JOIN entity p ON p.id = g.parent_id
      WHERE g.id = $1 AND g.kind = 'government' AND p.kind = 'place'`, [id]);
    const dependent = /^([a-z]{2}):depschool:([a-z0-9-]+)$/.exec(id);
    if (government && (!dependent || localPlace(String(government.parent_id))))
      return { id, state: government.state as string | null, placeId: String(government.parent_id), name: String(government.name) };
    const candidates = dependent ? schoolPlaces(dependent[1]!, dependent[2]!) : [];
    const [place] = candidates.length ? await query("SELECT id, name, state FROM entity WHERE id = ANY($1::text[]) AND kind = 'place' ORDER BY array_position($1::text[], id) LIMIT 1", [candidates]) : [];
    if (place) {
      await ensureEntity(query, { id, kind: "government", name: String(place.name), state: place.state as string | null, parentId: String(place.id) });
      const moved = await query("UPDATE entity SET parent_id = $2 WHERE id = $1 AND parent_id IS DISTINCT FROM $2 RETURNING id", [id, place.id]);
      const removed = await query("DELETE FROM entity_place WHERE entity_id = $1 AND place_id <> $2 RETURNING place_id", [id, place.id]);
      const added = await query("INSERT INTO entity_place (entity_id, place_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING place_id", [id, place.id]);
      if (moved.length || removed.length || added.length) await enqueueReaderPlaces({ entities: [id],
        places: [...removed.map(row => String(row.place_id)), ...(government ? [String(government.parent_id)] : [])] }, query);
      return { id, state: place.state as string | null, placeId: String(place.id), name: government ? String(government.name) : String(place.name) };
    }
    if (government) return { id, state: government.state as string | null, placeId: String(government.parent_id), name: String(government.name) };
  }
  // A body hung straight on its place, with no government between: the place stands for the government.
  for (const id of ids.flatMap(row => row ? [row.split("#")[0]!] : [])) {
    const [place] = await query("SELECT id, name, state FROM entity WHERE id = $1 AND kind = 'place'", [id]);
    if (place) return { id, state: place.state as string | null, placeId: id, name: String(place.name) };
  }
  return null;
}

const slug = (words: string) => words.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A board's name is its government's id and one tail: `#governing`, `#board` or `#body:<slug>`. */
export function splitSubject(subjectId: string): { readonly root: string; readonly tail: string } {
  const cut = subjectId.indexOf("#");
  return cut < 0 ? { root: subjectId, tail: "" } : { root: subjectId.slice(0, cut), tail: subjectId.slice(cut) };
}

const SCHOOL_DISTRICT_LAYERS = ["census-geoid:unsd", "census-geoid:elsd", "census-geoid:scsd"];

/** The registered government a native id stands for: an NCES agency id through the school district it was registered on, a Census of Governments id through its census id. Any other id is its own. */
async function registeredGovernment(query: Query, id: string): Promise<string> {
  const school = /^government:US-([A-Z]{2}):nces:(\d{7})$/.exec(id);
  if (school) {
    const found = await query(`SELECT g.id, g.id LIKE '%:school:%' AS school FROM entity_external_id x JOIN entity g ON g.parent_id = x.entity_id AND g.kind = 'government'
      WHERE x.scheme = ANY($1::text[]) AND x.value = $2 AND g.state = $3 ORDER BY school DESC, g.id LIMIT 5`, [SCHOOL_DISTRICT_LAYERS, school[2], school[1]]);
    const best = found.filter(row => row.school === found[0]?.school);
    if (best.length) return heldFirst(query, id, best.map(row => String(row.id)));
    // A school district the registration never paired with a government is still a place: the place stands for its government, as it does for any board hung straight on a place.
    const places = await query(`SELECT x.entity_id AS id FROM entity_external_id x JOIN entity p ON p.id = x.entity_id AND p.kind = 'place'
      WHERE x.scheme = ANY($1::text[]) AND x.value = $2 AND p.state = $3 ORDER BY x.entity_id LIMIT 5`, [SCHOOL_DISTRICT_LAYERS, school[2], school[1]]);
    return places.length ? heldFirst(query, id, places.map(row => String(row.id))) : id;
  }
  const census = /^government:US-([A-Z]{2}):cog:(\d+)$/.exec(id);
  if (census) {
    const [found] = await query(`SELECT x.entity_id AS id FROM entity_external_id x JOIN entity g ON g.id = x.entity_id AND g.kind = 'government'
      WHERE x.scheme = 'census-pid6' AND x.value = $1 AND g.state = $2 LIMIT 1`, [census[2], census[1]]);
    return found ? String(found.id) : id;
  }
  return id;
}

/** The first of the held governments that fit one native id; when several fit equally, a detective is asked which is right. */
async function heldFirst(query: Query, nativeId: string, candidates: readonly string[]): Promise<string> {
  if (candidates.length > 1) await sendToDetective(query, { entityId: candidates[0]!, field: `identity:${nativeId}`, reason: "IDENTITY_TIE", candidates, about: { nativeId } });
  return candidates[0]!;
}

/** The subject under the one board name: its government's registered id, then its tail. */
export async function canonicalSubject(query: Query, subjectId: string): Promise<string> {
  const body = await canonicalEntityId(query, subjectId);
  if (body !== subjectId) return body;
  const { root, tail } = splitSubject(subjectId);
  const government = await registeredGovernment(query, root);
  // A committee whose name is the governing board's, however the page dressed it ("Our Governing Board", "Mayor and Council"), is that board.
  if (tail.startsWith("#body:")) {
    const context = await governmentContext(query, government);
    if (governingBoardName(tail.slice(6).replace(/-/g, " "), context) !== null) return canonicalEntityId(query, `${government}${context.school ? "#board" : "#governing"}`);
  }
  return canonicalEntityId(query, `${government}${tail}`);
}

/** What the fact store says kind of government this is and what it is called, for reading a body's name against it. */
async function governmentContext(query: Query, id: string): Promise<GoverningContext> {
  const [row] = await query("SELECT name FROM entity WHERE id = $1", [id]);
  return { name: row ? String(row.name) : null,
    school: /:(?:school|depschool):|school_district:|:nces:/.test(id), special: /:special:/.test(id), county: /:county:|\/county:[^/]+$/.test(id) };
}

export async function placeBody(query: Query, id: string, place: string): Promise<void> {
  const [body] = await query("SELECT parent_id,EXISTS(SELECT 1 FROM entity_place WHERE entity_id=e.parent_id) AS placed FROM entity e WHERE id=$1",[id]);
  await fileEntityPlaces(query,id,body?.placed ? [] : [{placeId:place,boundaryYear:0,basis:"SERVICE_AREA"}],body?.parent_id as string | null);

}

/** A body of a government held by name, or added under it: bodies hang on the government and sit on its place. Two held bodies that fit equally are a question for a detective; writes go on to the first by id. */
async function bodyUnder(query: Query, government: GovernmentRef, find: { readonly sql: string; readonly param: string }, id: string, name: string): Promise<BodyRef> {
  const fits = await query(`SELECT id, name, state, parent_id FROM entity WHERE kind = 'body' AND (parent_id = $1 OR id LIKE $2) AND ${find.sql} ORDER BY id LIMIT 5`,
    [government.id, `${government.placeId}#%`, find.param]);
  if (fits.length > 1) await sendToDetective(query, { entityId: government.id, field: `identity:body:${find.param.toLowerCase()}`, reason: "IDENTITY_TIE",
    candidates: fits.map(row => String(row.id)), about: { government: government.id, looking_for: find.param } });
  const [held] = fits;
  if (held) {
    await placeBody(query, String(held.id), government.placeId);
    return { id: String(held.id), name: String(held.name), state: held.state as string | null, parentId: held.parent_id as string | null };
  }
  const bodyId = await ensureEntity(query, { id, kind: "body", name, state: government.state, parentId: government.id });
  if (bodyId !== id) {
    const [held] = await query("SELECT id, name, state, parent_id FROM entity WHERE id = $1 AND kind = 'body'", [bodyId]);
    return { id: bodyId, name: String(held!.name), state: held!.state as string | null, parentId: held!.parent_id as string | null };
  }
  await placeBody(query, bodyId, government.placeId);
  return { id: bodyId, name, state: government.state, parentId: government.id };
}

/** The body a name on a government's page stands for: its governing board under whatever name the page gives it, a body of that name it already holds, or a new body named `<government id>#body:<slug>`. */
export async function bodyNamed(query: Query, subjectId: string, governing: BodyRef | null, name: string): Promise<(BodyRef & { readonly asNamed?: string }) | null> {
  const label = publishedBodyLabel(name);
  if (label.kind !== "body") return publishedBody(query, { id: `${subjectId}#calendar-label`, name, parentId: governing?.parentId ?? subjectId });
  const government = await governmentAt(query, [governing?.parentId ?? null, governing?.id ?? null, subjectId]);
  if (!government) return null;
  const board = governingBoardName(name, await governmentContext(query, government.id));
  if (board !== null) {
    const found = governing ?? await ensureGoverningBody(query, government.id);
    return found ? { ...found, asNamed: board } : null;
  }
  return bodyUnder(query, government, { sql: "lower(name) = lower($3)", param: name }, subBodyId(government.id, name), name);
}

/** The office of a government that a phone, email or address belongs to (a recorder, an elections office): the body already held, or a new one named as the page names it. */
export async function officeNamed(query: Query, subjectId: string, governing: BodyRef | null, kind: string, name: string): Promise<BodyRef | null> {
  const government = await governmentAt(query, [governing?.parentId ?? null, governing?.id ?? null, subjectId]);
  return government ? bodyUnder(query, government, { sql: "name ILIKE '%' || $3 || '%'", param: kind }, `${government.id}#office-${slug(kind)}`, name) : null;
}

/** A .gov page code has already matched to this entity is one of its own sites. */
export async function learnOfficialHost(query: Query, entityId: string, url: string): Promise<void> {
  if (isOfficialUrl(url, [])) await learnSite(query, entityId, hostOf(url));
}

/** The channel a reviewed door reads for this entity: the feed's host and the path above it. */
export async function learnDoorChannel(query: Query, entityId: string, url: string): Promise<void> {
  const { pathname } = new URL(url);
  await learnSite(query, entityId, `${hostOf(url)}${pathname.slice(0, pathname.lastIndexOf("/")) || ""}`);
}

async function learnSite(query: Query, entityId: string, site: string): Promise<void> {
  const changed = await query(`INSERT INTO entity_host (entity_id, host) SELECT id, $2 FROM entity WHERE id = coalesce(
    (SELECT entity_id FROM entity_external_id WHERE scheme = 'body-alias' AND value = $1), $1) ON CONFLICT DO NOTHING RETURNING entity_id`, [entityId, site]);
  if (changed.length) await enqueueReaderPlaces({ entities: changed.map(row => String(row.entity_id)) }, query);
}
