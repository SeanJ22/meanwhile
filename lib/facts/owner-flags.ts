import type { LiveFact, LiveAuditResult } from "../control-plane/workers/live-audit.ts";
import { invalidateReaderCache, readerCacheScopeForEntity, type ReaderCachePurger } from "../reader/cache.ts";
import type { FactDb, Query } from "./publish.ts";
import { createHash } from "node:crypto";
import { publishOwnerChoice, readOwnerChoicesFromEdge } from "./owner-choices-edge.ts";

export const FLAG_CHOICES = ["REMOVE", "KEEP", "SEND_FLEET", "TYPED_VALUE"] as const;
export type FlagChoice = typeof FLAG_CHOICES[number];

/** The flag holds what was challenged, so an owner action never targets an unrelated replacement. */
export async function flagReaderRecord(query: Query, fact: LiveFact, result: Pick<LiveAuditResult,"reason">): Promise<void> {
  if (fact.family === "fact-store") {
    await query(`INSERT INTO owner_flag(fact_id,kind,reason,source_url) SELECT $1,'AUDIT_LOOKS_WRONG',$2,$3
      WHERE EXISTS(SELECT 1 FROM fact WHERE id=$1 AND status='live')
      AND NOT EXISTS(SELECT 1 FROM owner_flag WHERE fact_id=$1 AND resolved IS NULL)`,[Number(fact.record.id),result.reason,fact.sourceUrl]);
    return;
  }
  await query(`INSERT INTO owner_flag (kind,reader_family,reader_id,observed_value,reason,source_url)
    SELECT 'AUDIT_LOOKS_WRONG',$1,$2,$3::jsonb,$4,$5 WHERE NOT EXISTS
    (SELECT 1 FROM owner_flag WHERE reader_family=$1 AND reader_id=$2 AND resolved IS NULL)`,
  [fact.family, String(fact.record.id), JSON.stringify(fact.record), result.reason, fact.sourceUrl]);
}

export interface OwnerFlag {
  readonly id: string;
  readonly factId: number | null;
  readonly family: string | null;
  readonly readerId: string | null;
  readonly entityId: string | null;
  readonly title: string;
  readonly field: string | null;
  readonly value: unknown;
  readonly reason: string;
  readonly sourceUrl: string | null;
}

export async function readOwnerFlags(query: Query, after: number = 0, limit: number = 50): Promise<OwnerFlag[]> {
  const rows = await query(`SELECT o.id,o.fact_id,o.reader_family,o.reader_id,o.observed_value,o.reason,o.source_url,
    f.entity_id,f.field,f.value,e.name,s.url FROM owner_flag o LEFT JOIN fact f ON f.id=o.fact_id
    LEFT JOIN entity e ON e.id=f.entity_id LEFT JOIN source_copy s ON s.id=f.source_copy_id
    WHERE o.resolved IS NULL AND o.id>$1 ORDER BY o.id LIMIT $2`, [after, Math.min(100, Math.max(1, limit))]);
  return rows.map(row => ({ id: String(row.id), factId: row.fact_id === null ? null : Number(row.fact_id),
    family: row.reader_family as string | null, readerId: row.reader_id as string | null, entityId: row.entity_id as string | null,
    title: row.name ? String(row.name) : "Published public information", field: row.field as string | null,
    value: row.fact_id === null ? row.observed_value : row.value,
    reason: String(row.reason ?? "The published value needs to be checked against its source."),
    sourceUrl: (row.source_url ?? row.url ?? null) as string | null }));
}

/** Patch only existing scalar fields; neither paths nor values can change record identity. */
export function withOwnerValues(record: Readonly<Record<string, unknown>>, values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out = structuredClone(record) as Record<string, unknown>;
  for (const [path, value] of Object.entries(values)) {
    const parts = path.split(".");
    if (parts.length > 2 || parts.some(part => !/^[a-zA-Z][a-zA-Z0-9]*$/.test(part)) ||
        /(?:^|\.)(?:id|kind|bodyId|ocdId|officeholderId|fieldSources|provenance|verification)$/.test(path)) throw new Error("Choose a published value to correct.");
    let target = out;
    if (parts.length === 2) {
      const child = target[parts[0]];
      if (!child || typeof child !== "object" || Array.isArray(child)) throw new Error("That field is not on this record.");
      target = child as Record<string, unknown>;
    }
    const key = parts.at(-1)!;
    if (!Object.hasOwn(target, key) || !["string", "number", "boolean"].includes(typeof value) ||
        (typeof value === "string" && value.length > 10_000) || (typeof value === "number" && !Number.isFinite(value))) throw new Error("Enter the right value for an existing field.");
    target[key] = value;
  }
  return out;
}

/** Sean's decisions are read by the same reader that serves these records. */
export async function readerRecordsWithOwnerChoices<T extends { readonly id: string }>(query: Query | null, family: string, records: readonly T[]): Promise<T[]> {
  if (!records.length) return [];
  const edge = await readOwnerChoicesFromEdge(family,records);
  if (!query && edge===null) return [...records];
  const rows = edge===null ? await query!(`SELECT DISTINCT ON (reader_id) reader_id,resolved,owner_values,owner_source_url,resolved_at
    FROM owner_flag WHERE reader_family=$1 AND reader_id=ANY($2::text[]) AND resolved IN ('REMOVE','TYPED_VALUE')
    ORDER BY reader_id,resolved_at DESC,id DESC`, [family, records.map(record => record.id)]) : [...edge].map(([id,choice])=>({reader_id:id,resolved:choice.choice,
      owner_values:choice.values,owner_source_url:choice.sourceUrl,resolved_at:choice.resolvedAt}));
  const choices = new Map(rows.map(row => [String(row.reader_id), row]));
  return records.flatMap(record => {
    const choice = choices.get(record.id);
    if (choice?.resolved === "REMOVE") return [];
    if (choice?.resolved !== "TYPED_VALUE") return [record];
    const values = choice.owner_values as Record<string, unknown>;
    const patched = withOwnerValues(record as T & Record<string, unknown>, values);
    const at = new Date(choice.resolved_at as string).toISOString();
    patched.fieldSources = { ...(patched.fieldSources as object ?? {}), ...Object.fromEntries(Object.keys(values).map(field => [field,
      { sourceUrl: choice.owner_source_url ?? "", sourceOrg: "Sean", collectedAt: at, verifiedAt: at, provenance: "OWNER" }])) };
    return [patched as T];
  });
}

export async function resolveOwnerFlag(db: FactDb & { readonly query: Query }, input: {
  readonly id: number; readonly choice: FlagChoice; readonly values?: Readonly<Record<string, unknown>>; readonly sourceUrl?: string | null;
}, now: string, purge?: ReaderCachePurger): Promise<{ readonly factId: number | null; readonly entityId: string | null; readonly readerId: string | null; readonly family: string | null; readonly detail: string }> {
  const outcome = await db.transaction(async query => {
    const [flag] = await query(`SELECT o.*,f.entity_id,f.field,f.value,f.status FROM owner_flag o
      LEFT JOIN fact f ON f.id=o.fact_id WHERE o.id=$1 FOR UPDATE OF o`, [input.id]);
    if (!flag || flag.resolved) throw new Error("This flag has already been answered. Refresh the list.");
    const original = flag.fact_id === null ? flag.observed_value : flag.value;
    let ownerValues=input.values;
    if (input.choice === "TYPED_VALUE") {
      if (!input.values || !Object.keys(input.values).length) throw new Error("Enter the right value.");
      if (flag.fact_id === null) {
        const [previous]=await query(`SELECT owner_values FROM owner_flag WHERE reader_family=$1 AND reader_id=$2 AND resolved='TYPED_VALUE'
          ORDER BY resolved_at DESC,id DESC LIMIT 1`,[flag.reader_family,flag.reader_id]);
        ownerValues={...(previous?.owner_values as object ?? {}),...input.values};
        withOwnerValues(original as Record<string, unknown>,ownerValues);
      }
      else {
        if (Object.keys(input.values).some(field=>field !== "value" && !field.startsWith("value."))) throw new Error("Choose this fact's value to correct.");
        withOwnerValues({value:original},input.values);
      }
    }
    if (flag.fact_id !== null && ["REMOVE", "TYPED_VALUE"].includes(input.choice)) {
      const [live] = await query("SELECT id FROM fact WHERE entity_id=$1 AND field=$2 AND status='live' FOR UPDATE", [flag.entity_id, flag.field]);
      if (!live || Number(live.id) !== Number(flag.fact_id)) throw new Error("The published value changed. Refresh before answering this flag.");
      await query("UPDATE fact SET status=$2,held_reason=$3 WHERE id=$1", [flag.fact_id, input.choice === "REMOVE" ? "pulled" : "superseded",
        input.choice === "REMOVE" ? "OWNER_REMOVED" : null]);
      if (input.choice === "TYPED_VALUE") {
        const value = withOwnerValues({value:original},input.values!).value;
        let copyId: unknown = null;
        if (input.sourceUrl) {
          const [copy] = await query(`INSERT INTO source_copy(url,final_url,fetched_at,sha256,blob_key)
            VALUES($1,$1,$2,$3,$4) RETURNING id`, [input.sourceUrl,now,createHash("sha256").update(JSON.stringify(value)).digest("hex"),`owner:${input.id}:${now}`]);
          copyId = copy.id;
        }
        await query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,live_at,produced_by)
          VALUES($1,$2,$3::jsonb,$4,'live','OWNER',$5,'',$6,$6,'owner')`,
        [flag.entity_id,flag.field,JSON.stringify(value),typeof value === "string" ? value : JSON.stringify(value),copyId,now]);
      }
    }
    if(flag.fact_id===null && (input.choice==='REMOVE'||input.choice==='TYPED_VALUE')) await publishOwnerChoice(String(flag.reader_family),
      original as Record<string,unknown>,{id:input.id,resolvedAt:new Date(now).toISOString(),choice:input.choice,
        values:ownerValues ?? {},sourceUrl:input.sourceUrl ?? null});
    await query(`UPDATE owner_flag SET resolved=$2,resolved_at=$3,owner_values=$4::jsonb,owner_source_url=$5 WHERE id=$1`,
    [input.id,input.choice,now,ownerValues ? JSON.stringify(ownerValues) : null,input.sourceUrl ?? null]);
    return { factId: flag.fact_id === null ? null : Number(flag.fact_id),entityId: flag.entity_id as string | null, readerId: flag.reader_id as string | null, family: flag.reader_family as string | null,
      detail: String(flag.reason ?? "A published value needs investigation.") };
  });
  await invalidateReaderCache(outcome.entityId ? await readerCacheScopeForEntity(db.query,outcome.entityId) : {national:true},purge);
  return outcome;
}
