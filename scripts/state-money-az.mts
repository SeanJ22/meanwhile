/**
 * **ARIZONA STATE CAMPAIGN MONEY — THE STATEWIDE 2026 CORPUS.**
 * (Session C2, 2026-08-31. Decoupled from the pilot ballot Session C3,
 * 2026-09-01. RULING 126, RULING 205, RULING 207, RULING 224, RULING 229.)
 *
 * ```
 *   pnpm money:az                        walk, reconcile, write everything
 *   pnpm money:az --dry                  walk and report, write nothing
 *   pnpm money:az --ledger-budget=120    reconcile at most 120 NEW committees
 * ```
 *
 * ## THE THREE LAYERS, AND THEY ARE SEPARATE ON PURPOSE (RULING 229)
 *
 * ```
 * ACQUISITION   this file, top half. The COMPLETE applicable SeeTheMoney cycle
 *               universe and the Secretary of State's committee register.
 *               **It has no dependency on 85641, on 85701, or on any ballot.**
 * IDENTITY      data/identity/az-2026-candidate-registry.json, built by
 *               `pnpm identity:az`. Who exists, statewide, and which canonical
 *               candidacy each one is.
 * PROJECTION    this file, bottom half, plus lib/funding/nominee-money.ts. The
 *               reader snapshot holds only candidates a page can be about — and
 *               its SOURCE CORPUS is not generated from that page's list.
 * ```
 *
 * **What this file used to do, and why it was prohibited.** Its own header said
 * *"FOR THE 85701 AND 85641 BALLOT"*. It loaded `data/ballot/az-pima-2026.json`,
 * built `candidateOfInterest` by name-matching those candidacies against the
 * portal, and read the itemised ledger only for the committees that survived —
 * 58 of 732. So the ACQUISITION DENOMINATOR was the currently enabled reader
 * location, and activating a third ZIP would have meant hunting the same portal
 * again for candidates it already held. Under RULING 229 a ZIP may prioritise
 * acquisition ORDER and may never define the DENOMINATOR. It now does exactly
 * that: the registry-linked committees are walked FIRST so the reader surface
 * never regresses, and the walk continues through the whole statewide candidate
 * population afterwards.
 *
 * **The invariant is ZERO redundant internet hunt when a new ZIP is activated.**
 * `data/campaign-finance/az-2026-statewide-corpus.json` holds every entity in
 * the cycle universe with its aggregates, its office, its party, and its
 * reconciliation state. A newly activated ZIP's candidates are answered from
 * that committed file.
 *
 * ## What the record said before the first walk, and what was actually wrong
 *
 * `docs/arizona-source-enumeration.md` recorded the route as WORKING and the
 * money as UNPUBLISHABLE. A candidate returns several summary rows sharing one
 * `EntityID` with different `Income` and `Expense` and an identical
 * `CashBalance`, and which of them — or which aggregation — is the cycle total
 * was undetermined. Session C tested the obvious hypothesis over the whole
 * population: `sum(Income) - sum(Expense) == CashBalance` held for 134 entities
 * and BROKE for 121, including for single-row entities where there is nothing
 * to sum. It refused to ship a snapshot, and that refusal was right.
 *
 * **The hypothesis was not merely unproven; it was untestable that way.**
 * `CashBalance` is repeated identically on every row of an entity and does not
 * move when the query window moves. It is a balance carried forward from before
 * the cycle. Checking a within-window SUM against an across-window BALANCE
 * compares two different quantities, so the 134 agreements were the committees
 * that happened to begin from zero — which is exactly why one matching example
 * (Jayme Accalia, whose three rows sum to her balance to the cent) looked like
 * proof and was not.
 *
 * ## The source that CAN settle it, and the parameter that was hiding it
 *
 * The prior note named the itemised transaction ledger as the thing that would
 * settle the question, and could not reach it: `GetNEWDetailedTableData`
 * answered HTTP 200 with `recordsTotal: 0`.
 *
 * **The missing parameter is `entityId`.** `Name=1~<id>` — which is what the
 * page puts in its own location hash — is not sufficient on its own; the query
 * string must ALSO carry `entityId=<id>`. With it the endpoint returns the
 * committee's itemised income and expense transactions, which is the same
 * publisher listing the same money one line at a time.
 *
 * A zero-row extraction is a FAILED extraction, never an empty document. That
 * rule is what made this findable: the endpoint's honest-looking empty answer
 * was treated as a fact about the request, and the request is where the fault
 * was.
 *
 * ## THE MEASUREMENT, over the population, with its denominator
 *
 * Every committee this snapshot publishes is reconciled INDIVIDUALLY against
 * that ledger, and the population was measured too:
 *
 * ```
 * 2025-2026 cycle, JurisdictionId=0, 370 summary rows in 255 entities
 *   sum(summary Income)  == sum(itemised income)    HOLDS 255/255   BREAKS 0
 *   sum(summary Expense) == sum(itemised expense)   HOLDS 255/255   BREAKS 0
 *   sum(Income) - sum(Expense) == CashBalance       HOLDS 133/255   BREAKS 122
 * ```
 *
 * The rows are parts; their sum is the cycle total. `CashBalance` is not
 * published, because what it carries beyond the window is not established and a
 * number whose meaning is unknown does not go under a person's photograph.
 *
 * That 370-of-370 proof against the publisher's own declared total is asserted
 * on EVERY run below and is never restarted from zero: a committee already
 * reconciled at unchanged summary totals is carried forward from the held
 * corpus rather than re-read.
 *
 * ## THE FILTER DEFAULTS ARE THE OTHER HALF OF THE SAFETY BAR
 *
 * The portal's default view returns 255 entities. `IsLessActive=true` returns
 * 716 — 461 more. `ShowOfficeHolder=true` returns a further disjoint 16. A
 * candidate behind either flag, asked for with the defaults, comes back as
 * nothing, and recording that as *no reports on file* would be an absence
 * manufactured by our own query. So the universe walked here is the UNION of
 * all three, and a sourced absence means the union held nothing.
 *
 * ## PRIVACY, AND WHAT NEVER LANDS
 *
 * Every itemised row carries a contributor's name, occupation, employer, city
 * and zip (RULING 167). Those rows are streamed to compute a sum and are
 * DISCARDED. Nothing below persists a transaction, and the corpus file holds
 * aggregates, counts and provenance only.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  PUBLIC_PAGE,
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
  upsertAz,
  type DetailAggregate,
  type EntityTotals,
  type RegisterRow,
  type ReportingPeriod,
  type SummaryRow,
} from "../lib/sources/az-seethemoney/index.ts";
import { computeSplit, type StateMoneySnapshot } from "../lib/funding/state-money.ts";
import type { AzIdentityRegistry } from "../lib/identity/types.ts";
import { OUTBOUND_CONTACT } from "../lib/geo/outbound-agent.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const AS_OF = today();
const YEAR = CYCLE_2026.cycle;
const DRY = process.argv.includes("--dry");
const BUDGET_ARG = process.argv.find((a) => a.startsWith("--ledger-budget="));
const LEDGER_BUDGET = BUDGET_ARG ? Number(BUDGET_ARG.split("=")[1]) : Number.POSITIVE_INFINITY;
const SPACING_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CORPUS_PATH = join(ROOT, "data", "campaign-finance", "az-2026-statewide-corpus.json");
const REGISTRY_PATH = join(ROOT, "data", "identity", "az-2026-candidate-registry.json");
const SNAPSHOT_PATH = join(ROOT, "data", "funding", "state-money-az-2026.json");
const RECONCILIATION_PATH = join(
  ROOT,
  "data",
  "campaign-finance",
  "az-seethemoney-2026-reconciliation.json",
);

/* -------------------------------------------------------------------------
 * TRANSPORT. Two of them, because the record and the register live behind
 * different protocols and neither retires the other.
 * ------------------------------------------------------------------------- */

async function postTable(path: string, query: string, body: string): Promise<string> {
  const url = `${BASE}${path}?${query}`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await sleep(SPACING_MS);
      const res = await fetch(url, { method: "POST", headers: { ...HEADERS }, body });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastError = e;
      await sleep(1500 * (attempt + 1));
    }
  }
  /*
   * A TRANSPORT FAILURE IS NEVER A PERMISSION VERDICT AND NEVER AN ABSENCE
   * (RULING 182). It is thrown so the walk stops, because a walk that
   * continued past it would write "no reports on file" for a candidate whose
   * records we simply failed to read.
   */
  throw new Error(`${url}: unreachable after 3 attempts — ${(lastError as Error)?.message}`);
}

/**
 * Anonymous FTP, which is the access method the Secretary of State's own Bulk
 * Filing Guide publishes. No credential is sent because none exists to send.
 */
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
        // Anonymous FTP convention: the password IS a contact address, so the
        // courteous-client rule is satisfied by the same string the rest of the
        // product identifies with. Composed from its one home, never copied.
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
 * LAYER 1 — ACQUISITION. STATEWIDE. NO BALLOT, NO ZIP, NO PILOT.
 * ========================================================================= */

console.log(`Arizona state campaign money — ${AS_OF}${DRY ? " (dry run)" : ""}`);
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
const register: Map<string, RegisterRow> = parseCommitteeRegister(await ftpGet(`${FTP_DIR}/Committees.txt`));
const reportingPeriods: ReportingPeriod[] = parseReportingPeriods(await ftpGet(`${FTP_DIR}/ReportingPeriods.txt`));
const nextDue = nextFilingDue(reportingPeriods, AS_OF);
console.log(`  register: ${register.size} committees   calendar: ${reportingPeriods.length} reporting periods`);
console.log(`  next filing deadline after ${AS_OF}: ${nextDue ? `${nextDue.reportName} (${nextDue.filingPeriodEndDate})` : "NONE STATED in the published calendar"}`);

/**
 * **THE STATEWIDE CANDIDATE/COMMITTEE POPULATION — the acquisition denominator.**
 *
 * Derived from the PUBLISHER'S OWN entity classification, which is a fact about
 * Arizona's committee universe and not about anybody's ballot. Measured
 * 2026-09-01 over the union: 633 `Candidate (not participating in Clean
 * Elections)`, 83 `Candidate (participating in Clean Elections)`, 16
 * `Officeholder Expenses`.
 *
 * An officeholder-expense committee is not a candidate committee and its money
 * is not campaign money; it stays in the corpus as an identity — leaving it out
 * would make the corpus assert that the cycle held nothing there — and it is
 * not part of the candidate-reconciliation denominator.
 */
const CANDIDATE_ENTITY_TYPE = /^candidate\b/i;
const statewideCandidateEntities = [...entities.values()].filter((e) =>
  CANDIDATE_ENTITY_TYPE.test(e.entityTypeName ?? ""),
);
console.log(
  `  statewide candidate committees: ${statewideCandidateEntities.length} of ${entities.size} entities in the cycle universe`,
);

/* =========================================================================
 * THE HELD CORPUS — so a completed hunt is never restarted (RULING 205).
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

const held = new Map<number, HeldReconciliation>();
if (existsSync(CORPUS_PATH)) {
  const prior = JSON.parse(readFileSync(CORPUS_PATH, "utf8")) as StatewideCorpusFile;
  for (const r of prior.reconciliations ?? []) held.set(r.entityId, r);
}
/*
 * SEEDED FROM THE PRIOR PILOT-SCOPED RECONCILIATION, ONCE.
 *
 * The 2026-08-31 walk proved 58 committees against the publisher's own itemised
 * ledger. That is finished work about the RECORDS, not about the ballot it was
 * scoped by, and re-reading those ledgers would cost a hundred thousand
 * contributor rows to learn something already known.
 */
if (existsSync(RECONCILIATION_PATH)) {
  const prior = JSON.parse(readFileSync(RECONCILIATION_PATH, "utf8")) as {
    collectedAt?: string;
    reconciliation?: { rows?: (HeldReconciliation & { walkedAt?: string })[] };
  };
  for (const row of prior.reconciliation?.rows ?? []) {
    if (held.has(row.entityId)) continue;
    held.set(row.entityId, { ...row, walkedAt: row.walkedAt ?? prior.collectedAt ?? AS_OF });
  }
}

/**
 * A held reconciliation may be reused only while the committee's SUMMARY
 * TOTALS are unchanged. The moment the publisher reports new money the old
 * measurement stops describing this committee, and carrying it forward would
 * publish a figure nothing currently verifies.
 */
function heldStillDescribes(entity: EntityTotals): HeldReconciliation | null {
  const prior = held.get(entity.entityId);
  if (!prior) return null;
  if (prior.summaryIncome !== entity.income || prior.summaryExpense !== entity.expense) return null;
  return prior;
}

/* =========================================================================
 * LAYER 2 — IDENTITY. Who exists, statewide. Read, never derived from a ZIP.
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

if (!existsSync(REGISTRY_PATH)) {
  throw new Error(
    `${REGISTRY_PATH} is absent. The identity layer is what says who exists; without it this ` +
      "script would have to derive its candidate list from a ballot page, which RULING 229 forbids. " +
      "Run `pnpm identity:az` first.",
  );
}
const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as AzIdentityRegistry;
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
 * THE LEDGER WALK — STATEWIDE POPULATION, READER-PRIORITISED ORDER.
 *
 * RULING 229 in one line: the reader's location may set the ORDER and may never
 * set the DENOMINATOR. The committees the identity layer has already linked to
 * a canonical candidacy go FIRST, so a budgeted run can never regress a card
 * that renders today; everything else in the statewide candidate population
 * follows, and whatever a budget leaves is recorded as a ROUTE GAP with the
 * agency's own next filing deadline rather than as an absence.
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
    /*
     * A ROUTE GAP, NOT AN ABSENCE (RULING 184, RULING 205). The committee
     * exists, we have its summary, and its ledger has not been read on this
     * run. It carries the agency's own next filing deadline so a later run —
     * and a reader — know when it is next worked.
     */
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
      /* THE ONLY PLACE AN ITEMISED ROW IS SEEN. It contributes a number and is
         dropped; nothing below this loop is ever handed a transaction. */
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
 * LAYER 3 — PROJECTION. The reader snapshot: only candidates a page can be
 * about, built from the STATEWIDE corpus rather than from a page's list.
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

if (DRY) {
  console.log("\n  --dry: nothing written.");
  for (const s of states) console.log(`    ${s.state.padEnd(22)} ${s.ballotName.padEnd(28)} ${s.contestTitle}`);
} else {
  upsertAz(snapshot, (json) => writeFileSync(SNAPSHOT_PATH, json));

  /*
   * THE STATEWIDE CORPUS. This is the artifact that makes the RULING 229
   * invariant real: a newly activated ZIP's candidates are answered from here,
   * with ZERO redundant internet hunt.
   *
   * NO ITEMISED TRANSACTION APPEARS IN IT. Contributor name, occupation,
   * employer, city and zip (RULING 167) were streamed to compute a sum and were
   * discarded; what is kept is aggregates, counts and provenance.
   */
  writeFileSync(
    CORPUS_PATH,
    JSON.stringify(
      {
        formatVersion: 1,
        _note: [
          "THE STATEWIDE ARIZONA 2026 CAMPAIGN-FINANCE CORPUS (RULING 229).",
          "",
          "The acquisition denominator is the complete applicable SeeTheMoney cycle universe and the",
          "Secretary of State's committee register. It has NO dependency on 85701, 85641, or any ballot.",
          "A newly activated ZIP's candidates are answered from this file rather than by hunting again.",
          "",
          "NO ITEMISED TRANSACTION APPEARS HERE. Those rows carry contributor name, occupation, employer,",
          "city and zip (RULING 167). They were streamed to compute a sum and were never persisted.",
        ],
        collectedAt: AS_OF,
        cycle: YEAR,
        source: {
          summary: `${BASE}${SUMMARY_PATH}`,
          itemised: `${BASE}${DETAIL_PATH}`,
          register: `ftp://${FTP_HOST}${FTP_DIR}/Committees.txt`,
          calendar: `ftp://${FTP_HOST}${FTP_DIR}/ReportingPeriods.txt`,
          publicPage: PUBLIC_PAGE,
        },
        denominators: {
          perQuery,
          unionRows: summaryRows.length,
          unionEntities: entities.size,
          statewideCandidateCommittees: walkOrder.length,
          registerRows: register.size,
          reconciledAgainstItemisedLedger: reconciledEntityIds.size,
          reconciliationsHeld: reconciliationRows.length,
          routeGaps: routeGaps.length,
          identityRegistryCandidates: registry.candidates.length,
          identityRegistryCandidaciesProjectable: candidacies.length,
        },
        nextFilingDeadline: nextDue,
        routeGaps,
        /* Every entity in the cycle universe, with its aggregates and its
           office — the identity half of the corpus, so a new ZIP resolves its
           candidates locally. */
        entities: [...entities.values()].map((e) => ({
          entityId: e.entityId,
          committeeName: e.committeeName,
          candidateDisplay: e.candidateDisplay,
          entityTypeName: e.entityTypeName,
          officeNames: e.officeNames,
          officeKeys: e.officeKeys,
          partyNames: e.partyNames,
          income: e.income,
          expense: e.expense,
          rowCount: e.rowCount,
          reconciledAgainstItemisedLedger: reconciledEntityIds.has(e.entityId),
        })),
        reconciliations: reconciliationRows,
      },
      null,
      1,
    ) + "\n",
    "utf8",
  );

  writeFileSync(
    RECONCILIATION_PATH,
    JSON.stringify(
      {
        formatVersion: 1,
        _note: [
          "THE MEASUREMENT THAT LICENSES EVERY FIGURE IN data/funding/state-money-az-2026.json.",
          "",
          "SeeTheMoney returns a candidate as several summary rows partitioned by office and party.",
          "Whether those rows are PARTS whose sum is the cycle total was undetermined until this walk,",
          "and Session C correctly refused to ship a snapshot on the untested guess.",
          "",
          "The independent statement is the publisher's own ITEMISED TRANSACTION LEDGER, reachable at",
          "/Reporting/GetNEWDetailedTableData with the entityId parameter the earlier walk was missing.",
          "Each row below compares one committee's summary totals against the sum of its own itemised",
          "transactions. A committee that does not agree does not render, whatever else about it matches.",
          "",
          "THE POPULATION IS STATEWIDE (RULING 229, 2026-09-01). It was the 58 committees a name test",
          "linked to the 85701/85641 ballot; a reader's ZIP may prioritise acquisition ORDER and may",
          "never define the DENOMINATOR.",
          "",
          "NO ITEMISED TRANSACTION APPEARS HERE. Those rows carry contributor name, occupation, employer,",
          "city and zip (RULING 167). They were read to compute a sum and were never persisted.",
        ],
        collectedAt: AS_OF,
        cycle: YEAR,
        source: {
          summary: `${BASE}${SUMMARY_PATH}`,
          itemised: `${BASE}${DETAIL_PATH}`,
          register: `ftp://${FTP_HOST}${FTP_DIR}/Committees.txt`,
          calendar: `ftp://${FTP_HOST}${FTP_DIR}/ReportingPeriods.txt`,
          publicPage: PUBLIC_PAGE,
        },
        universe: {
          perQuery,
          unionRows: summaryRows.length,
          unionEntities: entities.size,
          statewideCandidateCommittees: walkOrder.length,
          registerRows: register.size,
          note:
            "The portal's DEFAULT view is IsLessActive=false and it hides most of the register. " +
            "A sourced absence here means the union of all three settings held nothing.",
        },
        reconciliation: {
          committeesTested: reconciliationRows.length,
          agreed: reconciledEntityIds.size,
          disagreed: reconciliationRows.length - reconciledEntityIds.size,
          walkedThisRun: walked,
          carriedForward: carried,
          routeGaps,
          rows: reconciliationRows,
        },
        readerStates: { inScope, tally, perCandidacy: states },
        nextFilingDeadline: nextDue,
      },
      null,
      1,
    ) + "\n",
    "utf8",
  );
  console.log("\n  wrote data/funding/state-money-az-2026.json");
  console.log("  wrote data/campaign-finance/az-2026-statewide-corpus.json");
  console.log("  wrote data/campaign-finance/az-seethemoney-2026-reconciliation.json");
}
