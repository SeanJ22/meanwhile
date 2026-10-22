import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "../reference/csv.ts";
import { readCensusGovernmentFacts, type CensusGovernmentFacts } from "../registration/jurisdictions.ts";
import type { FactDb, Query } from "./publish.ts";
import { hostOf, isOfficialUrl } from "./check.ts";

type EntityKind = "place" | "government" | "body" | "seat" | "person" | "meeting" | "agenda_item" | "bill" | "vote_event"
  | "election" | "contest" | "candidacy" | "measure" | "committee" | "statement" | "law_question" | "news_item";

interface EntityRow {
  readonly id: string;
  readonly kind: EntityKind;
  readonly name: string;
  readonly state: string | null;
  readonly parentId: string | null;
}

interface EntityBatch {
  readonly entities: EntityRow[];
  readonly hosts: [entityId: string, host: string][];
  readonly externalIds: [entityId: string, scheme: string, value: string][];
  readonly places: [entityId: string, placeId: string][];
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
}

function hostOfAddress(address: string): string | null {
  if (!address.trim()) return null;
  try {
    return new URL(/^https?:\/\//i.test(address) ? address : `http://${address}`).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch { return null; }
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());

/** One state's places, governments and registry bodies; a special district sits on its own territory, or on the state until a boundary draws it. */
export interface Legislator { readonly ocdPersonId: string; readonly name: string }

function stateEntities(reg: Registration, census: ReadonlyMap<string, CensusGovernmentFacts>, bodies: readonly RegistryBody[],
  legislators: readonly Legislator[] = []): EntityBatch {
  const out = emptyBatch();
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
    // A special district's office county is not its territory: placed there, it would govern every ZIP in the county.
    const place = divisionIndex >= 0 ? reg.divisions[divisionIndex]?.[0] : govType === "SPECIAL DISTRICT" ? stateDivision : county ?? stateDivision;
    out.entities.push({ id: jurisdictionId, kind: "government", name: titleCase(name), state, parentId: place ?? null });
    if (pid6 && /^\d+$/.test(pid6)) out.externalIds.push([jurisdictionId, "census-pid6", pid6]);
    if (place) out.places.push([jurisdictionId, place]);
    const host = facts ? hostOfAddress(facts.web) : null;
    if (host) out.hosts.push([jurisdictionId, host]);
  }
  const governmentByPid = new Map(reg.governments.map(g => [g[0], g[1]]));
  const governmentOnDivision = new Map(reg.governments.filter(g => g[4] >= 0).map(g => [reg.divisions[g[4]]?.[0], g[1]]));
  const divisionName = new Map(reg.divisions.map(d => [d[0], d[3]]));
  for (const body of bodies) {
    const place = body.ocdId && known.has(body.ocdId) ? body.ocdId : null;
    const government = (body.censusId ? governmentByPid.get(body.censusId) : undefined) ?? (place ? governmentOnDivision.get(place) : undefined);
    const name = body.name ?? `${(place && divisionName.get(place)) ?? body.id} ${body.bodyClass.toLowerCase().replace(/_/g, " ")}`;
    out.entities.push({ id: body.id, kind: "body", name, state, parentId: government ?? place ?? stateDivision });
    if (place) out.places.push([body.id, place]);
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
    await query(`INSERT INTO entity (id, kind, name, state, parent_id)
      SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::char(2)[], $5::text[])
      ON CONFLICT (id) DO UPDATE SET parent_id = EXCLUDED.parent_id
        WHERE entity.kind IN ('government', 'body') AND EXCLUDED.kind = entity.kind AND entity.parent_id IS DISTINCT FROM EXCLUDED.parent_id`,
    [rows.map(r => r.id), rows.map(r => r.kind), rows.map(r => r.name), rows.map(r => r.state), rows.map(r => r.parentId)]);
  }
  const governments = batch.entities.filter(row => row.kind === "government");
  for (let i = 0; i < governments.length; i += size) {
    const rows = governments.slice(i, i + size);
    await query(`DELETE FROM entity_place ep USING unnest($1::text[], $2::text[]) AS g(id, place)
      WHERE ep.entity_id = g.id AND ep.place_id IS DISTINCT FROM g.place`, [rows.map(r => r.id), rows.map(r => r.parentId)]);
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
    await query(`INSERT INTO entity_place (entity_id, place_id) SELECT * FROM unnest($1::text[], $2::text[]) ON CONFLICT DO NOTHING`,
      [rows.map(r => r[0]), rows.map(r => r[1])]);
  }
}

interface PersonIds {
  readonly name: string;
  readonly state: string | null;
  /** [scheme, value]: bioguide, fec, openstates, legistar-person, ... */
  readonly externalIds: readonly (readonly [string, string])[];
  readonly placeId?: string | null;
}

/** One permanent id per person: any shared external id finds the same entity; a name alone never does. */
export async function resolvePerson(db: FactDb, person: PersonIds): Promise<string> {
  return db.transaction(async query => {
    const schemes = person.externalIds.map(([scheme]) => scheme), values = person.externalIds.map(([, value]) => value);
    const held = await query(`SELECT DISTINCT entity_id FROM entity_external_id x JOIN unnest($1::text[], $2::text[]) AS w(scheme, value)
      ON x.scheme = w.scheme AND x.value = w.value ORDER BY entity_id`, [schemes, values]);
    const openStates = person.externalIds.find(([scheme]) => scheme === "openstates")?.[1];
    const id = held.length ? String(held[0]!.entity_id) : openStates ?? `ocd-person/${randomUUID()}`;
    if (!held.length) await query("INSERT INTO entity (id, kind, name, state) VALUES ($1, 'person', $2, $3) ON CONFLICT (id) DO NOTHING", [id, person.name, person.state]);
    await query(`INSERT INTO entity_external_id (entity_id, scheme, value) SELECT $1, * FROM unnest($2::text[], $3::text[])
      ON CONFLICT (scheme, value) DO NOTHING`, [id, schemes, values]);
    if (person.placeId) await query("INSERT INTO entity_place (entity_id, place_id) SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM entity WHERE id = $2) ON CONFLICT DO NOTHING", [id, person.placeId]);
    return id;
  });
}

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

/** Loads each state whose inputs changed since its last load; an unchanged state costs one read. */
export async function ensureFactEntities(db: FactDb & { readonly query: Query }, root: string, states: readonly string[]): Promise<readonly string[]> {
  const registryFiles = ["lib/registry/registry.json", "lib/registry/promoted-bodies.json"].map(path => readFileSync(join(root, path)));
  const bodies = registryFiles.flatMap(bytes => (JSON.parse(bytes.toString("utf8")) as { bodies: RegistryBody[] }).bodies);
  const [header, ...people] = parseCsv(readFileSync(join(root, "data", "reference", "openstates_legislators.csv"), "utf8"));
  const column = (name: string) => header!.indexOf(name);
  const [idAt, nameAt, stateAt] = [column("ocd_person_id"), column("name"), column("jurisdiction")];
  const loaded = new Map((await db.query("SELECT source, sha256 FROM fact_store_load")).map(r => [String(r.source), String(r.sha256)]));
  await db.query(`INSERT INTO entity (id, kind, name, state) VALUES ($1, 'place', 'United States', NULL) ON CONFLICT (id) DO NOTHING`, [COUNTRY]);
  const done: string[] = [];
  for (const st of states) {
    const file = readFileSync(join(root, "data", "derived", "registration", `${st}.json`));
    const stateBodies = [...new Map(bodies.filter(body => (body.ocdId ?? body.id).includes(`/state:${st}`) || body.id.startsWith(`curated:${st}/`))
      .map(body => [body.id, body])).values()];
    const legislators = people.filter(row => row[stateAt]?.toLowerCase() === st && row[idAt]?.startsWith("ocd-person/"))
      .map(row => ({ ocdPersonId: row[idAt]!, name: row[nameAt]! }));
    const hash = sha256(Buffer.concat([file, Buffer.from(JSON.stringify([stateBodies, legislators]))]));
    if (loaded.get(`registration:${st}`) === hash) continue;
    const batch = stateEntities(JSON.parse(file.toString("utf8")) as Registration, readCensusGovernmentFacts(root, [st]).byPid, stateBodies, legislators);
    await db.transaction(async query => {
      await insertEntities(query, batch);
      await query(`INSERT INTO fact_store_load (source, sha256) VALUES ($1, $2)
        ON CONFLICT (source) DO UPDATE SET sha256 = EXCLUDED.sha256, loaded_at = now()`, [`registration:${st}`, hash]);
    });
    done.push(st);
  }
  return done;
}

export function registeredStates(root: string): readonly string[] {
  return readdirSync(join(root, "data", "derived", "registration")).filter(name => /^[a-z]{2}\.json$/.test(name)).map(name => name.slice(0, 2)).sort();
}

/** Mints an entity found after the backfill; its parent is kept only when already held. */
export async function ensureEntity(query: Query, row: EntityRow): Promise<void> {
  await query(`INSERT INTO entity (id, kind, name, state, parent_id)
    SELECT $1, $2, $3, $4, (SELECT id FROM entity WHERE id = $5) ON CONFLICT (id) DO NOTHING`,
  [row.id, row.kind, row.name, row.state, row.parentId]);
}

interface GovernmentRef { readonly id: string; readonly state: string | null; readonly placeId: string; readonly placeName: string }
export interface BodyRef { readonly id: string; readonly name: string; readonly state: string | null; readonly parentId: string | null }

/** The government a finding is about, with the place it sits on; the first of the given ids that is one. A dependent school system the fact store lacks is added on its district's place when that place is held. */
async function governmentAt(query: Query, ids: readonly (string | null)[]): Promise<GovernmentRef | null> {
  for (const id of ids.flatMap(row => row ? [row.split("#")[0]!] : [])) {
    const [government] = await query(`SELECT g.id, g.state, g.parent_id, p.name AS place_name FROM entity g JOIN entity p ON p.id = g.parent_id
      WHERE g.id = $1 AND g.kind = 'government' AND p.kind = 'place'`, [id]);
    if (government) return { id, state: government.state as string | null, placeId: String(government.parent_id), placeName: String(government.place_name) };
    const dependent = /^([a-z]{2}):depschool:([a-z0-9-]+)$/.exec(id);
    const [place] = dependent ? await query("SELECT id, name, state FROM entity WHERE id = $1 AND kind = 'place'",
      [`ocd-division/country:us/state:${dependent[1]}/school_district:${dependent[2]!.replace(/-/g, "_")}`]) : [];
    if (place) {
      await ensureEntity(query, { id, kind: "government", name: String(place.name), state: place.state as string | null, parentId: String(place.id) });
      await query("INSERT INTO entity_place (entity_id, place_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, place.id]);
      return { id, state: place.state as string | null, placeId: String(place.id), placeName: String(place.name) };
    }
  }
  // A body hung straight on its place, with no government between: the place stands for the government.
  for (const id of ids.flatMap(row => row ? [row.split("#")[0]!] : [])) {
    const [place] = await query("SELECT id, name, state FROM entity WHERE id = $1 AND kind = 'place'", [id]);
    if (place) return { id, state: place.state as string | null, placeId: id, placeName: String(place.name) };
  }
  return null;
}

const slug = (words: string) => words.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A city's, county's or school district's governing board when the fact store holds none: a board on its own place, where readers look for it. */
export async function ensureGoverningBody(query: Query, governmentId: string): Promise<void> {
  const kind = /^[a-z]{2}:(city|county|school|depschool):/.exec(governmentId)?.[1];
  const government = kind ? await governmentAt(query, [governmentId]) : null;
  if (!kind || !government) return;
  const school = kind === "school" || kind === "depschool", id = `${government.placeId}${school ? "#board" : "#governing"}`;
  await ensureEntity(query, { id, kind: "body", name: `${government.placeName} ${school ? "school board" : "governing"}`,
    state: government.state, parentId: government.id });
  await query("INSERT INTO entity_place (entity_id, place_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, government.placeId]);
}

/** A body of a government held by name, or added under it: bodies hang on the government and sit on its place. */
async function bodyUnder(query: Query, government: GovernmentRef, find: { readonly sql: string; readonly param: string }, key: string, name: string): Promise<BodyRef> {
  const [held] = await query(`SELECT id, name, state, parent_id FROM entity WHERE kind = 'body' AND (parent_id = $1 OR id LIKE $2) AND ${find.sql} LIMIT 1`,
    [government.id, `${government.placeId}#%`, find.param]);
  if (held) return { id: String(held.id), name: String(held.name), state: held.state as string | null, parentId: held.parent_id as string | null };
  const id = `${government.id}#${key}`;
  await ensureEntity(query, { id, kind: "body", name, state: government.state, parentId: government.id });
  await query("INSERT INTO entity_place (entity_id, place_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, government.placeId]);
  return { id, name, state: government.state, parentId: government.id };
}

/** The body a name on a government's page stands for: its governing board, a body of that name it already holds, or a new body of that name. */
export async function bodyNamed(query: Query, subjectId: string, governing: BodyRef | null, name: string, governingName: boolean): Promise<BodyRef | null> {
  if (governingName && governing) return governing;
  const government = await governmentAt(query, [governing?.parentId ?? null, governing?.id ?? null, subjectId]);
  return government ? bodyUnder(query, government, { sql: "lower(name) = lower($3)", param: name }, slug(name), name) : null;
}

/** The office of a government that a phone, email or address belongs to (a recorder, an elections office): the body already held, or a new one named as the page names it. */
export async function officeNamed(query: Query, subjectId: string, governing: BodyRef | null, kind: string, name: string): Promise<BodyRef | null> {
  const government = await governmentAt(query, [governing?.parentId ?? null, governing?.id ?? null, subjectId]);
  return government ? bodyUnder(query, government, { sql: "name ILIKE '%' || $3 || '%'", param: kind }, `office-${slug(kind)}`, name) : null;
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

const learnSite = (query: Query, entityId: string, site: string) =>
  query("INSERT INTO entity_host (entity_id, host) SELECT id, $2 FROM entity WHERE id = $1 ON CONFLICT DO NOTHING", [entityId, site]);
