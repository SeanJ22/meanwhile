/** What a portrait list reads from promoted rosters: one small version row per roster, then only the people it is owed for.
 * A roster at the version the last list read is never read again; a person whose portrait readers are shown never leaves the database. */
import { sql, type SQL } from "drizzle-orm";
import { portraitBindingMatches, type PortraitVerification } from "../photos/binding.ts";
import { PERSON_ID_NAMESPACES, personIdentityKeys } from "../officials/people-identity.ts";
import type { Officeholder, OfficeholderSet } from "../officials/types.ts";
import { projectionKey } from "./projection-key.ts";
import type { RoutineRecordClass } from "./types.ts";

/** One promoted roster's people without their offices and field receipts, and the identity its read model hash names. */
export interface SlimRoster {
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly versionId: string;
  readonly promotedAt: string;
  readonly readModelSha256: string | null;
  readonly roster: OfficeholderSet;
}

interface RosterRef { readonly recordClass: RoutineRecordClass; readonly scope: string }
export interface PortraitRosterRequest {
  /** The rosters a state's people are merged from, in the order readers merge them. */
  readonly rosters: readonly RosterRef[];
  /** The state's portrait record: the portraits it holds keep their people out of every slice. */
  readonly portrait: RosterRef;
  /** Each roster's version the last list read, by projection key; null when every roster is to be read. */
  readonly read: Readonly<Record<string, string>> | null;
  /** People whose retry is due: their rows, and every row naming the same person, are read from unchanged rosters too. */
  readonly due: readonly string[];
  /** Other people (members of Congress) whose portrait may be held in the portrait record. */
  readonly subjects: readonly string[];
}
export interface PortraitRosters {
  /** Every requested roster that is held, carrying only its rows the list is owed for. */
  readonly rosters: readonly SlimRoster[];
  /** Portrait-record rows for listed people whose photo is not one the database can confirm is shown. */
  readonly portrait: OfficeholderSet | null;
  /** Subjects with a portrait readers are shown. */
  readonly shown: readonly string[];
  /** The version of each held roster, by projection key: what the next list compares against. */
  readonly versions: Readonly<Record<string, string>>;
  /** No portrait record is held yet: every roster was read whole, people with portraits included. */
  readonly everyone: boolean;
  /** Every held roster was read (first list, a continuation, or all of them changed). */
  readonly complete: boolean;
}

export interface PortraitRosterVersion {
  readonly key: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly versionId: string;
  readonly promotedAt: string;
  readonly readModelSha256: string | null;
}
export interface PortraitSliceInput {
  readonly keys: readonly string[];
  readonly portraitKey: string | null;
  readonly changed: readonly string[];
  readonly due: readonly string[];
  readonly subjects: readonly string[];
}
export interface PortraitSlices {
  readonly rosters: ReadonlyMap<string, OfficeholderSet>;
  readonly shown: readonly string[];
}
export interface PortraitRosterIO {
  /** One small row per held roster whose people are a list. */
  readonly versions: (keys: readonly string[]) => Promise<readonly PortraitRosterVersion[]>;
  readonly slices: (input: PortraitSliceInput) => Promise<PortraitSlices>;
}

const emptyRoster = (scope: string, generatedAt: string): OfficeholderSet => ({ scope, generatedAt, officeholders: [], divisions: [], unmatched: [] });

export async function readPortraitRosters(io: PortraitRosterIO, request: PortraitRosterRequest): Promise<PortraitRosters> {
  const keys = request.rosters.map(row => projectionKey(row.recordClass, row.scope));
  const portraitKey = projectionKey(request.portrait.recordClass, request.portrait.scope);
  const versions = new Map((await io.versions([...new Set([...keys, portraitKey])])).map(row => [row.key, row]));
  const everyone = !versions.has(portraitKey);
  const held = [...new Set(keys)].filter(key => versions.has(key));
  const changed = held.filter(key => everyone || !request.read || request.read[key] !== versions.get(key)!.versionId);
  const slices = changed.length || request.due.length || request.subjects.length
    ? await io.slices({ keys: held, portraitKey: everyone ? null : portraitKey, changed, due: request.due, subjects: request.subjects })
    : { rosters: new Map<string, OfficeholderSet>(), shown: [] };
  return {
    rosters: held.map(key => {
      const version = versions.get(key)!;
      return { recordClass: version.recordClass, scope: version.scope, versionId: version.versionId, promotedAt: version.promotedAt,
        readModelSha256: version.readModelSha256, roster: slices.rosters.get(key) ?? emptyRoster(version.scope, version.promotedAt) };
    }),
    portrait: everyone ? null : slices.rosters.get(portraitKey) ?? null,
    shown: slices.shown,
    versions: Object.fromEntries(held.map(key => [key, versions.get(key)!.versionId])),
    everyone,
    complete: changed.length === held.length,
  };
}

/** A person's fields a portrait list and its work need; offices, merged source copies and most field receipts stay behind. */
const ROSTER_PERSON_HEAVY_FIELDS = ["offices", "fieldSources", "sourceHolders"] as const;
function slimRosterPerson(person: Record<string, unknown>): Record<string, unknown> {
  const fieldSources = person.fieldSources as Record<string, unknown> | undefined;
  const kept = Object.fromEntries(["name", "officeTitle", "photo"].flatMap(field => fieldSources?.[field] ? [[field, fieldSources[field]]] : []));
  const slim = Object.fromEntries(Object.entries(person).filter(([key]) => !(ROSTER_PERSON_HEAVY_FIELDS as readonly string[]).includes(key)));
  return { ...slim, fieldSources: kept };
}

/** A portrait the database can confirm readers are shown: one bound to this row's own person on its own page or the source feed.
 * Any other portrait leaves the database and is checked in full by the list. */
function rosterPortraitShown(person: Pick<Officeholder, "id" | "personId" | "photo">): boolean {
  const verification = person.photo?.verification as PortraitVerification | undefined;
  return (verification?.basis === "OWN_PAGE" || verification?.basis === "SOURCE_FEED") &&
    portraitBindingMatches(person.personId ?? person.id, person.photo!);
}

/** The same choice as the database's, over rosters already in memory. */
export function portraitSlicesInMemory(rosters: ReadonlyMap<string, OfficeholderSet>, input: PortraitSliceInput): PortraitSlices {
  type Row = { key: string; person: Officeholder; people: ReadonlySet<string> };
  const rows: Row[] = [...new Set([...input.keys, ...input.portraitKey ? [input.portraitKey] : []])].flatMap(key =>
    (rosters.get(key)?.officeholders ?? []).map(person => ({ key, person,
      people: new Set([...personIdentityKeys(person)].filter((id): id is string => typeof id === "string")) })));
  const shownPeople = new Set(input.portraitKey ? rows.filter(row => rosterPortraitShown(row.person)).flatMap(row => [...row.people]) : []);
  const open = rows.filter(row => (row.key !== input.portraitKey || Boolean(row.person.photo)) && ![...row.people].some(id => shownPeople.has(id)));
  const changed = new Set(input.changed);
  const seed = new Set([...open.filter(row => changed.has(row.key)).flatMap(row => [...row.people]), ...input.due, ...input.subjects]);
  const linked = new Set(rows.filter(row => [...row.people].some(id => seed.has(id))).flatMap(row => [...row.people]));
  const picked = new Set(open.filter(row => changed.has(row.key) || [...row.people].some(id => linked.has(id))));
  const result = new Map<string, OfficeholderSet>();
  for (const key of new Set([...picked].map(row => row.key))) {
    const roster = rosters.get(key)!, people = [...picked].filter(row => row.key === key).map(row => row.person);
    const ids = new Set(people.map(person => person.id));
    result.set(key, structuredClone({ scope: roster.scope, generatedAt: roster.generatedAt,
      ...roster.currentMembershipComplete === undefined ? {} : { currentMembershipComplete: roster.currentMembershipComplete },
      officeholders: people.map(person => slimRosterPerson(person as unknown as Record<string, unknown>)) as unknown as Officeholder[],
      divisions: roster.divisions.filter(row => ids.has(row.officeholderId)), unmatched: roster.unmatched.filter(row => ids.has(row.officeholderId)) }));
  }
  return { rosters: result, shown: input.subjects.filter(id => shownPeople.has(id)) };
}

const textArray = (values: readonly string[]) => `{${values.map(value => `"${value.replace(/["\\]/g, "\\$&")}"`).join(",")}}`;
const ISO_TIME = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?Z$";
const SHA256 = "^sha256-[a-f0-9]{64}$";

export function portraitRosterVersionsSql(keys: readonly string[]): SQL {
  return sql`select p.key, p.record_class, p.scope, p.current_version_id as version_id, p.promoted_at, c.normalized_hash
    from civic_data_promotions p join civic_data_candidates c on c.id = p.current_version_id
    where p.key = any(${textArray(keys)}::text[]) and jsonb_typeof(p.payload#>'{roster,officeholders}') = 'array'`;
}

/** The rows a portrait list is owed, chosen inside the database: people whose portrait is shown, and every row naming them, never leave it. */
export function portraitRosterSlicesSql(input: PortraitSliceInput): SQL {
  const all = textArray([...new Set([...input.keys, ...input.portraitKey ? [input.portraitKey] : []])]);
  const changed = textArray(input.changed), seeds = textArray([...input.due, ...input.subjects]), subjects = textArray(input.subjects);
  const portraitKey = input.portraitKey ?? "", namespaces = JSON.stringify(PERSON_ID_NAMESPACES);
  return sql`with roster as (
      select p.key, e.ord, e.o from civic_data_promotions p
      cross join lateral jsonb_array_elements(p.payload#>'{roster,officeholders}') with ordinality as e(o, ord)
      where p.key = any(${all}::text[]) and jsonb_typeof(p.payload#>'{roster,officeholders}') = 'array'
    ), native as (
      select r.key, r.ord, n.source, v.id, regexp_replace(lower(n.source), '[^a-z0-9]', '', 'g') as ns from roster r
      cross join lateral jsonb_each(case when jsonb_typeof(r.o->'nativeIds') = 'object' then r.o->'nativeIds' else '{}'::jsonb end) n(source, ids)
      cross join lateral jsonb_array_elements_text(case when jsonb_typeof(n.ids) = 'array' then n.ids else '[]'::jsonb end) v(id)
      where v.id <> ''
    ), keyed as (
      select key, ord, o->>'id' as person from roster
      union select key, ord, coalesce(o->>'personId', o->>'id') from roster
      union select key, ord, case when source = 'reader' then id else source || ':' || id end from native
      union select native.key, native.ord, c.canonical || ':' || case when c.canonical = 'ocd-person' then regexp_replace(native.id, '^ocd-person/', '') else native.id end
        from native join jsonb_each_text(${namespaces}::jsonb) c(ns, canonical) on c.ns = native.ns
      union select key, ord, id from native where source = 'ocd-person' and id like 'ocd-person/%'
    ), shown as (
      select r.key, r.ord from roster r cross join lateral (select r.o->'photo' as photo, r.o#>'{photo,verification}' as v) x
      where ${portraitKey} <> '' and x.v->>'basis' in ('OWN_PAGE', 'SOURCE_FEED')
        and x.v->>'personId' = coalesce(r.o->>'personId', r.o->>'id')
        and x.v->>'imageHash' ~ ${SHA256} and x.v->>'sourceImageHash' ~ ${SHA256} and x.v->>'checkedAt' ~ ${ISO_TIME}
        and jsonb_typeof(x.v->'sources') = 'array' and jsonb_array_length(x.v->'sources') > 0
        and not exists (select 1 from jsonb_array_elements(x.v->'sources') s where not (
          (coalesce(s->>'artifactId', '') <> '' or coalesce(s->>'vaultKey', '') like 'project/freshness/source/%')
          and coalesce(s->>'contentHash', '') ~ ${SHA256} and coalesce(s->>'retrievedAt', '') ~ ${ISO_TIME}))
        and case when jsonb_typeof(x.v->'attribution') = 'object'
          then x.v#>>'{attribution,name}' = x.v->>'name'
            and exists (select 1 from jsonb_array_elements(x.v->'sources') s where s->>'url' = x.v#>>'{attribution,sourceUrl}')
          else coalesce(x.v#>>'{license,value}', '') <> '' and coalesce(x.v#>>'{license,quote}', '') <> ''
            and exists (select 1 from jsonb_array_elements(x.v->'sources') s where s->>'url' = x.v#>>'{license,sourceUrl}') end
        and case when x.v->>'basis' = 'OWN_PAGE'
          then exists (select 1 from jsonb_array_elements(x.v->'sources') s where s->>'url' = x.v->>'ownPageUrl')
          else exists (select 1 from jsonb_array_elements(x.v->'sources') s where s->>'url' ~ '^https://api[.]congress[.]gov/v3/member/'
            or s->>'url' ~ '^https://(www[.])?openstates[.]org(/|$)'
            or s->>'url' ~ '^https://(raw[.]githubusercontent[.]com|github[.]com|codeload[.]github[.]com)/openstates/people(/|$)') end
        and x.photo->>'sourceUrl' = x.v->>'imageUrl'
        and x.photo->>'url' ~ ('^/api/portraits/officials/' || substr(x.v->>'imageHash', 8) || '[.](jpg|png|webp|gif)$')
    ), shown_people as (
      select distinct k.person from keyed k join shown s on s.key = k.key and s.ord = k.ord where k.person is not null
    ), open as (
      select r.key, r.ord from roster r
      where (r.key <> ${portraitKey} or jsonb_typeof(r.o->'photo') = 'object')
        and not exists (select 1 from keyed k join shown_people s on s.person = k.person where k.key = r.key and k.ord = r.ord)
    ), seed as (
      select k.person from keyed k join open o on o.key = k.key and o.ord = k.ord where o.key = any(${changed}::text[])
      union select unnest(${seeds}::text[])
    ), linked as (
      select distinct k2.person from keyed k1 join seed s on s.person = k1.person join keyed k2 on k2.key = k1.key and k2.ord = k1.ord
    ), picked as (
      select key, ord from open where key = any(${changed}::text[])
      union select o.key, o.ord from open o join keyed k on k.key = o.key and k.ord = o.ord join linked l on l.person = k.person
    ), people as (
      select r.key, jsonb_agg(r.o - 'offices' - 'fieldSources' - 'sourceHolders' || jsonb_build_object('fieldSources', coalesce(jsonb_strip_nulls(jsonb_build_object(
          'name', r.o#>'{fieldSources,name}', 'officeTitle', r.o#>'{fieldSources,officeTitle}', 'photo', r.o#>'{fieldSources,photo}')), '{}'::jsonb)) order by r.ord) as officeholders,
        array_agg(r.o->>'id') as ids
      from picked x join roster r on r.key = x.key and r.ord = x.ord group by r.key
    )
    select g.key, ((p.payload->'roster') - 'officeholders' - 'endedMemberships' - 'divisions' - 'unmatched' - 'disagreements' - 'vacancies')
        || jsonb_build_object('officeholders', g.officeholders,
          'divisions', (select coalesce(jsonb_agg(d), '[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(p.payload#>'{roster,divisions}') = 'array'
            then p.payload#>'{roster,divisions}' else '[]'::jsonb end) d where d->>'officeholderId' = any(g.ids)),
          'unmatched', (select coalesce(jsonb_agg(u), '[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(p.payload#>'{roster,unmatched}') = 'array'
            then p.payload#>'{roster,unmatched}' else '[]'::jsonb end) u where u->>'officeholderId' = any(g.ids))) as roster
      from people g join civic_data_promotions p on p.key = g.key
    union all
    select null, (select coalesce(jsonb_agg(person), '[]'::jsonb) from shown_people where person = any(${subjects}::text[]))`;
}
