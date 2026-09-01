/**
 * **ARIZONA STATE CAMPAIGN MONEY, FOR THE 85701 AND 85641 BALLOT.**
 * (Session C2, 2026-08-31. RULING 126, RULING 205, RULING 207, RULING 224.)
 *
 * Produces `data/funding/state-money-az-2026.json` — a `StateMoneySnapshot`
 * the ballot page already knows how to load — and
 * `data/campaign-finance/az-seethemoney-2026-reconciliation.json`, which is the
 * MEASUREMENT that licenses every figure in it.
 *
 * ## What the record said before this walk, and what was actually wrong
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
 * ## THE FILTER DEFAULTS ARE THE OTHER HALF OF THE SAFETY BAR
 *
 * The portal's default view returns 255 entities. `IsLessActive=true` returns
 * 716 — 461 more. `ShowOfficeHolder=true` returns a further disjoint 16. A
 * candidate behind either flag, asked for with the defaults, comes back as
 * nothing, and recording that as *no reports on file* would be an absence
 * manufactured by our own query. So the universe walked here is the UNION of
 * all three, and a sourced absence means the union held nothing.
 *
 *   pnpm money:az              write the snapshot and the reconciliation
 *   pnpm money:az --dry        walk and report, write nothing
 */
import { writeFileSync, readFileSync } from "node:fs";
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
  azNamesAgree,
  azOfficeKey,
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
  type RegisterRow,
  type SummaryRow,
} from "../lib/sources/az-seethemoney/index.ts";
import { computeSplit, type StateMoneySnapshot } from "../lib/funding/state-money.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const AS_OF = today();
const YEAR = CYCLE_2026.cycle;
const DRY = process.argv.includes("--dry");
const SPACING_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
        else if (stage === 1 && code === 331) ctl.write("PASS seanj22@gmail.com\r\n"), (stage = 2);
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

/* -------------------------------------------------------------------------
 * THE WALK
 * ------------------------------------------------------------------------- */

interface Candidacy {
  id: string;
  contestId: string;
  familyName: string;
  givenName: string;
}
interface Contest {
  id: string;
  title: string;
}

const ballot = JSON.parse(readFileSync(join(ROOT, "data", "ballot", "az-pima-2026.json"), "utf8")) as {
  contests: Contest[];
  candidacies: Candidacy[];
};
const contestById = new Map(ballot.contests.map((c) => [c.id, c]));

console.log(`Arizona state campaign money — ${AS_OF}${DRY ? " (dry run)" : ""}`);
console.log(`  agency: ${AGENCY}`);

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
const reportingPeriods = parseReportingPeriods(await ftpGet(`${FTP_DIR}/ReportingPeriods.txt`));
const nextDue = nextFilingDue(reportingPeriods, AS_OF);
console.log(`  register: ${register.size} committees   calendar: ${reportingPeriods.length} reporting periods`);
console.log(`  next filing deadline after ${AS_OF}: ${nextDue ? `${nextDue.reportName} (${nextDue.filingPeriodEndDate})` : "NONE STATED in the published calendar"}`);

/*
 * WHICH COMMITTEES THIS BALLOT COULD POSSIBLY BE ABOUT.
 * The itemised ledger is read only for these — not to save effort, but because
 * every itemised row carries a contributor's name, occupation and employer
 * (RULING 167), and reading 857 committees' donor lists to answer a question
 * about 49 candidacies would be collecting far more than the minimum.
 */
const candidateOfInterest = new Set<number>();
for (const cand of ballot.candidacies) {
  const contest = contestById.get(cand.contestId);
  if (!contest || azOfficeKey(contest.title) === null) continue;
  const ballotName = `${cand.givenName} ${cand.familyName}`.trim();
  for (const e of entities.values()) {
    if (azNamesAgree(e.candidateDisplay, ballotName)) candidateOfInterest.add(e.entityId);
  }
}
console.log(`  committees plausibly on this ballot: ${candidateOfInterest.size} of ${entities.size}`);

/* RUNG 7 — the itemised ledger, aggregated. The rows themselves never land. */
const detail = new Map<number, { income: DetailAggregate; expense: DetailAggregate }>();
let walked = 0;
for (const entityId of candidateOfInterest) {
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
        detailQuery({ entityId, kind, startYear: CYCLE_2026.startYear, endYear: CYCLE_2026.endYear, start, length: 2000 }),
        dataTablesBody(DETAIL_COLUMNS, { start, length: 2000, orderColumn: 2, orderDir: "desc" }),
      );
      const parsed = parseTableResponse<{ Amount?: number | null }>(text, `GetNEWDetailedTableData ${kind} ${entityId}`);
      if (total === null) total = parsed.recordsTotal;
      let sum = 0;
      for (const row of parsed.data) sum += row.Amount ?? 0;
      per[kind].count += parsed.data.length;
      per[kind].sum = Math.round((per[kind].sum + sum) * 100) / 100;
      start += parsed.data.length;
      if (parsed.data.length === 0 || start >= total) break;
    }
  }
  detail.set(entityId, per);
  walked += 1;
  if (walked % 10 === 0) console.log(`  ledger ${walked}/${candidateOfInterest.size}`);
}

/* THE RECONCILIATION, per committee, with its denominator. */
const reconciledEntityIds = new Set<number>();
const reconciliationRows: {
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
}[] = [];
for (const entityId of candidateOfInterest) {
  const e = entities.get(entityId)!;
  const ledger = detail.get(entityId);
  const verdict = reconcileEntity(e, ledger);
  if (verdict.agrees) reconciledEntityIds.add(entityId);
  reconciliationRows.push({
    entityId,
    committeeName: e.committeeName,
    candidate: e.candidateDisplay,
    summaryIncome: e.income,
    summaryExpense: e.expense,
    itemisedIncome: ledger?.income.sum ?? 0,
    itemisedExpense: ledger?.expense.sum ?? 0,
    incomeTransactions: ledger?.income.count ?? 0,
    expenseTransactions: ledger?.expense.count ?? 0,
    agrees: verdict.agrees,
    note: verdict.note,
  });
}
console.log(
  `  reconciled against the publisher's own itemised ledger: ${reconciledEntityIds.size} of ${candidateOfInterest.size} committees`,
);

/* NORMALIZE. */
const { records, states } = normalizeAz({
  corpus: { summaryRows, detail, register, reportingPeriods, collectedAt: AS_OF },
  candidacies: ballot.candidacies,
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
console.log(`\n  ${ballot.candidacies.length} candidacies on this ballot; ${inScope} are the Secretary of State's to hold`);
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
  upsertAz(snapshot, (json) => writeFileSync(join(ROOT, "data", "funding", "state-money-az-2026.json"), json));
  writeFileSync(
    join(ROOT, "data", "campaign-finance", "az-seethemoney-2026-reconciliation.json"),
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
          registerRows: register.size,
          note:
            "The portal's DEFAULT view is IsLessActive=false and it hides most of the register. " +
            "A sourced absence here means the union of all three settings held nothing.",
        },
        reconciliation: {
          committeesTested: reconciliationRows.length,
          agreed: reconciledEntityIds.size,
          disagreed: reconciliationRows.length - reconciledEntityIds.size,
          rows: reconciliationRows,
        },
        readerStates: { inScope, tally, perCandidacy: states },
        nextFilingDeadline: nextDue,
      },
      null,
      1,
    ) + "\n",
  );
  console.log("\n  wrote data/funding/state-money-az-2026.json");
  console.log("  wrote data/campaign-finance/az-seethemoney-2026-reconciliation.json");
}
