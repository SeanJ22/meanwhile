import { easternDay, type NeonBytesHour } from "./transfer-by-caller.ts";

type Counts = Readonly<Record<string, readonly [number, number, number]>>;
const mapCounts = (before: string, incoming: string, operation: "add" | "max" | "delta") => {
  const values = [0, 1, 2].map(index => {
    const a = `coalesce((a->>${index})::bigint,0)`, b = `coalesce((b->>${index})::bigint,0)`;
    return operation === "add" ? `${a}+${b}` : operation === "max" ? `greatest(${a},${b})` : `greatest(0,${b}-${a})`;
  });
  return `(SELECT coalesce(jsonb_object_agg(k,jsonb_build_array(${values.join(",")})),'{}'::jsonb)
    FROM jsonb_each(coalesce(${before},'{}'::jsonb)) old(k,a)
    FULL JOIN jsonb_each(coalesce(${incoming},'{}'::jsonb)) incoming(k,b) USING(k))`;
};

/** Each process/hour submits cumulative counters. PostgreSQL applies only the increase,
 * atomically with its cursor, including when an older report arrives or a collector restarts.
 * The hourly table holds every process's bytes. Only reader functions also keep a daily row
 * (its route reads); the runner's days are rebuilt from its hours when they are read.
 */
export function processTransferStatements(part: NeonBytesHour, table: "hourly" | "daily"): readonly { query: string; params: readonly unknown[] }[] {
  if (!Number.isSafeInteger(part.pid) || !Number.isFinite(part.startedMs ?? 0)) return [];
  const daily = table === "daily";
  if (daily && part.client !== "reader") return [];
  const processKey = processTransferKey(part);
  const statements: { query: string; params: readonly unknown[] }[] = [];
  const name = daily ? "database_transfer_daily" : "database_transfer_hourly";
  const cursorParam = daily ? 8 : 7;
  const prior = `${name}.processes -> $${cursorParam}::text`;
  const priorReads = `${prior} -> 'reads'`;
  const count = (key: string) => `coalesce((${prior}->>'${key}')::bigint,0)`;
  const deltas = mapCounts(priorReads, "EXCLUDED.reads", "delta");
  const cursor = `jsonb_build_object('requests',greatest(${count("requests")},EXCLUDED.requests),
    'request_bytes',greatest(${count("request_bytes")},EXCLUDED.request_bytes),
    'response_bytes',greatest(${count("response_bytes")},EXCLUDED.response_bytes),
    'reads',${mapCounts(priorReads, "EXCLUDED.reads", "max")})`;
  const query = `INSERT INTO ${name} (${daily ? "day" : "hour"},database_name,${daily ? "client," : ""}requests,request_bytes,response_bytes,reads,processes)
    VALUES ($1::${daily ? "date" : "timestamptz"},$2,${daily ? "$3," : ""}${daily ? "$4,$5,$6,$7" : "$3,$4,$5,$6"}::jsonb,
      jsonb_build_object($${cursorParam}::text,$${cursorParam + 1}::jsonb))
    ON CONFLICT (${daily ? "day,database_name,client" : "hour,database_name"}) DO UPDATE SET
      requests=${name}.requests+greatest(0,EXCLUDED.requests-${count("requests")}),
      request_bytes=${name}.request_bytes+greatest(0,EXCLUDED.request_bytes-${count("request_bytes")}),
      response_bytes=${name}.response_bytes+greatest(0,EXCLUDED.response_bytes-${count("response_bytes")}),
      reads=${mapCounts(`${name}.reads`, deltas, "add")},
      processes=jsonb_set(${name}.processes,ARRAY[$${cursorParam}::text],${cursor},true)${daily ? ",updated_at=now()" : ""}`;
  for (const database of ["reader", "control-plane"] as const) {
    const sent = part.sent?.[database] ?? { requests: 0, bytes: 0 };
    const bytes = part.bytes[database];
    const reads: Counts = Object.fromEntries(Object.entries(part.reads ?? {}).filter(([key]) => key.startsWith(database + "\t"))
      .map(([key, value]) => [key.slice(database.length + 1), value]));
    if (!bytes && !sent.requests && !sent.bytes && !Object.keys(reads).length) continue;
    // The same input cursor seeds a new row and advances an existing one.
    const input = { requests: sent.requests, request_bytes: sent.bytes, response_bytes: bytes, reads };
    statements.push({ query, params: [daily ? easternDay(new Date(part.hour)) : part.hour, database, ...(daily ? [part.client] : []),
      sent.requests, sent.bytes, bytes, JSON.stringify(reads), processKey, JSON.stringify(input)] });
  }
  return statements;
}

export function mergeProcessTransfer(prior: NeonBytesHour | undefined, next: NeonBytesHour): NeonBytesHour {
  const reads: Record<string, readonly [number, number, number]> = { ...prior?.reads };
  for (const [key, counts] of Object.entries(next.reads ?? {}))
    reads[key] = counts.map((count, index) => Math.max(count, reads[key]?.[index] ?? 0)) as [number, number, number];
  const sent = Object.fromEntries((["reader", "control-plane"] as const).map(database => [database, {
    requests: Math.max(next.sent?.[database].requests ?? 0, prior?.sent?.[database].requests ?? 0),
    bytes: Math.max(next.sent?.[database].bytes ?? 0, prior?.sent?.[database].bytes ?? 0),
  }])) as NonNullable<NeonBytesHour["sent"]>;
  return { ...prior, ...next, reads, sent,
    requests: Math.max(next.requests, prior?.requests ?? 0),
    bytes: { reader: Math.max(next.bytes.reader, prior?.bytes.reader ?? 0),
      "control-plane": Math.max(next.bytes["control-plane"], prior?.bytes["control-plane"] ?? 0) } };
}

export const processTransferKey = (part: NeonBytesHour) => `${part.pid}:${part.startedMs ?? 0}:${part.hour}`;
