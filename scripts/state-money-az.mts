/**
 * Arizona state campaign money: acquires the complete SeeTheMoney cycle
 * universe and the Secretary of State's committee register, reconciles each
 * committee's summary totals against its own itemised ledger, and projects the
 * promoted ballot's candidates from that statewide corpus.
 *
 * @freshness-reads-here — the candidate clock follows all official reads;
 * the catch-path clock is durable evidence of the failed acquisition attempt.
 *
 * ```
 *   pnpm money:az --promote
 *   pnpm money:az --promote --ledger-budget=120    reconcile at most 120 NEW committees
 * ```
 *
 * Summary rows are parts whose sum is the cycle total; `CashBalance` is a
 * carried-forward balance of unknown meaning and is not published. The detail
 * endpoint needs `entityId=<id>` in the query string as well as `Name=1~<id>`.
 * The universe is the union of the portal's three filter settings, because the
 * default view hides most of the register. Itemised rows carry contributor
 * details; they are streamed to compute sums and never persisted.
 */
import net from "node:net";

import {
  AGENCY,
  BASE,
  CYCLE_2026,
  DETAIL_COLUMNS,
  DETAIL_PATH,
  FTP_DIR,
  FTP_HOST,
  HEADERS,
  SUMMARY_COLUMNS,
  SUMMARY_PATH,
  aggregateEntities,
  dataTablesBody,
  detailQuery,
  nextFilingDue,
  normalizeAz,
  parseCommitteeRegister,
  parseReportingPeriods,
  parseTableResponse,
  reconcileEntity,
  summaryQuery,
  universeQueries,
  type DetailAggregate,
  type EntityTotals,
  type RegisterRow,
  type ReportingPeriod,
  type SummaryRow,
} from "../lib/sources/az-seethemoney/index.ts";
import { computeSplit, type StateMoneySnapshot } from "../lib/funding/state-money.ts";
import { OUTBOUND_CONTACT } from "../lib/geo/outbound-agent.ts";
import { today } from "./doc-dates.mjs";
import { stateCampaignFinanceCandidate } from "../lib/funding/data-plane.ts";
import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { readAzBallotProjection } from "../lib/civic-data/manual-read-models.ts";

const AS_OF = today();
const YEAR = CYCLE_2026.cycle;
if (!process.argv.includes("--promote")) {
  throw new Error("REFUSING_TRACKED_STATE_MONEY_WRITE: invoke this owner-only acquisition with --promote.");
}
prepareProductionCivicDataWrite();
const BUDGET_ARG = process.argv.find((a) => a.startsWith("--ledger-budget="));
const LEDGER_BUDGET = BUDGET_ARG ? Number(BUDGET_ARG.split("=")[1]) : Number.POSITIVE_INFINITY;
const SPACING_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const officialRawBodies: string[] = [];
let candidateSubmitted = false;
/* -------------------------------------------------------------------------
 * TRANSPORT. The record and the register live behind different protocols.
 * ------------------------------------------------------------------------- */

async function postTable(path: string, query: string, body: string): Promise<string> {
  const url = `${BASE}${path}?${query}`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await sleep(SPACING_MS);
      const res = await fetch(url, { method: "POST", headers: { ...HEADERS }, body });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      officialRawBodies.push(text);
      return text;
    } catch (e) {
      lastError = e;
      await sleep(1500 * (attempt + 1));
    }
  }
  // Thrown so the walk stops: continuing would record an absence for records we failed to read.
  throw new Error(`${url}: unreachable after 3 attempts — ${(lastError as Error)?.message}`);
}

/** Anonymous FTP, the access method the Secretary of State's Bulk Filing Guide publishes. */
function ftpGet(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let buf = "";
    let stage = 0;
    let dataDone = false;
    let transferOk = false;
    const ctl = net.createConnection({ host: FTP_HOST, port: 21 });
    ctl.setTimeout(90_000);
    const finish = () => {
      if (dataDone && transferOk) {
        try {
          ctl.write("QUIT\r\n");
          ctl.end();
        } catch {
          /* the transfer already completed; a failed QUIT is not a failed read */
        }
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    };
    ctl.on("timeout", () => reject(new Error(`ftp://${FTP_HOST}${path}: control timeout at stage ${stage}`)));
    ctl.on("error", reject);
    ctl.on("data", (d) => {
      buf += d.toString("latin1");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        const m = /^(\d{3}) /.exec(line);
        if (!m) continue;
        const code = Number(m[1]);
        if (stage === 0 && code === 220) ctl.write("USER anonymous\r\n"), (stage = 1);
        // Anonymous FTP convention: the password is a contact address.
        else if (stage === 1 && code === 331) ctl.write(`PASS ${OUTBOUND_CONTACT}\r\n`), (stage = 2);
        else if (stage === 2 && code === 230) ctl.write("TYPE I\r\n"), (stage = 3);
        else if (stage === 3 && code === 200) ctl.write("PASV\r\n"), (stage = 4);
        else if (stage === 4 && code === 227) {
          const p = /\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(line);
          if (!p) return reject(new Error(`PASV reply unparsed: ${line}`));
          const sock = net.createConnection({
            host: `${p[1]}.${p[2]}.${p[3]}.${p[4]}`,
            port: Number(p[5]) * 256 + Number(p[6]),
          });
          sock.setTimeout(90_000);
          sock.on("data", (c) => chunks.push(c));
          sock.on("close", () => ((dataDone = true), finish()));
          sock.on("error", reject);
          sock.on("timeout", () => reject(new Error(`ftp://${FTP_HOST}${path}: data timeout`)));
          sock.on("connect", () => (ctl.write(`RETR ${path}\r\n`), (stage = 5)));
        } else if (stage === 5 && (code === 226 || code === 250)) ((transferOk = true), finish());
        else if (code >= 400) reject(new Error(`ftp://${FTP_HOST}${path}: ${line}`));
      }
    });
  });
}

/* =========================================================================
 * LAYER 1 — ACQUISITION. Statewide.
 * ========================================================================= */

async function main(): Promise<void> {
console.log(`Arizona state campaign money — ${AS_OF} (promotion-only)`);
console.log(`  agency: ${AGENCY}`);
console.log(`  acquisition denominator: the complete Arizona ${YEAR} cycle universe (no ZIP, no ballot)`);

/* RUNG 1 — the union of the portal's three own filter settings. */
const seen = new Map<string, SummaryRow>();
const perQuery: { label: string; rows: number; entities: number }[] = [];
for (const q of universeQueries(CYCLE_2026.startYear, CYCLE_2026.endYear)) {
  const text = await postTable(SUMMARY_PATH, summaryQuery(q), dataTablesBody(SUMMARY_COLUMNS, { length: 5000 }));
  const label = `IsLessActive=${q.isLessActive} ShowOfficeHolder=${q.showOfficeHolder}`;
  const parsed = parseTableResponse<SummaryRow>(text, `GetNEWTableData ${label}`);
  if (parsed.data.length !== parsed.recordsTotal) {
    throw new Error(
      `GetNEWTableData ${label} returned ${parsed.data.length} of ${parsed.recordsTotal} rows — a SHORT READ, ` +
        "and a partial that reconciles is still a wrong answer (RULING 100).",
    );
  }
  perQuery.push({ label, rows: parsed.data.length, entities: new Set(parsed.data.map((r) => r.EntityID)).size });
  for (const r of parsed.data) seen.set(`${r.EntityID}|${r.OfficeID}|${r.PartyName}|${r.Income}|${r.Expense}`, r);
  console.log(`  summary  ${label.padEnd(44)} ${parsed.recordsTotal} rows`);
}
const summaryRows = [...seen.values()];
if (summaryRows.length === 0) throw new Error("the three universe queries together returned zero rows — FAILED extraction");
const entities = aggregateEntities(summaryRows);
console.log(`  union: ${summaryRows.length} rows in ${entities.size} entities`);

/* RUNG 1 — the register and the calendar, over a different protocol. */
const registerRaw = await ftpGet(`${FTP_DIR}/Committees.txt`);
const periodsRaw = await ftpGet(`${FTP_DIR}/ReportingPeriods.txt`);
officialRawBodies.push(registerRaw, periodsRaw);
const register: Map<string, RegisterRow> = parseCommitteeRegister(registerRaw);
const reportingPeriods: ReportingPeriod[] = parseReportingPeriods(periodsRaw);
const nextDue = nextFilingDue(reportingPeriods, AS_OF);
console.log(`  register: ${register.size} committees   calendar: ${reportingPeriods.length} reporting periods`);
console.log(`  next filing deadline after ${AS_OF}: ${nextDue ? `${nextDue.reportName} (${nextDue.filingPeriodEndDate})` : "NONE STATED in the published calendar"}`);

/** Candidate committees by the publisher's own entity type; officeholder-expense committees are not campaign money. */
const CANDIDATE_ENTITY_TYPE = /^candidate\b/i;
const statewideCandidateEntities = [...entities.values()].filter((e) =>
  CANDIDATE_ENTITY_TYPE.test(e.entityTypeName ?? ""),
);
console.log(
  `  statewide candidate committees: ${statewideCandidateEntities.length} of ${entities.size} entities in the cycle universe`,
);

/* =========================================================================
 * THE HELD CORPUS — reconciliations carried forward within this run.
 * ========================================================================= */

interface HeldReconciliation {
  entityId: number;
  committeeName: string;
  candidate: string;
  summaryIncome: number;
  summaryExpense: number;
  itemisedIncome: number;
  itemisedExpense: number;
  incomeTransactions: number;
  expenseTransactions: number;
  agrees: boolean;
  note: string;
  walkedAt: string;
}

interface StatewideCorpusFile {
  formatVersion: 1;
  reconciliations?: HeldReconciliation[];
}

// Every production run acquires its own official evidence.
const held = new Map<number, HeldReconciliation>();

/** A held reconciliation is reused only while the committee's summary totals are unchanged. */
function heldStillDescribes(entity: EntityTotals): HeldReconciliation | null {
  const prior = held.get(entity.entityId);
  if (!prior) return null;
  if (prior.summaryIncome !== entity.income || prior.summaryExpense !== entity.expense) return null;
  return prior;
}

/* =========================================================================
 * LAYER 2 — IDENTITY. Who exists, statewide.
 * ========================================================================= */

interface ProjectionCandidacy {
  id: string;
  contestId: string;
  givenName: string;
  familyName: string;
}
interface ProjectionContest {
  id: string;
  title: string;
}

const identityProjection = await readAzBallotProjection({ bypassCache: true });
if (identityProjection.kind !== "PROMOTED") {
  throw new Error(
    `AZ_BALLOT_IDENTITY_AUTHORITY_UNAVAILABLE:${identityProjection.kind}: campaign-finance acquisition ` +
      "requires the canonical promoted Arizona ballot/identity projection and never reads its tracked bootstrap.",
  );
}
const registry = identityProjection.value.identityRegistry;
const contestTitleByIdentity = new Map(registry.contests.map((c) => [c.identityId, c.office]));
const contestById = new Map<string, ProjectionContest>();
for (const contest of registry.contests) {
  for (const id of contest.canonicalContestIds) contestById.set(id, { id, title: contest.office });
}
const candidacies: ProjectionCandidacy[] = registry.candidates
  .filter((c) => c.canonicalCandidacyId !== null)
  .map((c) => {
    const contest = registry.contests.find((x) => x.identityId === c.contestIdentityId);
    return {
      id: c.canonicalCandidacyId!,
      contestId: contest?.canonicalContestIds[0] ?? "",
      givenName: c.givenName ?? c.displayName,
      familyName: c.familyName ?? "",
    };
  })
  .filter((c) => c.contestId.length > 0);
console.log(
  `  identity layer: ${registry.candidates.length} statewide candidates known, ` +
    `${candidacies.length} with a canonical candidacy id, across ${contestTitleByIdentity.size} contests`,
);

/* =========================================================================
 * THE LEDGER WALK. Committees already linked to a canonical candidacy go
 * first, so a budgeted run never regresses a card; whatever a budget leaves is
 * a route gap, never an absence.
 * ========================================================================= */

const linkedCommitteeIds = new Set<number>();
for (const cand of registry.candidates) {
  for (const committee of cand.committees) {
    const id = Number(committee.committeeId);
    if (Number.isFinite(id)) linkedCommitteeIds.add(id);
  }
}

const walkOrder = [...statewideCandidateEntities].sort((a, b) => {
  const aLinked = linkedCommitteeIds.has(a.entityId) ? 0 : 1;
  const bLinked = linkedCommitteeIds.has(b.entityId) ? 0 : 1;
  if (aLinked !== bLinked) return aLinked - bLinked;
  return a.entityId - b.entityId;
});

const detail = new Map<number, { income: DetailAggregate; expense: DetailAggregate }>();
const reconciledEntityIds = new Set<number>();
const reconciliationRows: HeldReconciliation[] = [];
const routeGaps: { entityId: number; committeeName: string; reason: string; nextDue: string | null }[] = [];

let carried = 0;
let walked = 0;
let budgetLeft = LEDGER_BUDGET;

for (const entity of walkOrder) {
  const prior = heldStillDescribes(entity);
  if (prior) {
    carried += 1;
    if (prior.agrees) reconciledEntityIds.add(entity.entityId);
    detail.set(entity.entityId, {
      income: { count: prior.incomeTransactions, sum: prior.itemisedIncome },
      expense: { count: prior.expenseTransactions, sum: prior.itemisedExpense },
    });
    reconciliationRows.push(prior);
    continue;
  }

  if (budgetLeft <= 0) {
    // A route gap, not an absence: it carries the agency's next filing deadline.
    routeGaps.push({
      entityId: entity.entityId,
      committeeName: entity.committeeName,
      reason: "itemised ledger not yet reconciled — this run's ledger budget was spent",
      nextDue: nextDue?.filingPeriodEndDate ?? null,
    });
    continue;
  }

  const per: Record<"income" | "expense", DetailAggregate> = {
    income: { count: 0, sum: 0 },
    expense: { count: 0, sum: 0 },
  };
  for (const kind of ["income", "expense"] as const) {
    let start = 0;
    let total: number | null = null;
    for (;;) {
      const text = await postTable(
        DETAIL_PATH,
        detailQuery({
          entityId: entity.entityId,
          kind,
          startYear: CYCLE_2026.startYear,
          endYear: CYCLE_2026.endYear,
          start,
          length: 2000,
        }),
        dataTablesBody(DETAIL_COLUMNS, { start, length: 2000, orderColumn: 2, orderDir: "desc" }),
      );
      const parsed = parseTableResponse<{ Amount?: number | null }>(
        text,
        `GetNEWDetailedTableData ${kind} ${entity.entityId}`,
      );
      if (total === null) total = parsed.recordsTotal;
      let sum = 0;
      // Itemised rows carry contributor details: each contributes a number and is dropped.
      for (const row of parsed.data) sum += row.Amount ?? 0;
      per[kind].count += parsed.data.length;
      per[kind].sum = Math.round((per[kind].sum + sum) * 100) / 100;
      start += parsed.data.length;
      if (parsed.data.length === 0 || start >= total) break;
    }
  }
  detail.set(entity.entityId, per);
  const verdict = reconcileEntity(entity, per);
  if (verdict.agrees) reconciledEntityIds.add(entity.entityId);
  const row: HeldReconciliation = {
    entityId: entity.entityId,
    committeeName: entity.committeeName,
    candidate: entity.candidateDisplay,
    summaryIncome: entity.income,
    summaryExpense: entity.expense,
    itemisedIncome: per.income.sum,
    itemisedExpense: per.expense.sum,
    incomeTransactions: per.income.count,
    expenseTransactions: per.expense.count,
    agrees: verdict.agrees,
    note: verdict.note,
    walkedAt: AS_OF,
  };
  reconciliationRows.push(row);
  held.set(entity.entityId, row);
  walked += 1;
  budgetLeft -= 1;
  if (walked % 10 === 0) {
    console.log(`  ledger ${walked} walked / ${carried} carried / ${walkOrder.length} statewide`);
  }
}

console.log(
  `\n  RECONCILIATION, against the publisher's own itemised ledger:` +
    `\n    statewide candidate committees        ${walkOrder.length}` +
    `\n    reconciled on this run                ${walked}` +
    `\n    carried forward, totals unchanged     ${carried}` +
    `\n    agreeing with the itemised ledger     ${reconciledEntityIds.size}` +
    `\n    disagreeing                           ${reconciliationRows.length - reconciledEntityIds.size}` +
    `\n    route gaps (ledger not yet read)      ${routeGaps.length}`,
);

/* =========================================================================
 * LAYER 3 — PROJECTION. The reader snapshot, built from the statewide corpus.
 * ========================================================================= */

const { records, states } = normalizeAz({
  corpus: { summaryRows, detail, register, reportingPeriods, collectedAt: AS_OF },
  candidacies,
  contestById,
  electionYear: YEAR,
  reconciledEntityIds,
  nextDue,
});

const inScope = states.filter((s) => s.state !== "FEDERAL_NOT_IN_SCOPE").length;
const tally = {
  SOURCED_FILED: states.filter((s) => s.state === "SOURCED_FILED").length,
  SOURCED_ABSENCE: states.filter((s) => s.state === "SOURCED_ABSENCE").length,
  OURS_GAP: states.filter((s) => s.state === "OURS_GAP").length,
  FEDERAL_NOT_IN_SCOPE: states.filter((s) => s.state === "FEDERAL_NOT_IN_SCOPE").length,
};
console.log(
  `\n  ${candidacies.length} candidacies in the identity registry; ${inScope} are the Secretary of State's to hold`,
);
for (const [k, v] of Object.entries(tally)) console.log(`    ${k.padEnd(22)} ${v}`);
console.log(`    ${"records written".padEnd(22)} ${records.length}`);

const split = computeSplit(records, inScope);
const snapshot: StateMoneySnapshot = {
  formatVersion: 1,
  collectedAt: AS_OF,
  cycle: YEAR,
  split,
  byJurisdiction: {
    AZ: { inScope, filed: split.filed, noReports: split.noReportsOnFile, lead: split.lead },
  },
  records,
};

const candidate = stateCampaignFinanceCandidate({
  jurisdiction: "AZ",
  snapshot,
  rawBodies: officialRawBodies,
  requestedUrl: `${BASE}${SUMMARY_PATH}`,
  finalUrl: `${BASE}${SUMMARY_PATH}`,
  retrievedAt: new Date().toISOString(),
  query: `Union of the official 2025-2026 active, less-active, and officeholder filters; ${summaryRows.length} summary rows in ${entities.size} entities`,
  paginationComplete: perQuery.every((query) => query.rows >= 0),
  declaredTotal: null,
  excludedFacts: routeGaps.map((gap) => ({
    key: `committee:${gap.entityId}`,
    code: "ITEMIZED_RECONCILIATION_HELD",
    detail: `${gap.committeeName}: ${gap.reason}`,
    record: gap,
  })),
});
candidateSubmitted = true;
const outcome = await processRegisteredManualCandidate(
  new PostgresRoutineDataStore(),
  "az-sos-campaign-finance",
  candidate,
  candidate.retrieval.retrievedAt,
);
printSourceRunnerReceipt("az-sos-campaign-finance", candidate, outcome);
if (!outcome.promoted) throw new Error(`AZ campaign-finance promotion refused: ${outcome.candidate.failureCode}`);
console.log(`promoted ${outcome.promoted.versionId}; no tracked runtime artifact was written`);
}

try {
  await main();
} catch (error) {
  if (!candidateSubmitted) {
    const attemptedAt = new Date().toISOString();
    const failed = failedAcquisitionCandidate({
      sourceId: "az-sos-campaign-finance",
      recordClass: "STATE_CAMPAIGN_FINANCE",
      scope: "US-AZ:campaign-finance:2026",
      requestedUrl: `${BASE}${SUMMARY_PATH}`,
      attemptedAt,
      failureDetail: error instanceof Error ? error.message : String(error),
      parserVersion: "az-campaign-finance/2",
    });
    const outcome = await processRegisteredManualCandidate(new PostgresRoutineDataStore(), "az-sos-campaign-finance", failed, attemptedAt);
    printSourceRunnerReceipt("az-sos-campaign-finance", failed, outcome);
  }
  throw error;
}
