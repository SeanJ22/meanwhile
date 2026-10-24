import { checkFact, isOfficialUrl, type CheckEntity, type Claim, type Provenance } from "../facts/check.ts";
import { canonicalJson } from "../control-plane/repository/types.ts";
import { invalidateReaderCache, readerCacheScopeForEntity, type ReaderCachePurger, type ReaderCacheScope } from "../reader/cache.ts";
import { bodyNamed, canonicalSubject, ensureEntity, governmentAt, placeBody, splitSubject, type BodyRef } from "../facts/entities.ts";
import { readCheckEntity } from "../facts/entity-read.ts";
import type { FactDb, Query, PublishInput, Clocks } from "../facts/publish.ts";
import { isSourceApiUrl } from "../control-plane/scheduler/scout-api.ts";
import { isOfficialSource, type OfficialLinkingPage } from "../civic-data/source-authority.ts";
import { saveCaptureCopy } from "../facts/source-copy.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { resolveId } from "./resolve.ts";

export type Decision = "PUBLISH" | "CONFIRM" | "KEEP_CURRENT" | "FLAG_OWNER";

interface Side { readonly value: unknown; readonly provenance: Provenance; readonly fetchedAt: Date }

export type DoorInput = Omit<PublishInput, "entity"> & (
  { readonly entity: CheckEntity; readonly subjectId?: string }
  | { readonly entity?: undefined; readonly subjectId: string }
) & {
  readonly linkingPage?: OfficialLinkingPage | null;
  readonly capture?: WorkerPublicationCapture;
  /** A loader's parsed source record: use the publisher's field without a quote search. */
  readonly sourceField?: { readonly record: Readonly<Record<string, unknown>>; readonly key: string };
  /** A board named by the government's own source, when it has no entity yet. */
  readonly board?: { readonly governmentId: string; readonly name: string };
};
export type DoorOutcome = { readonly decision: Decision; readonly factId: number | null } | { readonly refused: string };
interface DoorOptions {
  readonly purge?: ReaderCachePurger;
  readonly refusal?: (claim: PublishInput, reason: string) => Promise<void>;
}

const rank: Readonly<Record<Provenance, number>> = { OWNER: 0, OFFICIAL: 1, FILING: 1, REFERENCE: 2, NEWS: 3, CAMPAIGN: 4, OTHER: 5 };

/** Newer and more official wins; a value Sean typed changes only through him. */
export function decide(current: Side | null, incoming: Side): Decision {
  if (current === null) return "PUBLISH";
  if (canonicalJson(current.value) === canonicalJson(incoming.value)) return "CONFIRM";
  if (incoming.provenance === "OWNER") return "PUBLISH";
  if (current.provenance === "OWNER") return "FLAG_OWNER";
  if (rank[current.provenance] !== rank[incoming.provenance]) return rank[incoming.provenance] < rank[current.provenance] ? "PUBLISH" : "KEEP_CURRENT";
  return incoming.fetchedAt > current.fetchedAt ? "PUBLISH" : "KEEP_CURRENT";
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
  const [held] = await query("SELECT id, name, state, parent_id FROM entity WHERE kind = 'body' AND parent_id = $1 AND (id LIKE '%#governing' OR id LIKE '%#board') ORDER BY id LIMIT 1", [government.id]);
  if (held) {
    if (String(held.name).endsWith(" governing")) {
      await query("UPDATE entity SET name=$2 WHERE id=$1 AND name=$3", [held.id, name, held.name]);
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
  let refusedClaim: PublishInput | undefined;
  const outcome = await db.transaction<DoorOutcome>(async (query) => {
    const requested = input.subjectId ?? input.entity!.id;
    const subjectId = await resolveId(requested, query) ?? await canonicalSubject(query, requested);
    let entity = await readCheckEntity(query, subjectId);
    const sourceUrl = input.capture?.evidence.canonicalUrl ?? input.copy.finalUrl;
    const government = input.board ? await readCheckEntity(query,
      await resolveId(input.board.governmentId, query) ?? await canonicalSubject(query, input.board.governmentId)) : null;
    if (input.board && government && isOfficialUrl(sourceUrl, government.hosts)) {
      const body = await bodyNamed(query, government.id, null, input.board.name);
      if (body) entity = await readCheckEntity(query, body.id);
    }
    if (!entity && ["#governing", "#board"].includes(splitSubject(subjectId).tail) && isOfficialUrl(sourceUrl, [])) {
      const body = await ensureGoverningBody(query, subjectId);
      if (body) entity = await readCheckEntity(query, body.id);
    }
    if (!entity) {
      refusedClaim = { ...input, entity: input.entity ?? { id: requested, fullName: requested, stateName: null, hosts: [], externalIds: [] } };
      return { refused: "SUBJECT_NOT_FOUND" };
    }
    const copy = input.capture ? await saveCaptureCopy(query, input.capture) : input.copy;
    const official = isOfficialUrl(copy.finalUrl, entity.hosts) || isSourceApiUrl(copy.finalUrl)
      || isOfficialSource(copy.finalUrl, input.linkingPage);
    const acquisition = input.acquisition ?? (input.producedBy === "box" ? "hunter" : input.producedBy.startsWith("carton:") ? "walker" : "loader");
    const fast = official && acquisition === "loader";
    const provenance = input.provenance === "OWNER" ? "OWNER" : official ? input.provenance === "FILING" ? "FILING" : "OFFICIAL" : input.provenance;
    const value = fast && input.sourceField ? input.sourceField.record[input.sourceField.key] : input.value;
    const valueText = fast && input.sourceField ? typeof value === "string" ? value : canonicalJson(value) : input.valueText;
    const c: PublishInput = { ...input, entity, provenance, copy, value, valueText };
    const campaignSelf = c.provenance !== "CAMPAIGN" || c.sourceSubjectId !== undefined
      && await resolveId(c.sourceSubjectId, query) === entity.id;
    // Also serialize the first value for a field, before there is a head row to lock.
    await query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [canonicalJson([entity.id, c.field])]);
    // Scope first: a sparse live-status index can otherwise scan every published fact for one claim.
    const [head] = await query(`WITH head AS MATERIALIZED (
      SELECT id FROM fact WHERE entity_id = $1 AND field = $2
      ORDER BY (status = 'live') DESC, id DESC LIMIT 1 FOR UPDATE
    ), own AS MATERIALIZED (
      SELECT id, value, value_text, quote, second_copy_id, provenance_kind, source_copy_id, checked_at, status, held_reason FROM fact WHERE id = (SELECT id FROM head)
    ) SELECT f.id, f.value, f.value_text, f.quote, f.second_copy_id, f.provenance_kind, f.status, f.held_reason, f.source_copy_id, f.checked_at,
      coalesce(s.fetched_at,f.checked_at) AS fetched_at,s.final_url AS source_url
      FROM own f LEFT JOIN source_copy s ON s.id=f.source_copy_id`, [c.entity.id, c.field]);
    const row = head?.status === "live" ? head : undefined;
    // Replaying an already checked source is a no-op, including after its freshness window.
    // It does not refresh the checked date, publish a value, or count another delivery.
    if (campaignSelf && row && Number(row.source_copy_id) === c.copy.id && (row.provenance_kind === c.provenance || row.provenance_kind === input.provenance)
      && c.copy.fetchedAt.getTime() <= Math.max(new Date(row.fetched_at as string).getTime(), new Date(row.checked_at as string).getTime())
      && row.quote === c.quote && row.value_text === c.valueText && (row.second_copy_id === null ? null : Number(row.second_copy_id)) === (c.second?.copy.id ?? null)
      && canonicalJson(row.value) === canonicalJson(c.value)) return { decision: "CONFIRM", factId: Number(row.id) };
    const verdict = !campaignSelf ? { ok: false as const, reason: "CAMPAIGN_OTHER_SUBJECT" }
      : fast || provenance === "OWNER" ? { ok: true as const, quoteStart: null } : checkFact(c, now, clocks.windowHours);
    if (!verdict.ok) {
      refusedClaim = c;
      return { refused: verdict.reason };
    }
    // Sean removed this value; the same words from a source do not put it back, a different value does.
    if (!row && head?.held_reason === "OWNER_REMOVED" && canonicalJson(head.value) === canonicalJson(c.value)) return { decision: "KEEP_CURRENT", factId: null };
    const currentProvenance = row?.provenance_kind === "OWNER" || row?.provenance_kind === "FILING" ? row.provenance_kind
      : row?.source_url && (isOfficialUrl(String(row.source_url),entity.hosts) || isSourceApiUrl(String(row.source_url))) ? "OFFICIAL" : row?.provenance_kind;
    const decision = decide(row ? { value: row.value, provenance: currentProvenance as Claim["provenance"], fetchedAt: new Date(row.fetched_at as string) } : null,
      { value: c.value, provenance: c.provenance, fetchedAt: c.copy.fetchedAt });
    if (decision === "CONFIRM") {
      if (row!.provenance_kind !== "OWNER" && rank[c.provenance] <= rank[row!.provenance_kind as Provenance]
        && (rank[c.provenance] < rank[row!.provenance_kind as Provenance] || c.copy.fetchedAt > new Date(row!.fetched_at as string))) {
        await query(`UPDATE fact SET checked_at=$2,source_copy_id=$3,quote=$4,quote_start=$5,second_copy_id=$6,provenance_kind=$7,value_text=$8 WHERE id=$1`,
        [row!.id,now.toISOString(),c.copy.id,c.quote,verdict.quoteStart,c.second?.copy.id ?? null,c.provenance,c.valueText]);
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
      await filePublication(query, entity.id, fast ? "door_official" : "door_checked", now);
      changed = await readerCacheScopeForEntity(query, c.entity.id);
    }
    return { decision, factId };
  });
  // The work list can be on another database. Release the fact transaction before handing off a refusal.
  if ("refused" in outcome && refusedClaim) await options.refusal?.(refusedClaim, outcome.refused);
  if (changed) await invalidateReaderCache(changed, options.purge);
  return outcome;
}

/** Existing subject-to-place links keep serving readers until RB-A4 supplies the full service map. */
async function filePublication(query: Query, entityId: string, step: string, now: Date): Promise<void> {
  const places = await query(`WITH RECURSIVE subjects AS (
      SELECT id,kind,state,parent_id,ARRAY[id] AS path FROM entity WHERE id=$1
      UNION ALL SELECT e.id,e.kind,e.state,e.parent_id,s.path || e.id FROM entity e JOIN subjects s ON e.id=s.parent_id
        WHERE NOT e.id=ANY(s.path)
    ), places AS (
      SELECT ep.place_id AS id FROM entity_place ep JOIN subjects s ON ep.entity_id=s.id
      UNION SELECT id FROM subjects WHERE kind='place'
    ) SELECT e.id,e.state FROM places p JOIN entity e ON e.id=p.id`, [entityId]);
  if (places.length) await query(`INSERT INTO rebuild_queue(place_id,queued_at)
    SELECT place_id,$2::timestamptz FROM unnest($1::text[]) AS place_id ON CONFLICT(place_id) DO NOTHING`,
  [places.map(place => place.id), now.toISOString()]);
  const [subject] = await query("SELECT state FROM entity WHERE id=$1", [entityId]);
  const states = [...new Set([...places.map(place => place.state), subject?.state]
    .flatMap(state => state && state !== "US" ? [String(state).toUpperCase()] : []))];
  await query(`INSERT INTO count_hour(state,hour,step,n)
    SELECT state,date_trunc('hour',$2::timestamptz),$3,1 FROM unnest($1::text[]) AS state
    ON CONFLICT(state,hour,step) DO UPDATE SET n=count_hour.n+1`,
  [states.length ? states : ["US"], now.toISOString(), step]);
}
