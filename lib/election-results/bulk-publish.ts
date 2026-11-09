import { canonicalJson } from "../control-plane/repository/types.ts";
import { checkFact, type CheckEntity } from "../facts/check.ts";
import type { SavedCopy } from "../facts/check.ts";
import { confirmFactSource, type FactConfirmation } from "../facts/confirmation.ts";
import { stateName } from "../facts/entity-read.ts";
import { publishClaim, type FactDb, type PublishInput } from "../facts/publish.ts";
import { decideDifferent, officialSource, rank, type Decision } from "../core/door.ts";
import { ID_ALIAS } from "../core/ids.ts";
import { invalidateReaderCache, readerCacheScopeForEntity, type ReaderCachePurger } from "../reader/cache.ts";
import type { Clocks } from "../facts/publish.ts";

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
export async function publishResultWrites(db: FactDb, writes: readonly ResultWrite[], copy: SavedCopy, clocks: Clocks, now: Date,
  purge?: ReaderCachePurger): Promise<ResultWriteOutcome[]> {
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
  for (const index of slow) {
    const write = writes[index], derived = write.quotes.map((quote, i) => ({ quote, text: i === 0 ? canonicalJson(write.value) : "" }));
    const outcome = await publishClaim(db, {
      entity: { id: write.id, fullName: write.name, stateName: null, hosts: [], externalIds: [] },
      field: write.field, fieldKind: "ballot", provenance: "REFERENCE", value: write.value, valueText: derived.map(part => part.text).join(" "),
      quote: write.quotes.join("\n"), derived, copy, acquisition: "checked", producedBy: "election-results", costUsd: 0,
    }, clocks, now, { purge });
    outcomes[index] = "blank" in outcome ? { blank: outcome.blank } : { decision: outcome.decision };
  }
  return outcomes;
}
