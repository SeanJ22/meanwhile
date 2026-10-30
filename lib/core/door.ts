import { checkFact, isOfficialUrl, type CheckEntity, type Claim, type Provenance } from "../facts/check.ts";
import { canonicalJson } from "../control-plane/repository/types.ts";
import { enqueueReaderPlaces, invalidateReaderCache, readerCacheScopeForEntity, type ReaderCachePurger, type ReaderCacheScope } from "../reader/cache.ts";
import { bodyNamed, canonicalSubject, ensureEntity, governmentAt, placeBody, splitSubject, type BodyRef } from "../facts/entities.ts";
import { readCheckEntity } from "../facts/entity-read.ts";
import type { FactDb, Query, PublishInput, Clocks } from "../facts/publish.ts";
import { isSourceApiUrl } from "../control-plane/scheduler/scout-api.ts";
import { isOfficialSource, pageLinksSource, type OfficialLinkingPage } from "../civic-data/source-authority.ts";
import { saveCaptureCopy } from "../facts/source-copy.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import {fileEntityPlaces, type EntityPlace} from "../facts/entity-places.ts";
import { resolveId } from "./resolve.ts";
import { sendToDetective } from "../facts/identity-blank.ts";
import { confirmFactSource, type FactConfirmation } from "../facts/confirmation.ts";
import { markSlices, slicesOf, type SliceMark } from "./slice-marks.ts";
import { foldPlacePages } from "../reader/place-builder.ts";

export type Decision = "PUBLISH" | "CONFIRM" | "KEEP_CURRENT" | "FLAG_OWNER";

interface Side { readonly value: unknown; readonly provenance: Provenance; readonly fetchedAt: Date; readonly sourceUrl?: string }

export type DoorInput = Omit<PublishInput, "entity"> & (
  { readonly entity: CheckEntity; readonly subjectId?: string }
  | { readonly entity?: undefined; readonly subjectId: string }
) & {
  readonly linkingPage?: OfficialLinkingPage | null;
  readonly capture?: WorkerPublicationCapture;
  /** Select the publisher's record and field in the attached saved JSON response. */
  readonly savedField?: { readonly idField: string; readonly id: number; readonly key: string;
    readonly form?: "text" | "date" | "membership" };
  /** A board named by the government's own source, when it has no entity yet. */
  readonly board?: { readonly governmentId: string; readonly name: string };
  readonly places?: readonly EntityPlace[];
};
export type DoorOutcome = { readonly decision: Decision; readonly factId: number | null } | { readonly refused: string };
export function savedCopyFreshnessRefusal(fetchedAt: Date, windowHours: number, now: Date): string | undefined {
  const age=(now.getTime()-fetchedAt.getTime())/3_600_000;
  return !Number.isFinite(age)||age<0||age>windowHours?"COPY_OUTSIDE_FRESHNESS_WINDOW":undefined;
}
interface DoorOptions {
  readonly purge?: ReaderCachePurger;
}

const rank: Readonly<Record<Provenance, number>> = { OWNER: 0, OFFICIAL: 1, FILING: 1, REFERENCE: 2, NEWS: 3, CAMPAIGN: 4, OTHER: 5 };
const savedFields=new WeakMap<object,Map<string,Map<unknown,Readonly<Record<string,unknown>>>>>();
function savedRecord(input:DoorInput):Readonly<Record<string,unknown>>|undefined {
  const selector=input.savedField!,holder=input.capture??input.copy;
  let fields=savedFields.get(holder);if(!fields){fields=new Map();savedFields.set(holder,fields);}
  let rows=fields.get(selector.idField);
  if(!rows){
    const response:unknown=JSON.parse(input.capture?.evidence.text??input.copy.text);
    rows=new Map(Array.isArray(response)?response.map(row=>[row[selector.idField],row]):[]);
    fields.set(selector.idField,rows);
  }
  return rows.get(selector.id);
}

function officialSource(url: string, hosts: readonly string[], linkingPage?: OfficialLinkingPage | null): boolean {
  return isOfficialUrl(url, hosts) || isSourceApiUrl(url) || isOfficialSource(url, linkingPage)
    || !!linkingPage && officialSource(linkingPage.url, hosts, linkingPage.linkingPage) && pageLinksSource(url, linkingPage);
}

/** Newer and more official wins; a value Sean typed changes only through him. */
export function decide(current: Side | null, incoming: Side, field?: string): Decision {
  if (current === null) return "PUBLISH";
  if (canonicalJson(current.value) === canonicalJson(incoming.value)) return "CONFIRM";
  return decideDifferent(current, incoming, field);
}

function decideDifferent(current: Side, incoming: Side, field?: string): Decision {
  if (incoming.provenance === "OWNER") return "PUBLISH";
  if (current.provenance === "OWNER") return "FLAG_OWNER";
  if (field === "agenda_url" && (current.provenance === "OFFICIAL" || current.provenance === "FILING")
    && agendaPage(current.value, current.sourceUrl) && !agendaPage(incoming.value)) return "KEEP_CURRENT";
  if (rank[current.provenance] !== rank[incoming.provenance]) return rank[incoming.provenance] < rank[current.provenance] ? "PUBLISH" : "KEEP_CURRENT";
  return incoming.fetchedAt > current.fetchedAt ? "PUBLISH" : "KEEP_CURRENT";
}

/** A checked sidebar link cannot replace the government's held agenda page. */
function agendaPage(value: unknown, sourceUrl?: string): boolean {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  const url = new URL(value);
  if (/youtube|facebook|twitter|instagram|vimeo/i.test(url.hostname + url.pathname)) return false;
  const purpose = /agenda|calendar|meeting|council[-_/]?archives|boarddocs|legistar/i.test(`${url.pathname} ${url.search} ${url.hostname}`);
  if (!purpose && !(sourceUrl && /council|board|commission/i.test(url.pathname))) return false;
  return sourceUrl === undefined || URL.canParse(sourceUrl) && url.hostname.replace(/^www\./, "") === new URL(sourceUrl).hostname.replace(/^www\./, "");
}

/** A city's, county's, special district's or school district's governing board when the fact store holds none: a board named `<government id>#governing` (`#board` for schools) on the government, and on its place, where readers look for it. */
export async function ensureGoverningBody(query: Query, subjectId: string): Promise<BodyRef | null> {
  const subject = await resolveId(subjectId, query) ?? await canonicalSubject(query, subjectId);
  if (subject !== subjectId) {
    const [held] = await query("SELECT id, name, state, parent_id FROM entity WHERE id = $1 AND kind = 'body'", [subject]);
    if (held) return { id: String(held.id), name: String(held.name), state: held.state as string | null, parentId: held.parent_id as string | null };
  }
  const { root } = splitSubject(subject);
  const kind = /^[a-z]{2}:(city|county|special|school|depschool):/.exec(root)?.[1]
    ?? (/^ocd-division\/.*\/school_district:[^/]+$/.test(root) ? "school" : /^ocd-division\/.*\/county:[^/]+$/.test(root) ? "county" : /^ocd-division\/.*\/place:[^/]+$/.test(root) ? "city" : undefined);
  const government = kind ? await governmentAt(query, [root]) : null;
  if (!kind || !government) return null;
  const school = kind === "school" || kind === "depschool";
  const name = `${government.name} ${school ? "school board" : "governing board"}`;
  const [held, ...rivals] = await query("SELECT id, name, state, parent_id FROM entity WHERE kind = 'body' AND parent_id = $1 AND (id LIKE '%#governing' OR id LIKE '%#board') ORDER BY id LIMIT 5", [government.id]);
  // Two held boards claim to be the government's governing board: writes go on to the first by id, and a detective is asked which is right.
  if (rivals.length) await sendToDetective(query, { entityId: government.id, field: "identity:governing-body", reason: "IDENTITY_TIE",
    candidates: [held!, ...rivals].map(row => String(row.id)), about: { government: government.id } });
  if (held) {
    if (String(held.name).endsWith(" governing")) {
      await query("UPDATE entity SET name=$2 WHERE id=$1 AND name=$3", [held.id, name, held.name]);
      await enqueueReaderPlaces({ entities: [String(held.id)] }, query);
      held.name = name;
    }
    await placeBody(query, String(held.id), government.placeId);
    return { id: String(held.id), name: String(held.name), state: held.state as string | null, parentId: held.parent_id as string | null };
  }
  const id = `${government.id}${school ? "#board" : "#governing"}`;
  const bodyId = await ensureEntity(query, { id, kind: "body", name, state: government.state, parentId: government.id });
  if (bodyId !== id) {
    const [held] = await query("SELECT id, name, state, parent_id FROM entity WHERE id = $1 AND kind = 'body'", [bodyId]);
    return { id: bodyId, name: String(held!.name), state: held!.state as string | null, parentId: held!.parent_id as string | null };
  }
  await placeBody(query, bodyId, government.placeId);
  return { id: bodyId, name, state: government.state, parentId: government.id };
}


/** Resolve, check the appropriate lane, decide and write one fact in one transaction. */
export async function door(db: FactDb, input: DoorInput, clocks: Clocks, now: Date = new Date(),
  options: DoorOptions = {}): Promise<DoorOutcome> {
  let changed: ReaderCacheScope | undefined;
  let confirmation: FactConfirmation | undefined;
  let marks: readonly SliceMark[] = [], removed: readonly string[] = [];
  const outcome = await db.transaction<DoorOutcome>(async (query) => {
    const requested = input.subjectId ?? input.entity!.id;
    const subjectId = await resolveId(requested, query) ?? await canonicalSubject(query, requested);
    let entity = await readCheckEntity(query, subjectId);
    const sourceUrl = input.capture?.evidence.canonicalUrl ?? input.copy.finalUrl;
    const government = !entity && input.board ? await readCheckEntity(query,
      await resolveId(input.board.governmentId, query) ?? await canonicalSubject(query, input.board.governmentId)) : null;
    if (!entity && input.board && government && officialSource(sourceUrl, government.hosts, input.linkingPage)) {
      const body = await bodyNamed(query, government.id, null, input.board.name);
      if (body) {
        if (requested !== body.id) await query(`INSERT INTO entity_external_id(entity_id,scheme,value)
          VALUES($1,'body-alias',$2) ON CONFLICT DO NOTHING`, [body.id, requested]);
        entity = await readCheckEntity(query, await resolveId(requested, query) ?? body.id);
      }
    }
    if (!entity && ["#governing", "#board"].includes(splitSubject(subjectId).tail) && officialSource(sourceUrl, [], input.linkingPage)) {
      const body = await ensureGoverningBody(query, subjectId);
      if (body) entity = await readCheckEntity(query, body.id);
    }
    if (!entity) {
      return { refused: "SUBJECT_NOT_FOUND" };
    }
    const copy = input.capture ? await saveCaptureCopy(query, input.capture) : input.copy;
    const official = officialSource(copy.finalUrl, entity.hosts, input.linkingPage);
    const acquisition = input.acquisition ?? (input.producedBy === "box" ? "hunter" : input.producedBy.startsWith("carton:") ? "walker" : "loader");
    const campaign = input.provenance === "CAMPAIGN" && !isOfficialUrl(copy.finalUrl, []) && !isSourceApiUrl(copy.finalUrl);
    const loaded = official && (acquisition === "loader" || acquisition === "checked") && !campaign;
    const provenance = input.provenance === "OWNER" ? "OWNER" : campaign ? "CAMPAIGN" : official ? input.provenance === "FILING" ? "FILING" : "OFFICIAL" : input.provenance;
    const c: PublishInput = { ...input, entity, provenance, copy };
    if (input.savedField) {
      const selector = input.savedField;
      const record = savedRecord(input);
      const raw = record?.[selector.key];
      const expected = selector.form === "membership" ? { name: String(raw ?? "").trim(),
        office: typeof record?.OfficeRecordTitle === "string" && record.OfficeRecordTitle.trim()
          || typeof record?.OfficeRecordMemberType === "string" && record.OfficeRecordMemberType.trim() || null }
        : selector.form === "date" ? typeof raw === "string" ? raw.slice(0,10) : null
        : typeof raw === "string" ? raw.trim() : raw;
      if (!record || canonicalJson(expected) !== canonicalJson(c.value)) {
        return { refused: "SOURCE_FIELD_MISMATCH" };
      }
    }
    const campaignSelf = c.provenance !== "CAMPAIGN" || c.sourceSubjectId !== undefined
      && await resolveId(c.sourceSubjectId, query) === entity.id;
    // Also serialize the first value for a field, before there is a head row to lock.
    await query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([entity.id, c.field])]);
    // Scope first: a sparse live-status index can otherwise scan every published fact for one claim.
    const [head] = await query(`WITH head AS MATERIALIZED (
      SELECT id FROM fact WHERE entity_id = $1 AND field = $2
      ORDER BY (status = 'live') DESC, id DESC LIMIT 1 FOR UPDATE
    ), own AS MATERIALIZED (
      SELECT id, value, value_text, quote, second_copy_id, provenance_kind, source_copy_id, checked_at, status, held_reason FROM checked_fact WHERE id = (SELECT id FROM head)
    ) SELECT f.id, md5(f.value::text)=md5($3::jsonb::text) AS same_value,
      f.value_text=$4 AS same_text, f.quote=$5 AS same_quote,
      CASE WHEN $6::boolean THEN f.value#>>'{}' END AS agenda_value,
      f.second_copy_id, f.provenance_kind, f.status, f.held_reason, f.source_copy_id, f.checked_at,
      coalesce(s.fetched_at,f.checked_at) AS fetched_at,s.final_url AS source_url
      FROM own f LEFT JOIN source_copy s ON s.id=f.source_copy_id`,
      [c.entity.id, c.field, JSON.stringify(c.value), c.valueText, c.quote, !loaded && c.field === "agenda_url"]);
    const row = head?.status === "live" ? head : undefined;
    // Replaying an already checked source is a no-op, including after its freshness window.
    // It does not refresh the checked date, publish a value, or count another delivery.
    const repeated = campaignSelf && row && Number(row.source_copy_id) === c.copy.id && (row.provenance_kind === c.provenance || row.provenance_kind === input.provenance)
      && c.copy.fetchedAt.getTime() <= Math.max(new Date(row.fetched_at as string).getTime(), new Date(row.checked_at as string).getTime())
      && row.same_quote && row.same_text && (row.second_copy_id === null ? null : Number(row.second_copy_id)) === (c.second?.copy.id ?? null)
      && row.same_value;
    const verdict = repeated ? {ok:true as const,quoteStart:null} : input.savedField && savedCopyFreshnessRefusal(c.copy.fetchedAt,clocks.windowHours(c.fieldKind),now)
      ? {ok:false as const,reason:"COPY_OUTSIDE_FRESHNESS_WINDOW"} : !campaignSelf ? { ok: false as const, reason: "CAMPAIGN_OTHER_SUBJECT" }
      : provenance === "OWNER" ? { ok: true as const, quoteStart: null } : checkFact(c, now, clocks.windowHours);
    if (!verdict.ok) {
      return { refused: verdict.reason };
    }
    const [placement] = await query("SELECT parent_id FROM entity WHERE id=$1",[entity.id]);
    const filed=await fileEntityPlaces(query,entity.id,input.places ?? [],placement?.parent_id as string | null);
    if(filed.moved) {
      removed=filed.removed;
      changed=await readerCacheScopeForEntity(query,entity.id);
      marks=await slicesOf(query,[entity.id],removed);
    }
    if (repeated) return {decision:"CONFIRM",factId:Number(row!.id)};
    // Sean removed this value; the same words from a source do not put it back, a different value does.
    if (!row && head?.held_reason === "OWNER_REMOVED" && head.same_value) return { decision: "KEEP_CURRENT", factId: null };
    const currentProvenance = row?.provenance_kind === "OWNER" || row?.provenance_kind === "FILING" ? row.provenance_kind
      : row?.source_url && (isOfficialUrl(String(row.source_url),entity.hosts) || isSourceApiUrl(String(row.source_url))) ? "OFFICIAL" : row?.provenance_kind;
    const decision = !row ? "PUBLISH" : row.same_value ? "CONFIRM" : decideDifferent(
      { value: row.agenda_value, provenance: currentProvenance as Claim["provenance"], fetchedAt: new Date(row.fetched_at as string), sourceUrl: row.source_url as string },
      { value: c.value, provenance: c.provenance, fetchedAt: c.copy.fetchedAt }, loaded ? undefined : c.field);
    if (decision === "CONFIRM") {
      if (row!.provenance_kind !== "OWNER" && rank[c.provenance] <= rank[row!.provenance_kind as Provenance]
        && (rank[c.provenance] < rank[row!.provenance_kind as Provenance] || c.copy.fetchedAt > new Date(row!.fetched_at as string))) {
        confirmation = {copyId:c.copy.id,scope:`door:${c.producedBy}`,at:now.toISOString(),factIds:[Number(row!.id)],
          receipts:{[String(row!.id)]:{quote:c.quote,quote_start:verdict.quoteStart,second_copy_id:c.second?.copy.id ?? null,
            provenance_kind:c.provenance,value_text:c.valueText}}};
        await query("DELETE FROM blank WHERE entity_id = $1 AND field = $2", [c.entity.id, c.field]);
      }
      return { decision, factId: Number(row!.id) };
    }
    const live = decision === "PUBLISH";
    if (!live) {
      const [repeat] = await query(`SELECT id FROM fact WHERE entity_id=$1 AND field=$2 AND value=$3::jsonb
        AND provenance_kind=$4 AND source_copy_id=$5 AND status='held' ORDER BY id DESC LIMIT 1`,
      [entity.id, c.field, JSON.stringify(c.value), c.provenance, c.copy.id]);
      if (repeat) return { decision, factId: Number(repeat.id) };
    }
    if (live && row) await query("UPDATE fact SET status = 'superseded' WHERE id = $1", [row.id]);
    const [inserted] = await query(`INSERT INTO fact (entity_id, field, value, value_text, status, provenance_kind, source_copy_id, quote,
        quote_start, second_copy_id, checked_at, live_at, held_reason, produced_by, cost_usd)
      VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $5 = 'live' THEN $11::timestamptz END, $12, $13, $14)
      RETURNING id`,
    [c.entity.id, c.field, JSON.stringify(c.value), c.valueText, live ? "live" : "held", c.provenance, c.copy.id, c.quote,
      verdict.quoteStart, c.second?.copy.id ?? null, now.toISOString(),
      live ? null : decision === "FLAG_OWNER" ? "OWNER_VALUE_CONTESTED" : "LOSES_TO_CURRENT", c.producedBy, c.costUsd]);
    const factId = Number(inserted!.id);
    if (decision === "FLAG_OWNER") await query(`INSERT INTO owner_flag (fact_id,kind,reason,source_url)
      SELECT $1,'OWNER_VALUE_CONTESTED',$2,$3 WHERE NOT EXISTS(SELECT 1 FROM owner_flag WHERE fact_id=$1 AND resolved IS NULL)`,
    [row!.id,`A source states a different value: ${c.valueText}`,c.copy.finalUrl]);
    if (live) {
      await query("DELETE FROM blank WHERE entity_id = $1 AND field = $2", [c.entity.id, c.field]);
      await enqueueReaderPlaces({ entities: [entity.id] }, query);
      changed = await readerCacheScopeForEntity(query, c.entity.id);
      marks = await slicesOf(query, [entity.id], removed);
    }
    return { decision, factId };
  });
  if (confirmation) await confirmFactSource(db,confirmation,options.purge);
  if (changed) await invalidateReaderCache(changed, options.purge, null);
  await markSlices(marks);
  return outcome;
}

/**
 * A source read in full no longer shows a fact it used to: the fact moves to history and keeps the last date the source showed it.
 * `copyId` retires facts last read from that saved page; without one, `sourceUrl` retires those read from any address starting with it.
 * `stillShown` are the fields under `fieldPrefix` the source still shows. Facts the source showed after `at` and a value Sean typed stay.
 * Callers read the source in full first, so a source that could not be read or changed shape never gets here and retires nothing;
 * a saved page that was not answered with success or is an archive retires nothing either.
 */
export async function retireAbsent(db: FactDb, input: {
  readonly subjectId: string; readonly fieldPrefix: string; readonly copyId?: number; readonly sourceUrl?: string;
  readonly stillShown: readonly string[]; readonly at: Date; readonly purge?: ReaderCachePurger;
}): Promise<number> {
  let changed: ReaderCacheScope | undefined;
  let marks: readonly SliceMark[] = [];
  const count = await db.transaction(async query => {
    const subjectId = await resolveId(input.subjectId, query) ?? input.subjectId;
    const [copy] = input.copyId === undefined ? [] : await query("SELECT url,http_status,is_archive FROM source_copy WHERE id=$1", [input.copyId]);
    const url = input.copyId === undefined ? input.sourceUrl : copy && !copy.is_archive && (copy.http_status === null || Number(copy.http_status) < 300) ? String(copy.url) : undefined;
    if (!url) return 0;
    await query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [canonicalJson([subjectId, input.fieldPrefix])]);
    const gone = await query(`UPDATE fact f SET status='superseded',held_reason='GONE_FROM_SOURCE'
      FROM checked_fact c JOIN source_copy s ON s.id=c.source_copy_id
      WHERE f.id=c.id AND f.entity_id=$1 AND starts_with(f.field,$2) AND f.status='live' AND f.provenance_kind<>'OWNER'
      AND c.checked_at<=$5::timestamptz AND CASE WHEN $6::boolean THEN s.url=$3 ELSE starts_with(s.url,$3) END
      AND NOT (f.field=ANY($4::text[])) RETURNING f.id`,
    [subjectId, input.fieldPrefix, url, input.stillShown, input.at.toISOString(), input.copyId !== undefined]);
    if (gone.length) {
      await enqueueReaderPlaces({ entities: [subjectId] }, query);
      changed = await readerCacheScopeForEntity(query, subjectId);
      marks = await slicesOf(query, [subjectId]);
    }
    return gone.length;
  });
  if (changed) await invalidateReaderCache(changed, input.purge, null);
  await markSlices(marks);
  return count;
}

/** A fact checked on a saved line failed: this producer's live fact for the field that was never checked moves to held with the reason, and readers stop seeing it. A value Sean typed stays. */
export async function holdUnchecked(query: Query, input: { readonly entityId: string; readonly field: string; readonly producedBy: string; readonly reason: string }): Promise<boolean> {
  const held = await query(`UPDATE fact f SET status='held',held_reason=$3 FROM checked_fact c
    WHERE c.id=f.id AND f.entity_id=$1 AND f.field=$2 AND f.status='live' AND f.provenance_kind<>'OWNER' AND f.produced_by=$4 AND c.quote_start IS NULL
    RETURNING f.id`, [input.entityId, input.field, input.reason, input.producedBy]);
  return held.length > 0;
}

/**
 * A source filed a fact under the name `from` before it filed it under the current one. Once the current name's fact is verified (`verified`, fact ids)
 * the old name's live fact moves to history; where the current one failed its check (`failed`, subjects) the old one is held. A value Sean typed stays.
 */
export async function retireRenamed(db: FactDb, input: { readonly verified: readonly number[]; readonly failed: readonly string[]; readonly from: string;
  readonly producedBy: string; readonly reason: string; readonly purge?: ReaderCachePurger }): Promise<void> {
  const scopes: ReaderCacheScope[] = [];
  let marks: readonly SliceMark[] = [];
  await db.transaction(async query => {
    const moved = input.verified.length ? await query(`UPDATE fact o SET status='superseded',held_reason='RENAMED_FIELD' FROM checked_fact m
      WHERE m.id=ANY($1::bigint[]) AND m.status='live' AND m.quote_start IS NOT NULL AND o.entity_id=m.entity_id AND o.field=$2 AND o.status='live'
      AND o.provenance_kind<>'OWNER' AND o.produced_by=$3 RETURNING o.entity_id`, [input.verified, input.from, input.producedBy]) : [];
    const entities = moved.map(row => String(row.entity_id));
    for (const subject of input.failed) {
      const entityId = await resolveId(subject, query);
      if (entityId && await holdUnchecked(query, { entityId, field: input.from, producedBy: input.producedBy, reason: input.reason })) entities.push(entityId);
    }
    if (!entities.length) return;
    await enqueueReaderPlaces({ entities }, query);
    for (const id of entities) scopes.push(await readerCacheScopeForEntity(query, id));
    marks = await slicesOf(query, entities);
  });
  for (const scope of scopes) await invalidateReaderCache(scope, input.purge, null);
  await markSlices(marks);
}

// Placements: where a body belongs, and the records that follow it. Made here, inside the Slide, so no other file writes them.
const PROVENANCE_RANK = `CASE f.provenance_kind WHEN 'OWNER' THEN 0 WHEN 'OFFICIAL' THEN 1 WHEN 'FILING' THEN 1 WHEN 'REFERENCE' THEN 2 WHEN 'NEWS' THEN 3 WHEN 'CAMPAIGN' THEN 4 ELSE 5 END`;
/** Of the live facts keyed to one group the Slide's rule keeps one: the more official source, then the newer copy, then the one already on the survivor. */
const KEEP_ONE_LIVE = (keyed: string) => `WITH keyed AS (${keyed}), live AS (
  SELECT f.id, row_number() OVER (PARTITION BY k.grp ORDER BY ${PROVENANCE_RANK}, coalesce(s.fetched_at,f.checked_at) DESC, k.own DESC, f.id DESC) AS place
  FROM fact f JOIN keyed k ON k.id=f.id LEFT JOIN source_copy s ON s.id=f.source_copy_id WHERE f.status='live'
) UPDATE fact SET status='superseded' WHERE id IN (SELECT id FROM live WHERE place>1)`;
const PAIRS = "unnest($1::text[],$2::text[]) AS m(loser,survivor)";
const SEAT_FIELDS = "(VALUES ('office'),('term_start'),('term_end')) AS k(prefix)";

/**
 * Bodies that are one body become the survivor, and every id they were known by stays an alias. Facts and history, the people who
 * sat on them (their seat, term and roster keys are named for the body), places, sites, keys, meetings and open blanks all move.
 */
export async function mergeBodies(query: Query, moves: readonly { readonly loser: string; readonly survivor: string; readonly basis: string; readonly retire: boolean; readonly name?: string }[]): Promise<void> {
  if (!moves.length) return;
  const pair = [moves.map(move => move.loser), moves.map(move => move.survivor)];
  const people = await query(`SELECT DISTINCT substr(f.field,8) AS person, m.loser, m.survivor FROM ${PAIRS} JOIN fact f ON f.entity_id=m.loser AND f.field LIKE 'member:%'
    UNION SELECT x.entity_id, m.loser, m.survivor FROM ${PAIRS} JOIN entity_external_id x ON x.scheme='roster-name:'||m.loser`, pair);
  // A calendar label is never the name of the body it was a sitting of; two records of one board keep the better name.
  const labels = moves.filter(move => move.basis !== "TWIN");
  await query(`UPDATE fact SET status='superseded' FROM unnest($1::text[]) AS m(loser) WHERE fact.entity_id=m.loser AND fact.field='name' AND fact.status='live'`, [labels.map(move => move.loser)]);
  await query(KEEP_ONE_LIVE(`SELECT f.id, concat_ws(chr(1),m.survivor,f.field) AS grp, f.entity_id=m.survivor AS own FROM ${PAIRS} JOIN fact f ON f.entity_id IN (m.loser,m.survivor)`), pair);
  await query(`UPDATE fact SET entity_id=m.survivor FROM ${PAIRS} WHERE fact.entity_id=m.loser`, pair);
  if (people.length) {
    const seats = [people.map(row => String(row.person)), people.map(row => String(row.loser)), people.map(row => String(row.survivor))];
    const seat = "unnest($1::text[],$2::text[],$3::text[]) AS t(person,loser,survivor)";
    await query(KEEP_ONE_LIVE(`SELECT f.id, concat_ws(chr(1),t.person,k.prefix||':'||t.survivor) AS grp, false AS own FROM ${seat} CROSS JOIN ${SEAT_FIELDS}
      JOIN fact f ON f.entity_id=t.person AND f.field IN (k.prefix||':'||t.loser,k.prefix||':'||t.survivor)`), seats);
    await query(`UPDATE fact SET field=k.prefix||':'||t.survivor FROM ${seat}, ${SEAT_FIELDS} WHERE fact.entity_id=t.person AND fact.field=k.prefix||':'||t.loser`, seats);
  }
  await query(`DELETE FROM entity_external_id x USING ${PAIRS} WHERE x.scheme='roster-name:'||m.loser
    AND EXISTS (SELECT 1 FROM entity_external_id y WHERE y.scheme='roster-name:'||m.survivor AND y.value=x.value)`, pair);
  await query(`UPDATE entity_external_id x SET scheme='roster-name:'||m.survivor FROM ${PAIRS} WHERE x.scheme='roster-name:'||m.loser`, pair);
  await query(`INSERT INTO entity_host(entity_id,host,proved_by) SELECT m.survivor,h.host,h.proved_by FROM entity_host h JOIN ${PAIRS} ON m.loser=h.entity_id ON CONFLICT DO NOTHING`, pair);
  await query(`UPDATE entity_external_id SET entity_id=m.survivor FROM ${PAIRS} WHERE entity_id=m.loser`, pair);
  await query(`UPDATE entity SET parent_id=m.survivor FROM ${PAIRS} WHERE parent_id=m.loser`, pair);
  await query(`UPDATE blank SET entity_id=pick.survivor FROM (
    SELECT DISTINCT ON (m.survivor,b.field) m.loser,m.survivor,b.field FROM ${PAIRS} JOIN blank b ON b.entity_id=m.loser
    WHERE NOT EXISTS (SELECT 1 FROM blank held WHERE held.entity_id=m.survivor AND held.field=b.field) ORDER BY m.survivor,b.field,b.opened_at
  ) pick WHERE blank.entity_id=pick.loser AND blank.field=pick.field`, pair);
  await query("DELETE FROM blank WHERE entity_id=ANY($1::text[])", [pair[0]]);
  await query(`INSERT INTO entity_external_id(entity_id,scheme,value) SELECT m.survivor,'body-alias',m.loser FROM ${PAIRS}
    ON CONFLICT(scheme,value) DO UPDATE SET entity_id=EXCLUDED.entity_id`, pair);
  await query(`INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis)
    SELECT m.survivor,p.place_id,p.boundary_year,p.placement_basis FROM entity_place p JOIN ${PAIRS} ON m.loser=p.entity_id ON CONFLICT DO NOTHING`, pair);
  await query("UPDATE entity SET parent_id=NULL WHERE id=ANY($1::text[])", [moves.filter(move => !move.retire).map(move => move.loser)]);
  const named = moves.filter(move => move.name);
  await query("UPDATE entity e SET name=m.name FROM unnest($1::text[],$2::text[]) AS m(id,name) WHERE e.id=m.id", [named.map(move => move.survivor), named.map(move => move.name)]);
  const retired = moves.filter(move => move.retire);
  if (!retired.length) return;
  const dead = retired.map(move => move.loser);
  await foldPlacePages(query, dead, retired.map(move => move.survivor));
  await query("DELETE FROM entity_place WHERE entity_id=ANY($1::text[])", [dead]);
  await query("DELETE FROM entity_host WHERE entity_id=ANY($1::text[])", [dead]);
  await query("DELETE FROM entity WHERE id=ANY($1::text[])", [dead]);
}

/** A body hangs on the government that runs it and sits wherever that government does. */
export async function hangBodies(query: Query, moves: readonly { readonly body: string; readonly government: string }[]): Promise<void> {
  if (!moves.length) return;
  const pair = [moves.map(move => move.body), moves.map(move => move.government)];
  await query("UPDATE entity b SET parent_id=m.government FROM unnest($1::text[],$2::text[]) AS m(body,government) WHERE b.id=m.body", pair);
  await query(`INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis)
    SELECT m.body,p.place_id,p.boundary_year,p.placement_basis FROM unnest($1::text[],$2::text[]) AS m(body,government)
    JOIN entity_place p ON p.entity_id=m.government ON CONFLICT DO NOTHING`, pair);
}

/** A person placed on a government's id is placed on the place the government governs, which is where readers look. */
export async function placeOnPlaces(query: Query, state: string): Promise<readonly string[]> {
  const added = await query(`INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis)
    SELECT p.entity_id,g.parent_id,p.boundary_year,p.placement_basis FROM entity g JOIN entity_place p ON p.place_id=g.id
    JOIN entity place ON place.id=g.parent_id AND place.kind='place' WHERE g.kind='government' AND g.state=$1 ON CONFLICT DO NOTHING RETURNING entity_id`, [state]);
  await query(`DELETE FROM entity_place p USING entity g WHERE g.id=p.place_id AND g.kind='government' AND g.state=$1 AND EXISTS (
    SELECT 1 FROM entity_place q WHERE q.entity_id=p.entity_id AND q.place_id=g.parent_id AND q.boundary_year=p.boundary_year)`, [state]);
  return added.map(row => String(row.entity_id));
}


/** The placement questions that are due, each held for the agent for half an hour. */
export async function claimPlacementBlanks(query: Query, n: number): Promise<readonly Record<string, unknown>[]> {
  return query(`UPDATE blank SET next_try_at=now()+interval '30 minutes',attempts=attempts+1 WHERE (entity_id,field) IN (
      SELECT entity_id,field FROM blank WHERE reason='PLACEMENT_QUESTION' AND next_try_at<=now() ORDER BY next_try_at LIMIT $1 FOR UPDATE SKIP LOCKED)
    RETURNING entity_id,field,detail`, [n]);
}

/** A question the agent has answered is closed; the page it quoted stays with the body it placed. */
export async function closePlacementQuestion(query: Query, subject: string, field: string, source: { readonly holder: string; readonly cite: string } | null): Promise<void> {
  await query("DELETE FROM blank WHERE entity_id=$1 AND field=$2 AND reason='PLACEMENT_QUESTION'", [subject, field]);
  if (source) await query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES($1,'placement-source',$2) ON CONFLICT DO NOTHING", [source.holder, source.cite]);
}
