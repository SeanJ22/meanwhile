/**
 * **THE ASSIGNMENT VIEW, AGAINST THE REAL CONTROL PLANE — READ-ONLY.**
 *
 * Reads the production control plane with raw, keyset-paged SELECTs through
 * `neon(controlPlaneUrlFromEnv())` and nothing else: no repository factory (it
 * can run bootstrap DDL), no append, no put, no compare-and-set. It then runs
 * the SAME pure projection the publisher and the admin drilldown run
 * (`lib/control-plane/assignment-view.ts`) and prints, for a succeeded, a
 * failed, a waiting and a blocked assignment (plus any ids passed with
 * `--id=`), all seven parts; then the published view's totals and its size.
 *
 *   node --env-file=<.env.local> --experimental-strip-types \
 *     --import ./scripts/register-test-loader.mjs scripts/assignment-view-demo.mts [--id=<assignment id>]
 *
 * The connection string is never printed. Every count printed carries its
 * denominator (RULING 159).
 */
import { neon } from "@neondatabase/serverless";

import { controlPlaneUrlFromEnv, CONTROL_PLANE_URL_VAR } from "../lib/control-plane/repository/pg-store.ts";
import {
  LANE_WORDS,
  OWNER_WORDS,
  STATE_WORDS,
  buildAssignmentView,
  buildAssignments,
  waitingHours,
  type AssignmentRow,
  type AssignmentSources,
} from "../lib/control-plane/assignment-view.ts";
import { pipelineStatesOf } from "../lib/control-plane/assignment-read.ts";
import { readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import { ageWords, modelName, plainCode, usdCents } from "../lib/control-plane/plain-words.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { PILOT_ZIPS } from "../lib/health/owner-corpus-compile.ts";

const url = controlPlaneUrlFromEnv();
if (url === null) {
  console.error(`${CONTROL_PLANE_URL_VAR} is not set; the demo reads the production control plane and nothing else.`);
  process.exit(2);
}
const sql = neon(url);
const PAGE = 400;
const NOW_ISO = new Date().toISOString();
const wanted = process.argv.filter((a) => a.startsWith("--id=")).map((a) => a.slice(5));

/* ------------------------------------------------------------ the reads */

async function aggregate<T>(table: string): Promise<T[]> {
  const out: T[] = [];
  let after = "";
  for (;;) {
    const rows = (await sql.query(`SELECT id, value FROM ${table} WHERE id > $1 ORDER BY id LIMIT ${PAGE}`, [after])) as {
      id: string;
      value: T;
    }[];
    for (const r of rows) out.push(r.value);
    if (rows.length < PAGE) return out;
    after = rows[rows.length - 1].id;
  }
}

async function appendOnly<T>(log: string, projection = "record"): Promise<T[]> {
  const out: T[] = [];
  let key = "";
  let position = -1;
  for (;;) {
    const rows = (await sql.query(
      `SELECT log_key, position, ${projection} AS record FROM cp_log_${log}
        WHERE (log_key, position) > ($1, $2) ORDER BY log_key, position LIMIT ${PAGE}`,
      [key, position],
    )) as { log_key: string; position: string | number; record: T }[];
    for (const r of rows) out.push(r.record);
    if (rows.length < PAGE) return out;
    key = rows[rows.length - 1].log_key;
    position = Number(rows[rows.length - 1].position);
  }
}

const started = Date.now();
const [obligations, occurrences, workItems, routeTasks, attempts, debts, leases] = await Promise.all([
  aggregate<AssignmentSources["obligations"][number]>("cp_obligations"),
  aggregate<AssignmentSources["occurrences"][number]>("cp_occurrences"),
  aggregate<AssignmentSources["workItems"][number]>("cp_work_items"),
  aggregate<AssignmentSources["routeTasks"][number]>("cp_route_tasks"),
  aggregate<AssignmentSources["attempts"][number]>("cp_attempts"),
  aggregate<AssignmentSources["debts"][number]>("cp_debts"),
  aggregate<NonNullable<AssignmentSources["leases"]>[number]>("cp_leases"),
]);
const [artifacts, costs, scoutResults, workerResults, pipelineRecords, dispositions] = await Promise.all([
  appendOnly<AssignmentSources["artifacts"][number]>("artifacts"),
  appendOnly<AssignmentSources["costs"][number]>("costs"),
  // The rendered field-manual lines and per-step token rows are not read by the view; leaving them out keeps each page small.
  appendOnly<AssignmentSources["scoutResults"][number]>("scout_results", "record - 'steps' - 'inheritedFieldManualLines'"),
  appendOnly<AssignmentSources["workerResults"][number]>("worker_results"),
  appendOnly<unknown>("promotion_pipeline"),
  appendOnly<NonNullable<AssignmentSources["dispositions"]>[number]>("dispositions"),
]);
const readMs = Date.now() - started;

const sources: AssignmentSources = {
  nowIso: NOW_ISO,
  obligations,
  occurrences,
  workItems,
  routeTasks,
  attempts,
  debts,
  leases,
  dispositions,
  artifacts,
  costs,
  scoutResults,
  workerResults,
  pipeline: pipelineStatesOf(pipelineRecords),
  activation: readActivationGate(process.cwd()),
  servedReader: null,
  pilotZips: PILOT_ZIPS,
};

/* ------------------------------------------------------------ the build */

const view = buildAssignmentView(sources);
const full = buildAssignments(sources, { textClip: 420, listClip: 4, costDenominatorUsd: view.summary.costs.ledgerMeasuredUsd });
const byId = new Map(full.map((r) => [r.id, r]));

/* ----------------------------------------------------------- rendering */

const line = (text = ""): void => console.log(text);
const indent = (text: string): void => console.log(`      ${text}`);
const when = (iso: string | null | undefined): string => (iso ? `${iso.slice(0, 16).replace("T", " ")}Z` : "no recorded time");
const counted = (n: number | null): string => (n === null ? "not counted" : n.toLocaleString("en-US"));

function workerWords(row: AssignmentRow): string {
  if (!row.what.workers.held) return `not yet — ${row.what.workers.gap.says}`;
  return row.what.workers.value
    .map((w) => {
      const model =
        w.model.kind === "MODEL" ? modelName(w.model.id) : w.model.kind === "PLAIN_CODE" ? `plain code (${w.model.tool})` : w.model.says;
      const reported = w.reportedModels.length > 0 ? `; provider reported ${w.reportedModels.map(modelName).join(", ")}` : "";
      return `${plainCode(w.role)} × ${counted(w.attempts)} — ${model}${reported}`;
    })
    .join("; ");
}

function printRow(label: string, row: AssignmentRow): void {
  line();
  line(`=== ${label}: ${STATE_WORDS[row.state].label.toUpperCase()} · ${LANE_WORDS[row.lane].label} · ${row.kind}`);
  line(`    id ${row.id}`);
  line(`    state: ${row.stateSays}`);
  line("  1 WHAT / WHERE / WHY / WHO");
  indent(`what:  ${row.what.title}${row.what.recordClass ? ` [record class ${row.what.recordClass}]` : ""}${row.what.route ? ` [route ${row.what.route}]` : ""}`);
  if (row.what.subjectName) indent(`for:   ${row.what.subjectName} [subject ${row.what.subject}]`);
  indent(`where: ${row.what.where.held ? row.what.where.value.name : `gap — ${row.what.where.gap.says}`}`);
  indent(`why:   ${row.what.why.says}`);
  if (row.what.why.band) indent(`band:  reader-impact band ${row.what.why.band.band} — ${row.what.why.band.why}`);
  if (row.what.why.dueAt) indent(`due:   ${when(row.what.why.dueAt)}${row.what.why.readerImpactAt ? `; reader impact ${when(row.what.why.readerImpactAt)}` : ""}`);
  if (row.what.why.cadence) indent(`cadence: ${row.what.why.cadence}`);
  indent(`who:   ${workerWords(row)}`);

  line("  2 DISCOVERED vs DOWNLOADED");
  const d = row.discovery;
  indent(`rounds opened ${counted(d.rounds)} (${counted(row.cost.rounds)} reached by a worker); attempts ${counted(d.attempts)}`);
  if (d.discovered.held) {
    indent(`discovered: ${d.discovered.value.says}${d.discovered.value.rungsWalked !== null ? ` (newest walk: ${d.discovered.value.rungsWalked} evidence-backed rungs)` : ""}`);
    for (const lead of d.discovered.value.leads) indent(`  · ${lead.kind} ${lead.says}${lead.url ? ` <${lead.url}>` : ""}${lead.artifactIds.length ? ` [evidence ${lead.artifactIds.slice(0, 3).join(", ")}]` : ""}`);
    if (d.discovered.value.moreLeads > 0) indent(`  … ${d.discovered.value.moreLeads} more lead(s) in the full chain`);
  } else indent(`discovered: gap (${d.discovered.gap.whose}) — ${d.discovered.gap.says}`);
  if (d.downloaded.held) {
    const dl = d.downloaded.value;
    indent(`downloaded: ${dl.says} complete ${dl.complete.value} of ${dl.complete.denominator}; ${dl.bytes === null ? "bytes not recorded" : `${dl.bytes.toLocaleString("en-US")} bytes`}`);
    for (const a of dl.items) indent(`  · ${a.artifactId} ${a.bytes.toLocaleString("en-US")} B ${a.contentType}${a.partial ? " PARTIAL" : ""} <${a.url}> (attempt ${a.attemptId}, ${when(a.at)})`);
    if (dl.more > 0) indent(`  … ${dl.more} more document(s)`);
  } else indent(`downloaded: gap (${d.downloaded.gap.whose}) — ${d.downloaded.gap.says}`);

  line("  3 PARSED / FAILED / USABLE RECORDS");
  const p = row.parsing.parsed;
  if (p.held) {
    indent(p.value.says);
    indent(`usable records: ${p.value.usable.held ? `${p.value.usable.value.value} of ${p.value.usable.value.denominator} — ${p.value.usable.value.contract}` : `gap — ${p.value.usable.gap.says}`}`);
    for (const f of p.value.failures) indent(`  · failed: ${f}`);
  } else indent(`gap (${p.gap.whose}) — ${p.gap.says}`);

  line("  4 VERIFIED / REJECTED / NEEDS MORE EVIDENCE");
  const v = row.verification;
  if (v.pipeline.held) {
    const pl = v.pipeline.value;
    indent(`${pl.says} (unit: ${pl.unit}; guard refusals ${pl.guardRefusals})`);
    indent(`passed ${pl.passed.value} of ${pl.passed.denominator}; needs more evidence ${pl.needsMoreEvidence.value} of ${pl.needsMoreEvidence.denominator}; rejected ${pl.rejected.value} of ${pl.rejected.denominator}`);
    for (const r of pl.rejections) indent(`  · ${r.guard ? "guard refusal" : "REJECTED"} at ${r.stage}: ${r.code} — ${r.says} [${r.itemId}]`);
    if (pl.itemIds.length) indent(`  items: ${pl.itemIds.join(", ")}`);
  } else indent(`pipeline: gap (${v.pipeline.gap.whose}) — ${v.pipeline.gap.says}`);
  for (const c of v.checks) indent(`  · ${c.who} ${c.verdict} ${when(c.at)} — ${c.says} [${c.resultId}]`);
  if (v.refusedFinishCount > 0) {
    indent(`hunter finishes refused by the executor: ${v.refusedFinishCount}`);
    for (const r of v.refusedFinishes) indent(`  · ${r.attemptId}: ${r.codes.join(", ")} — ${r.says}`);
  }

  line("  5 PROMOTED vs PUBLICLY AVAILABLE");
  const dv = row.delivery;
  if (dv.approved !== null) indent(`approved for promotion: ${dv.approved.held ? `${dv.approved.value.value} of ${dv.approved.value.denominator}` : `gap — ${dv.approved.gap.says}`}`);
  indent(`promoted: ${dv.promoted.held ? dv.promoted.value.says : `gap — ${dv.promoted.gap.says}`}`);
  indent(`publicly available: ${dv.publiclyAvailable.held ? dv.publiclyAvailable.value.says : `gap (${dv.publiclyAvailable.gap.whose}) — ${dv.publiclyAvailable.gap.says}`}`);

  line("  6 COST (retries and escalations included; unknown is never $0)");
  const c = row.cost;
  const dollars =
    c.dollars.kind === "MEASURED"
      ? `${usdCents(c.dollars.amount)} measured (${c.dollars.usd.held ? `of ${usdCents(c.dollars.usd.value.denominator)} attributed to assignments` : "no denominator"})`
      : c.dollars.kind === "UNMEASURED"
        ? `UNKNOWN — ${c.dollars.gap.says}`
        : c.dollars.says;
  indent(`dollars: ${dollars}`);
  indent(c.says);
  indent(`escalations: to owner ${c.escalations.toOwner}; model routing — ${c.escalations.modelRouting === null ? "none possible: this lane uses no model" : c.escalations.modelRouting.says}`);
  indent(c.nonDollar === null ? "requests/bytes/time: not metered for this lane" : `requests ${c.nonDollar.requests}, bytes ${c.nonDollar.bytes.toLocaleString("en-US")}, time ${Math.round(c.nonDollar.durationMs / 1000)} s`);

  line("  7 WHAT IS WAITING");
  const w = row.waiting;
  const age = waitingHours(row, NOW_ISO);
  const overdueWords = w.overdue === null ? (row.kind === "WORK_ITEM" ? "not on a clock (created work)" : "cannot tell") : w.overdue ? "yes" : "no";
  indent(`waiting now: ${w.waiting ? "yes" : "no"}; age ${age === null ? "none (nothing is waiting from a recorded time)" : ageWords(age)} (since ${when(w.since)}); eligible for dispatch now and not dispatched: ${overdueWords}`);
  if (w.dueAt || w.eligibleAt) indent(`stored next-due ${when(w.dueAt)}; next eligible ${when(w.eligibleAt)}`);
  if (w.backoff) indent(`failure backoff: ${w.backoff.failures} consecutive rounds without discharging the obligation, since ${when(w.backoff.since)}; retry not before ${when(w.retryAt)} (the runner's recorded retry class: ${w.backoff.retryClass})`);
  if (w.openRound) indent(`open round: ${w.openRound.id} opened ${when(w.openRound.openedAt)}, ${w.openRound.reached ? "reached by a worker" : "not reached by a worker yet"}`);
  indent(`blocker: ${w.blocker.kind === "UNKNOWN" ? `cannot tell — ${w.blocker.gap.says}` : w.blocker.says}`);
  indent(`owner of next step: ${OWNER_WORDS[w.owner]}`);
  indent(`next action: ${w.nextAction}`);

  line("  EVIDENCE");
  const e = row.evidence;
  if (e.obligationId) indent(`obligation ${e.obligationId}`);
  if (e.occurrenceIds.length) indent(`rounds ${e.occurrenceIds.join(", ")}${e.more.occurrences ? ` (+${e.more.occurrences} more)` : ""}`);
  if (e.workItemIds.length) indent(`work items ${e.workItemIds.join(", ")}${e.more.workItems ? ` (+${e.more.workItems} more)` : ""}`);
  if (e.routeTaskIds.length) indent(`route tasks ${e.routeTaskIds.join(", ")}${e.more.routeTasks ? ` (+${e.more.routeTasks} more)` : ""}`);
  if (e.attemptIds.length) indent(`attempts ${e.attemptIds.join(", ")}${e.more.attempts ? ` (+${e.more.attempts} more)` : ""}`);
  if (e.dispositionCommitIds.length) indent(`disposition commits ${e.dispositionCommitIds.join(", ")}`);
  for (const n of e.notes) indent(`note [${n.from}, ${when(n.at)}]: ${n.text}`);
}

/* --------------------------------------------------- choosing examples */

function pick(test: (r: AssignmentRow) => boolean, prefer?: (r: AssignmentRow) => number): AssignmentRow | null {
  const candidates = full.filter(test);
  if (candidates.length === 0) return null;
  const ranked = prefer ? [...candidates].sort((a, b) => prefer(b) - prefer(a) || a.id.localeCompare(b.id)) : candidates;
  return ranked[0];
}

const artifactsOf = (r: AssignmentRow): number => (r.discovery.downloaded.held ? r.discovery.downloaded.value.count : 0);
const recent = (r: AssignmentRow): number => (r.lastActivityAt ? Date.parse(r.lastActivityAt) : 0);

const examples: [string, AssignmentRow | null][] = [
  [
    "SUCCEEDED (Scout found a route, with downloads)",
    pick((r) => r.state === "SUCCEEDED" && r.lane === "SCOUT" && artifactsOf(r) > 0, recent),
  ],
  [
    "SUCCEEDED (plain-code acquisition, with downloads)",
    pick((r) => r.state === "SUCCEEDED" && r.lane === "ROUTINE" && artifactsOf(r) > 0, recent),
  ],
  ["FAILED (Scout walked and found nothing)", pick((r) => r.state === "FAILED" && r.lane === "SCOUT" && /found no route/.test(r.stateSays), recent)],
  ["FAILED (plain-code acquisition, in failure backoff)", pick((r) => r.state === "FAILED" && r.lane === "ROUTINE" && r.waiting.backoff !== null, recent)],
  ["FAILED (a wall at the source)", pick((r) => r.state === "FAILED" && /wall/i.test(r.stateSays), recent)],
  [
    "WAITING (overdue, never reached, reader-impact band 1)",
    pick(
      (r) => r.state === "WAITING" && r.waiting.overdue === true && r.lane === "UNASSIGNED" && r.what.why.band?.band === 1,
      (r) => -(Date.parse(r.waiting.since ?? NOW_ISO) || 0),
    ),
  ],
  ["WAITING (a round opened and not reached)", pick((r) => r.state === "WAITING" && r.waiting.openRound !== null, recent)],
  ["WAITING (in failure backoff)", pick((r) => r.state === "WAITING" && r.waiting.backoff !== null)],
  ["BLOCKED (needs an adapter)", pick((r) => r.state === "BLOCKED" && r.waiting.owner === "ENGINEERING" && r.kind === "STANDING_OBLIGATION", recent)],
  ["BLOCKED (only a person can move it)", pick((r) => r.state === "BLOCKED" && r.waiting.owner === "OWNER", recent)],
  ["CREATED work item", pick((r) => r.lane === "CREATED", recent)],
  ...wanted.map((id): [string, AssignmentRow | null] => [`REQUESTED ${id}`, byId.get(id) ?? null]),
];

/* ---------------------------------------------------------------- print */

line(`ASSIGNMENT VIEW — production control plane, read-only, ${NOW_ISO}`);
line(`read ${obligations.length.toLocaleString("en-US")} obligations, ${occurrences.length.toLocaleString("en-US")} rounds, ${attempts.length.toLocaleString("en-US")} attempts, ${costs.length.toLocaleString("en-US")} cost rows in ${(readMs / 1000).toFixed(1)} s (raw SELECTs, ${PAGE}-row keyset pages)`);
line(
  floorLine(
    floored(
      "assignments",
      "every obligation, work item and orphaned execution record",
      view.summary.total,
      full.length,
      view.summary.total === 0 ? "the control plane holds no standing obligation and no work item" : undefined,
    ),
  ),
);
for (const s of view.summary.byState) line(`  state ${STATE_WORDS[s.state].label.padEnd(12)} ${String(s.count.value).padStart(6)} of ${s.count.denominator}`);
for (const l of view.summary.byLane) line(`  lane  ${LANE_WORDS[l.lane].label.padEnd(22)} ${String(l.count.value).padStart(6)} of ${l.count.denominator}`);
if (view.summary.overdue.held) line(`  eligible for dispatch now and not dispatched (overdue): ${view.summary.overdue.value.value} of ${view.summary.overdue.value.denominator} active standing obligations with a stored next-due`);
if (view.summary.inBackoff.held) line(`  in failure backoff: ${view.summary.inBackoff.value.value} of ${view.summary.inBackoff.value.denominator} active standing obligations`);
const cs = view.summary.costs;
const usdOf = (h: typeof cs.attributed): string => (h.held ? `${usdCents(h.value.value)} of ${usdCents(h.value.denominator)}` : `gap — ${h.gap.says}`);
line(`  cost ledger: ${cs.ledgerRows} rows; measured ${cs.ledgerMeasuredUsd === null ? "nothing" : usdCents(cs.ledgerMeasuredUsd)}`);
line(`    attributed to an assignment: ${usdOf(cs.attributed)}`);
line(`    shared (Scout pre-warm, ${cs.shared.rows} rows): ${usdOf(cs.shared.usd)} — ${cs.shared.says}`);
line(`    unattributed (${cs.unattributed.rows} rows): ${usdOf(cs.unattributed.usd)} — ${cs.unattributed.says}`);
line(`    model-capable rows with no dollar figure (unknown): ${cs.unmeasuredModelRows.held ? `${cs.unmeasuredModelRows.value.value} of ${cs.unmeasuredModelRows.value.denominator}` : cs.unmeasuredModelRows.gap.says}; plain-code rows ${cs.plainCodeRows}`);
if (view.summary.pipeline.held) line(`  pipeline items linked to an assignment: ${view.summary.pipeline.value.linked.value} of ${view.summary.pipeline.value.linked.denominator}`);
const bytes = JSON.stringify(view).length;
line(`  published view: ${view.selection.published} of ${view.summary.total} rows (up to ${view.selection.perGroup} per state and lane; ${view.selection.trimmedForBytes} trimmed for the ${view.selection.byteBudget.toLocaleString("en-US")}-byte budget); ${bytes.toLocaleString("en-US")} bytes serialized`);
for (const g of view.summary.groups) {
  line(`    ${STATE_WORDS[g.state].label.padEnd(12)} ${LANE_WORDS[g.lane].label.padEnd(22)} published ${g.published} of ${g.total}`);
}

for (const [label, row] of examples) {
  if (row === null) {
    line();
    line(`=== ${label}: no assignment of this kind is on record right now.`);
    continue;
  }
  printRow(label, row);
}
