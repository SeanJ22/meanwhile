/** Production observation only: both connections use read-only transactions. Never boots repositories or launches work. */
import { appendFileSync } from "node:fs";
import { neon, neonConfig } from "@neondatabase/serverless";
import { evaluateJobBreaker, JOB_TRANSFER_SQL, jobTransfers, JOB_BREAKER_INTERVAL_MS,
  JOB_BREAKER_HOURLY_BUDGET, readJobBreakerStates, type JobBreakerState } from "../lib/control-plane/job-transfer-breaker.ts";
import { hourStart } from "../lib/db/transfer-by-caller.ts";

const readerUrl = process.env.BB_READER_URL!, controlUrl = process.env.BB_CONTROL_URL!;
for (const [url, endpoint] of [[readerUrl,"ep-dry-river-axwtolzc"],[controlUrl,"ep-dark-night-aeo1ekz3"]]) {
  if (new URL(url).hostname.replace("-pooler.", ".").split(".")[0] !== endpoint)
    throw new Error("Shadow requires the production reader and control plane");
}
const reader = neon(readerUrl), control = neon(controlUrl);
const output = process.env.BB_SHADOW_OUTPUT;
const record = (value: unknown) => { const line = JSON.stringify(value); console.log(line); if (output) appendFileSync(output, line+"\n"); };
let requests = 0, sent = 0, received = 0;
const underlying = neonConfig.fetchFunction ?? fetch;
neonConfig.fetchFunction = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  requests++; sent += Buffer.byteLength(String(init?.body ?? ""));
  const response = await underlying(input, init);
  received += (await response.clone().arrayBuffer()).byteLength;
  return response;
};
const read = async (sql: typeof reader, text: string, params: readonly unknown[] = []) =>
  (await sql.transaction([sql.query(text,[...params])], { readOnly: true,
    fetchOptions: { signal: AbortSignal.timeout(15_000) } }))[0] as Record<string,unknown>[];
let states: Record<string,JobBreakerState> = {};
const started = Date.now();
let pauses = 0;
for (let tick = 0; tick <= 6; tick++) {
  const now = Date.now();
  const info = await read(control, `SELECT current_setting('transaction_read_only') AS read_only,
    to_regclass('cp_job_transfer_breaker')::text AS breaker_table,
    updated_at AS heartbeat_at,value->>'state' AS runner_state
    FROM cp_runner_heartbeat WHERE id='pilot-runner'`);
  if (info[0]?.read_only !== "on") throw new Error("Production control-plane observation is not read-only");
  if (tick === 0 && info[0]?.breaker_table) states = await readJobBreakerStates({query:(text,params)=>read(control,text,params)});
  const rows = jobTransfers(await read(reader,JOB_TRANSFER_SQL,[hourStart(now)]));
  const result = evaluateJobBreaker({now,rows,states,code:()=>null});
  states = result.snapshot.states;
  pauses += result.events.filter(event=>event.action === "PAUSE").length;
  record({type:"check",tick,at:new Date(now).toISOString(),hour:hourStart(now),controlPlane:info[0],
    jobs:rows.length,wouldPause:result.events.filter(event=>event.action === "PAUSE"),
    requests,requestBytes:sent,responseBytes:received,totalBytes:sent+received,gb:(sent+received)/1e9});
  if (tick < 6) await new Promise(resolve=>setTimeout(resolve,Math.max(0,started+(tick+1)*JOB_BREAKER_INTERVAL_MS-Date.now())));
}
const elapsedMs = Date.now()-started, bytesPerHour = (sent+received)*3_600_000/elapsedMs;
const passed = elapsedMs >= 3_600_000 && pauses === 0 && bytesPerHour < JOB_BREAKER_HOURLY_BUDGET;
record({type:"result",startedAt:new Date(started).toISOString(),finishedAt:new Date().toISOString(),elapsedMs,
  checks:7,pauses,requests,requestBytes:sent,responseBytes:received,gbPerHour:bytesPerHour/1e9,passed});
if (!passed) process.exitCode=1;
