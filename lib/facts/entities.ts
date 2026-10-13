import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "../reference/csv.ts";
import { readCensusGovernmentFacts, type CensusGovernmentFacts } from "../registration/jurisdictions.ts";
import type { FactDb, Query } from "./publish.ts";

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

/** One state's places, governments and registry bodies; special districts sit on their county. */
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
    if (geoid) out.externalIds.push([ocdId, `census-geoid:${layer}`, geoid]);
  }
  for (const [pid6, jurisdictionId, name, , divisionIndex] of reg.governments) {
    const facts = census.get(pid6);
    const county = facts?.countyFips ? countyByFips.get(facts.countyFips.slice(-3)) : undefined;
    const place = divisionIndex >= 0 ? reg.divisions[divisionIndex]?.[0] : county ?? stateDivision;
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
    await query(`INSERT INTO entity (id, kind, name, state, parent_id)
      SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::char(2)[], $5::text[]) ON CONFLICT (id) DO NOTHING`,
    [rows.map(r => r.id), rows.map(r => r.kind), rows.map(r => r.name), rows.map(r => r.state), rows.map(r => r.parentId)]);
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
