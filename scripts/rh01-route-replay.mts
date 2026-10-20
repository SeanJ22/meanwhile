/** An existing pending production route, with its real provider descriptor and disposable local lifecycle writes. */
import { neon } from "@neondatabase/serverless";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RouteTask } from "../lib/control-plane/route-task.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import type { StandingObligation } from "../lib/control-plane/scheduler/durable.ts";
import type { ScheduledObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { enableProductionReadAccounting } from "./rh01-network.mjs";

enableProductionReadAccounting(process.env.WTP_RH01_PHASE ?? "route-worker-replay");

const codeRoot = process.env.WTP_RH01_CODE_ROOT ?? process.cwd();
const code = (path: string) => import(pathToFileURL(join(codeRoot, path)).href);
const state = process.argv.find(value => value.startsWith("--state="))?.slice(8).toUpperCase();
if (!state || !/^[A-Z]{2}$/.test(state)) throw Error("RH01 route replay requires its actual state");
if (!process.env.WTP_RH01_FACTS_URL) throw Error("RH01 route replay requires the shared local SQL coordinator");
const connection = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
if (!connection || decodeURIComponent(new URL(connection).username) !== "wtp_cp_release_readonly") throw Error("RH01 route replay requires the control-plane read-only role");
const { readCandidateEnrichmentAuthorities, candidateEnrichmentProvider } = await code("lib/control-plane/scheduler/providers/candidate-enrichment.ts");
const now = new Date().toISOString();
const holdings = await readCandidateEnrichmentAuthorities(state);
const provider = candidateEnrichmentProvider({ holdings, trackedStates: { read: () => ({ states: [state.toLowerCase()], source: `RH01 actual ${state} production task scope` }) } });
const provided = provider.enumerate({ root: codeRoot, nowIso: now });
if (provided.readFailure) throw Error(provided.readFailure);
const records = provided.obligations as { subjectId: string; routes: { routeId: string; open: { kind: string } }[] }[];
const sql = neon(connection);
const selected = await sql.query(`SELECT t.value AS task,w.value AS work FROM cp_route_tasks t JOIN cp_work_items w ON w.id=t.value->>'workItemId'
  WHERE t.value->>'target'=ANY($1::text[]) AND t.value->>'state' IN ('PENDING','RECLAIMABLE')
    AND t.value->>'routeId' IN ('candidate-site-recorded','candidate-wikipedia-api')
  ORDER BY (t.value->>'routeId'='candidate-site-recorded') DESC,t.updated_at,t.id LIMIT 1`, [records.map(record => record.subjectId)]);
if (!selected[0]) throw Error("RH01 actual provider has no matching pending production route");
const task = selected[0].task as RouteTask, work = selected[0].work as WorkItem;
const descriptor = records.find(record => record.subjectId === task.target)?.routes.find(route => route.routeId === task.routeId);
if (!descriptor || descriptor.open.kind !== "HTTP_GET") throw Error("RH01 production route does not match its actual provider descriptor");
const obligationId = String(work.obligation).replace(/#\d+$/, "");
const [held] = await sql.query("SELECT value FROM cp_obligations WHERE id=$1", [obligationId]);
if (!held) throw Error("RH01 existing route has no durable production obligation");
const obligation = held.value as StandingObligation;
const [{ routeProcessExecutor }, { realOpen }, { hostSpacer }, { cycleVault }, { scheduleObligation }, { createPgRepositories }] = await Promise.all([
  code("lib/control-plane/workers/route-process.ts"), code("lib/control-plane/scheduler/route-executor.ts"),
  code("lib/control-plane/scheduler/http-executor.ts"), code("lib/control-plane/scheduler/vault.ts"),
  code("lib/control-plane/scheduler/obligation.ts"), code("lib/control-plane/repository/pg-store.ts"),
]);
const scheduled = scheduleObligation(obligation, Date.parse(now)) as ScheduledObligation | { reason: string };
if (!("cadenceHours" in scheduled)) throw Error(scheduled.reason);
const vault = cycleVault(join(process.env.WTP_RH01_DIRECTORY!, "route-vault"));
try {
  const executor = routeProcessExecutor({ root: codeRoot, postgres: true, route: descriptor,
    openOne: realOpen, spaceOut: hostSpacer(), vault: vault.put });
  const report = await executor.dispatch({ obligation: scheduled, routeTaskId: task.id, now,
    clock: () => new Date().toISOString(), holder: `RH01-route:${process.pid}`, leaseTtlMs: 120000,
    maturity: () => "GRADUATED", nonProduction: true });
  const repos = await createPgRepositories(connection, now, { skipBootstrap: true });
  const closed = report.attemptId ? (await repos.attempts.read(report.attemptId))?.value : null;
  const complete = report.claimed && report.outcome === "WORKED" && report.dispositionCommitted &&
    ["INGESTED", "WALKED_NO_YIELD"].includes(report.disposition ?? "") && report.artifactIds.length > 0 && closed?.outcome === "COMPLETED";
  console.log(`RH01_ROUTE_REPLAY ${JSON.stringify({ complete, taskId: task.id, subject: work.subject, routeId: task.routeId, report })}`);
  if (!complete) process.exitCode = 1;
} finally { await vault.close?.(); }
