import { checkFact, isOfficialUrl, type CheckEntity, type Claim, type Provenance } from "../facts/check.ts";
import { canonicalJson } from "../control-plane/repository/types.ts";
import { enqueueReaderPlaces, invalidateReaderCache, placePageConsumesFact, readerCacheScopeForEntity, type ReaderCachePurger, type ReaderCacheScope } from "../reader/cache.ts";
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
import { stateName } from "../facts/entity-read.ts";
import type { SavedCopy } from "../facts/check.ts";
import { ID_ALIAS } from "./ids.ts";

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

export const rank: Readonly<Record<Provenance, number>> = { OWNER: 0, OFFICIAL: 1, FILING: 1, REFERENCE: 2, NEWS: 3, CAMPAIGN: 4, OTHER: 5 };
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

export function officialSource(url: string, hosts: readonly string[], linkingPage?: OfficialLinkingPage | null): boolean {
  return isOfficialUrl(url, hosts) || isSourceApiUrl(url) || isOfficialSource(url, linkingPage)
    || !!linkingPage && officialSource(linkingPage.url, hosts, linkingPage.linkingPage) && pageLinksSource(url, linkingPage);
}

/** Newer and more official wins; a value Sean typed changes only through him. */
export function decide(current: Side | null, incoming: Side, field?: string): Decision {
  if (current === null) return "PUBLISH";
  if (canonicalJson(current.value) === canonicalJson(incoming.value)) return "CONFIRM";
  return decideDifferent(current, incoming, field);
}

export function decideDifferent(current: Side, incoming: Side, field?: string): Decision {
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
    // A filing or a money claim is always checked against the line it quotes, whatever its host.
    const fast = loaded && acquisition === "loader" && input.provenance !== "FILING" && input.fieldKind !== "money";
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
      : fast || provenance === "OWNER" ? { ok: true as const, quoteStart: null } : checkFact(c, now, clocks.windowHours);
    if (!verdict.ok) {
      return { refused: verdict.reason };
    }
    const [placement] = await query("SELECT parent_id FROM entity WHERE id=$1",[entity.id]);
    const filed=await fileEntityPlaces(query,entity.id,input.places ?? [],placement?.parent_id as string | null,[],placePageConsumesFact(c.field));
    if(filed.moved) {
      changed=await readerCacheScopeForEntity(query,entity.id);
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
      if (placePageConsumesFact(c.field)) await enqueueReaderPlaces({ entities: [entity.id] }, query);
      changed = await readerCacheScopeForEntity(query, c.entity.id);
    }
    return { decision, factId };
  });
  if (confirmation) await confirmFactSource(db,confirmation,options.purge);
  if (changed) await invalidateReaderCache(changed, options.purge, null);
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
    }
    return gone.length;
  });
  if (changed) await invalidateReaderCache(changed, input.purge, null);
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
  });
  for (const scope of scopes) await invalidateReaderCache(scope, input.purge, null);
}

/** One election result fact the Slide wants written, exactly as `publishValue` used to hand it to the door. */
export interface ResultWrite {
  readonly id: string; readonly kind: "contest" | "candidacy" | "measure" | "place"; readonly name: string; readonly parentId: string | null;
  readonly state: string | null; readonly aliasScheme: string; readonly sourceId: string;
  readonly field: string; readonly value: Record<string, unknown>; readonly quotes: readonly string[];
}
export type ResultWriteOutcome = { readonly decision: Decision } | { readonly blank: string };

const CHUNK = 400;
const row = (value: unknown) => value as Record<string, unknown>;

/**
 * Many result facts in a handful of set-based statements. Every fact is still checked against the saved page in memory by the same
 * `checkFact` the door uses; a fact that is new or changed is written together with the rest, a repeat is only confirmed, and anything
 * the fast path does not cover (a failed check, a held value, a value Sean owns) goes through the ordinary door one fact at a time.
 */
export async function doorMany(db: FactDb, writes: readonly ResultWrite[], copy: SavedCopy, clocks: Clocks, now: Date,
  purge?: ReaderCachePurger): Promise<{ readonly outcomes: ResultWriteOutcome[]; readonly slow: readonly number[] }> {
  const outcomes: ResultWriteOutcome[] = new Array(writes.length);
  const slow: number[] = [], confirmations: FactConfirmation["receipts"] & Record<string, unknown> = {}, confirmedIds: number[] = [];
  const touchedStates = new Set<string>();
  for (let from = 0; from < writes.length; from += CHUNK) {
    const part = writes.slice(from, from + CHUNK).map((write, offset) => ({ write, index: from + offset }));
    await db.transaction(async query => {
      // Identity: a retired id resolves to its surviving entity, as `canonicalEntityId` does.
      const aliases = await query(`SELECT value, entity_id FROM entity_external_id WHERE scheme='${ID_ALIAS}' AND value=ANY($1::text[])`,
        [part.map(item => item.write.id)]);
      const canonical = new Map(aliases.map(alias => [String(alias.value), String(alias.entity_id)]));
      const items = part.map(item => ({ ...item, id: canonical.get(item.write.id) ?? item.write.id }));
      // One row per entity (the first write names it); one alias per entity and source.
      const entities = new Map<string, (typeof items)[number]>();
      for (const item of items) if (!entities.has(item.id)) entities.set(item.id, item);
      const named = [...entities.values()];
      await query(`INSERT INTO entity (id, kind, name, state, parent_id)
        SELECT n.id, n.kind, n.name, n.state, (SELECT id FROM entity WHERE id = coalesce(
          (SELECT entity_id FROM entity_external_id WHERE scheme = '${ID_ALIAS}' AND value = n.parent_id), n.parent_id))
        FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[]) AS n(id, kind, name, state, parent_id)
        ON CONFLICT (id) DO NOTHING`,
      [named.map(item => item.id), named.map(item => item.write.kind), named.map(item => item.write.name),
        named.map(item => item.write.state), named.map(item => item.write.parentId)]);
      const aliasRows = new Map<string, (typeof items)[number]>();
      for (const item of items) aliasRows.set(`${item.write.aliasScheme}\u0000${item.write.sourceId}`, item);
      const aliasList = [...aliasRows.entries()].map(([key, item]) => ({ scheme: key.split("\u0000")[0], value: item.write.sourceId, id: item.id }));
      const placed = await query(`INSERT INTO entity_external_id(entity_id,scheme,value)
        SELECT * FROM unnest($1::text[], $2::text[], $3::text[]) ON CONFLICT(scheme,value) DO UPDATE SET value=EXCLUDED.value RETURNING entity_id,scheme,value`,
      [aliasList.map(a => a.id), aliasList.map(a => a.scheme), aliasList.map(a => a.value)]);
      const owner = new Map(placed.map(r => [`${row(r).scheme}\u0000${row(r).value}`, String(row(r).entity_id)]));
      for (const a of aliasList) if (owner.get(`${a.scheme}\u0000${a.value}`) !== a.id) throw new Error("SOURCE_IDENTITY_CONFLICT");
      // The same saved-copy read the door makes, for every entity at once.
      const known = await query(`SELECT e.id, e.name, e.state,
          coalesce((SELECT array_agg(v) FROM (SELECT f.value #>> '{}' AS v FROM fact f WHERE f.entity_id=e.id AND f.field='name' AND f.status='live'
            UNION SELECT f.value_text FROM fact f WHERE f.entity_id=e.id AND f.field='name' AND f.status='live') n WHERE v IS NOT NULL),'{}') AS names,
          coalesce((SELECT array_agg(value) FROM entity_external_id WHERE entity_id = e.id AND scheme NOT LIKE 'roster-%' AND scheme <> '${ID_ALIAS}'), '{}') AS ids
        FROM entity e WHERE e.id=ANY($1::text[])`, [named.map(item => item.id)]);
      const checked = new Map(known.map(r => [String(row(r).id), { id: String(row(r).id), fullName: String(row(r).name), names: (row(r).names as string[]) ?? [],
        stateName: stateName(row(r).state as string | null), hosts: [] as string[], externalIds: (row(r).ids as string[]) ?? [] } satisfies CheckEntity]));
      // Serialize writers of the same fact, in a fixed order so two writers cannot wait on each other.
      const keys = [...new Set(items.map(item => canonicalJson([item.id, item.write.field])))].sort();
      await query("SELECT pg_advisory_xact_lock(hashtextextended(k, 0)) FROM unnest($1::text[]) AS k ORDER BY k", [keys]);
      const claims = items.map(item => {
        const { write } = item;
        const derived = write.quotes.map((quote, i) => ({ quote, text: i === 0 ? canonicalJson(write.value) : "" }));
        return { item, derived, valueText: derived.map(part => part.text).join(" "), quote: write.quotes.join("\n") };
      });
      const heads = await query(`SELECT p.i::int AS i, f.id, md5(f.value::text)=md5(p.v::jsonb::text) AS same_value, f.value_text=p.vt AS same_text, f.quote=p.q AS same_quote,
          f.second_copy_id, f.provenance_kind, f.status, f.held_reason, f.source_copy_id, f.checked_at, coalesce(s.fetched_at,f.checked_at) AS fetched_at
        FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[]) WITH ORDINALITY AS p(e, fl, v, vt, q, i)
        CROSS JOIN LATERAL (SELECT id FROM fact WHERE entity_id = p.e AND field = p.fl ORDER BY (status = 'live') DESC, id DESC LIMIT 1 FOR UPDATE) head
        JOIN checked_fact f ON f.id = head.id LEFT JOIN source_copy s ON s.id = f.source_copy_id`,
      [claims.map(c => c.item.id), claims.map(c => c.item.write.field), claims.map(c => JSON.stringify(c.item.write.value)),
        claims.map(c => c.valueText), claims.map(c => c.quote)]);
      const headOf = new Map(heads.map(h => [Number(row(h).i) - 1, row(h)]));
      const confirmedThisChunk = new Set<number>();
      const publish: { claim: (typeof claims)[number]; quoteStart: number | null; old: number | null }[] = [];
      const official = officialSource(copy.finalUrl, [], undefined);
      const provenance = official ? "OFFICIAL" as const : "REFERENCE" as const;
      claims.forEach((claim, i) => {
        const entity = checked.get(claim.item.id);
        const head = headOf.get(i), live = head?.status === "live" ? head : undefined;
        if (!entity) { slow.push(claim.item.index); return; }
        const repeated = live && Number(live.source_copy_id) === copy.id && (live.provenance_kind === provenance || live.provenance_kind === "REFERENCE")
          && copy.fetchedAt.getTime() <= Math.max(new Date(live.fetched_at as string).getTime(), new Date(live.checked_at as string).getTime())
          && live.same_quote && live.same_text && live.second_copy_id == null && live.same_value;
        if (repeated) { outcomes[claim.item.index] = { decision: "CONFIRM" }; return; }
        const c: PublishInput = { entity, fieldKind: "ballot", provenance, valueText: claim.valueText, quote: claim.quote, derived: claim.derived,
          copy, field: claim.item.write.field, value: claim.item.write.value, acquisition: "checked", producedBy: "election-results", costUsd: 0 };
        const verdict = checkFact(c, now, clocks.windowHours);
        // A failed check opens its blank through the door; nothing about it is decided here.
        if (!verdict.ok) { slow.push(claim.item.index); return; }
        if (!live) {
          if (head?.held_reason === "OWNER_REMOVED" && head.same_value) { slow.push(claim.item.index); return; }
          publish.push({ claim, quoteStart: verdict.quoteStart, old: null }); return;
        }
        if (live.same_value) {
          if (live.provenance_kind !== "OWNER" && rank[provenance] <= rank[live.provenance_kind as keyof typeof rank]
            && (rank[provenance] < rank[live.provenance_kind as keyof typeof rank] || copy.fetchedAt > new Date(live.fetched_at as string))) {
            confirmedIds.push(Number(live.id)); confirmedThisChunk.add(claim.item.index);
            confirmations[String(live.id)] = { quote: claim.quote, quote_start: verdict.quoteStart, second_copy_id: null,
              provenance_kind: provenance, value_text: claim.valueText };
          }
          outcomes[claim.item.index] = { decision: "CONFIRM" };
          return;
        }
        const decision = decideDifferent({ value: live.value, provenance: live.provenance_kind as never, fetchedAt: new Date(live.fetched_at as string), sourceUrl: "" },
          { value: claim.item.write.value, provenance, fetchedAt: copy.fetchedAt }, claim.item.write.field);
        if (decision === "PUBLISH") publish.push({ claim, quoteStart: verdict.quoteStart, old: Number(live.id) });
        else slow.push(claim.item.index);
      });
      if (publish.length) {
        const old = publish.flatMap(p => p.old === null ? [] : [p.old]);
        if (old.length) await query("UPDATE fact SET status = 'superseded' WHERE id = ANY($1::bigint[])", [old]);
        await query(`INSERT INTO fact (entity_id, field, value, value_text, status, provenance_kind, source_copy_id, quote, quote_start, second_copy_id,
            checked_at, live_at, held_reason, produced_by, cost_usd)
          SELECT e, fl, v::jsonb, vt, 'live', $6, $7, q, qs, NULL, $8::timestamptz, $8::timestamptz, NULL, 'election-results', 0
          FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $9::int[]) AS n(e, fl, v, vt, q, qs)`,
        [publish.map(p => p.claim.item.id), publish.map(p => p.claim.item.write.field), publish.map(p => JSON.stringify(p.claim.item.write.value)),
          publish.map(p => p.claim.valueText), publish.map(p => p.claim.quote), provenance, copy.id, now.toISOString(), publish.map(p => p.quoteStart)]);
        for (const p of publish) outcomes[p.claim.item.index] = { decision: "PUBLISH" };
      }
      const cleared = [...publish.map(p => p.claim.item), ...claims.filter(c => confirmedThisChunk.has(c.item.index)).map(c => c.item)];
      if (cleared.length) await query(`DELETE FROM blank b USING unnest($1::text[], $2::text[]) f(entity_id, field) WHERE b.entity_id = f.entity_id AND b.field = f.field`,
        [cleared.map(item => item.id), cleared.map(item => item.write.field)]);
      for (const item of items) touchedStates.add(item.write.state ?? "US");
    });
  }
  if (confirmedIds.length) await confirmFactSource(db, { copyId: copy.id, scope: "door:election-results", at: now.toISOString(), factIds: confirmedIds, receipts: confirmations }, purge);
  // One purge per state touched, after the commit (the old door purged after every fact).
  for (const state of touchedStates) {
    const place = state === "US" ? "ocd-division/country:us" : `ocd-division/country:us/state:${state.toLowerCase()}`;
    const scope = await db.transaction(query => readerCacheScopeForEntity(query, place)).catch(() => null);
    if (scope) await invalidateReaderCache(scope, purge, null);
  }
  return { outcomes, slow };
}
