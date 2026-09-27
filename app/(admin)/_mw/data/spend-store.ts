import "server-only";

/**
 * **WHAT THE PAID WORK PRODUCED, AGGREGATED WHERE IT IS STORED.** (Admin
 * redesign, 2026-09-23 — Fleet · Money, cost of work.)
 *
 * Every paid Scout attempt writes a typed result that records what it produced
 * (`ScoutResult.outcome`), whether the executor refused its finish
 * (`refusal`), and what it cost (`usd`) — the same dollars the charge ledger
 * holds for that attempt (measured 2026-09-23: 2,166 attempts agree to the
 * cent; the ledger's only extra Scout rows are the hourly prompt-cache
 * pre-warm, which belongs to no attempt). The whole result log is 7.6 MB, and
 * database transfer is billed, so this reads aggregates computed by the
 * database in one read-only transaction under a statement limit — never the
 * log itself.
 *
 * ```
 *   outcomes   attempts and dollars by the state the subject names and what
 *              each produced, a refused finish counted as REFUSED
 *   refusals   why each refused finish was refused, by its first reason
 *   top        the six costliest assignments in each state, with what they
 *              produced
 *   ledger     the reconciliation: attempts on both records, on one only
 *   purpose    paid charges by what each recorded it was for — record class,
 *              question, whether an owner Send reached it, what it came to —
 *              and the rows that predate those fields, named as such (MW-013)
 *   ladder     the class each result started on, and every model escalation
 *              (or refused one) with its reason, evidence and combined cost
 *              (MW-031/MW-033, 2026-09-25)
 * ```
 *
 * Proof and test runs (MW-024) are real money: their charges stay in every
 * ledger figure and in `purpose`, marked. Their Scout attempts are left out of
 * `outcomes`, `refusals` and `top` — what production produced — and counted
 * on their own in `testAttempts`.
 *
 * A failure is thrown to the loader, which renders the section as unread —
 * never as nothing spent.
 */
import { Pool } from "@neondatabase/serverless";

import { AUTONOMOUS_FLEET_PROOF_PROJECT } from "@/lib/control-plane/cost.ts";
import { CONTROL_PLANE_URL_VAR } from "@/lib/control-plane/repository/pg-store.ts";
import type { EscalationFact, LadderFacts } from "@/lib/control-plane/admin-view/model-ladder-view.ts";

import { ADMIN_READ_DEADLINE_MS, lateWords, sharedRead } from "./shared-read.ts";

export const SPEND_STORE_STATEMENT_TIMEOUT_MS = 6_000;

export interface OutcomeRow {
  /** Two-letter state the attempt's subject names, or "" when it names none. */
  readonly state: string;
  /** A Scout outcome, or REFUSED for a finish the executor refused. */
  readonly outcome: string;
  readonly attempts: number;
  readonly usd: number;
  readonly unpriced: number;
  readonly first: string | null;
  readonly last: string | null;
}

export interface RefusalRow {
  readonly state: string;
  readonly code: string;
  readonly count: number;
  readonly detail: string | null;
}

export interface TopWorkRow {
  readonly state: string;
  readonly id: string;
  readonly subject: string | null;
  readonly recordClass: string | null;
  readonly attempts: number;
  readonly usd: number;
  readonly refused: number;
  readonly outcomes: Readonly<Record<string, number>>;
  readonly last: string | null;
}

export interface LedgerCheck {
  readonly onBoth: number;
  readonly resultsOnly: number;
  readonly ledgerOnly: number;
  readonly ledgerOnlyUsd: number;
  readonly ledgerOnlyPrewarm: number;
  /** Summed absolute difference in dollars over the attempts on both records. */
  readonly differenceUsd: number;
  readonly lastPaidAt: string | null;
}

/**
 * One group of paid charges by what they were for (MW-013), as the ledger row
 * itself records it. `kept` says whether the row carries its purpose: KEPT; or
 * BEFORE the first row that did (recorded before purpose was kept); or
 * NOT_KEPT — written since, by a path that does not record purpose.
 */
export interface PurposeRow {
  readonly state: string;
  readonly kept: "KEPT" | "BEFORE" | "NOT_KEPT";
  readonly recordClass: string | null;
  readonly question: string | null;
  /** The charge named at least one owner Send its work belonged to. */
  readonly assigned: boolean;
  readonly resultKind: string | null;
  /** A proof or test run's charge (MW-024). */
  readonly test: boolean;
  readonly role: string;
  readonly charges: number;
  readonly usd: number;
  readonly unpriced: number;
  readonly first: string | null;
  readonly last: string | null;
}

/** Proof and test runs' paid Scout attempts: left out of `outcomes` and `top`, and counted here (MW-024). */
export interface TestAttempts {
  readonly attempts: number;
  readonly usd: number;
}

export interface SpendFacts {
  readonly asOf: string;
  /** Production attempts only: proof and test runs are in `testAttempts`. */
  readonly outcomes: readonly OutcomeRow[];
  readonly refusals: readonly RefusalRow[];
  /** The six costliest assignments in each state, so the six costliest overall are among them. Production only. */
  readonly top: readonly TopWorkRow[];
  readonly ledger: LedgerCheck;
  /** Paid charges by what they were for, every charge on record. */
  readonly purpose: readonly PurposeRow[];
  readonly testAttempts: TestAttempts;
  /** The model ladder (MW-031/MW-033): the class each result started on, and every escalation on record. */
  readonly ladder: LadderFacts;
}

// A CASE, not an AND: SQL does not promise to short-circuit, and jsonb_array_length of a null refusal throws.
const REFUSED = `(case when jsonb_typeof(record->'refusal') = 'array' then jsonb_array_length(record->'refusal') else 0 end) > 0`;

/*
 * The state a result's subject names: a candidacy or jurisdiction key
 * (`nj:2026:…`), a ballot key (`ballot-az-pima:…`) or an OCD id
 * (`…/state:nh/…`). A subject naming no state is "" — its own row, never
 * folded into a state.
 */
const STATE_OF = `case
    when record->>'subjectId' ~ '^[a-z]{2}:' then substr(record->>'subjectId', 1, 2)
    when record->>'subjectId' ~ '^ballot-[a-z]{2}-' then substr(record->>'subjectId', 8, 2)
    when record->>'subjectId' ~ 'state:[a-z]{2}' then substring(record->>'subjectId' from 'state:([a-z]{2})')
    else '' end`;

const OUTCOMES = ["ROUTE_CANDIDATE", "EVIDENCE_FOUND", "NEEDS_ADAPTER", "BLOCKED", "HUMAN_REQUIRED", "NO_PROGRESS"] as const;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

const OUTCOME_COLUMNS = OUTCOMES.map((o) => `count(*) filter (where record->>'outcome' = '${o}' and not (${REFUSED}))::int as "${o}"`).join(",\n            ");
const OUTCOME_NAMES = OUTCOMES.map((o) => `"${o}"`).join(", ");

/*
 * MW-024: a charge from a proof or test run — marked so, or under a proof or
 * conformance project (`isNonProductionCost`, the same rule in words). Its
 * attempts' results are left out of what production produced; its dollars stay
 * in every total. The project names are code constants, never input.
 */
const TEST_CHARGE = `(coalesce(record->>'nonProduction', '') = 'true' or coalesce(record->>'project', '') ~ '^conformance(-|$)' or record->>'project' in ('control-plane-proof', '${AUTONOMOUS_FLEET_PROOF_PROJECT}'))`;
/** A Scout result from a proof run: a proof obligation id, or an attempt a test charge names ($1). */
const TEST_RESULT = `(coalesce(record->>'obligationId', '') like 'proof-%' or record->>'attemptId' = any($1::text[]))`;

/* The state a charge's body names — the result log's rule, on the charge's `jurisdiction`. */
const CHARGE_STATE_OF = STATE_OF.replaceAll("record->>'subjectId'", "record->>'jurisdiction'");

/* A charge that could reach a paid model or carries dollars: the Fleet's model-backed rule (`aggregateModelSpend`). */
const PAID_CHARGE = `(record->>'role' = 'SCOUT' or record->'cost'->>'inputTokens' is not null or record->'cost'->>'outputTokens' is not null or coalesce((record->'cost'->>'usd')::numeric, 0) > 0)`;

export async function readSpendFacts(connection: string, nowIso: string): Promise<SpendFacts> {
  const pool = new Pool({ connectionString: connection });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ");
    await client.query(`SET LOCAL statement_timeout = ${SPEND_STORE_STATEMENT_TIMEOUT_MS}`);

    /* The proof runs' attempts, read once: few, and every query below leaves them out of production. */
    const testRows = await client.query(`select coalesce(array_agg(distinct record->>'attemptId'), '{}') as ids from cp_log_costs where ${TEST_CHARGE}`);
    const testIds = ((testRows.rows[0] as Record<string, unknown> | undefined)?.ids ?? []) as string[];

    const outcomes = await client.query(
      `
      select ${STATE_OF} as st, case when ${REFUSED} then 'REFUSED' else record->>'outcome' end as outcome,
        count(*)::int as attempts,
        coalesce(sum((record->>'usd')::numeric), 0)::float8 as usd,
        count(*) filter (where record->>'usd' is null)::int as unpriced,
        min(record->>'startedAt') as first, max(record->>'startedAt') as last
      from cp_log_scout_results where not ${TEST_RESULT} group by 1, 2`,
      [testIds],
    );

    const testAttempts = await client.query(
      `select count(*)::int as attempts, coalesce(sum((record->>'usd')::numeric), 0)::float8 as usd from cp_log_scout_results where ${TEST_RESULT}`,
      [testIds],
    );

    const refusals = await client.query(
      `
      select ${STATE_OF} as st, record->'refusal'->0->>'code' as code, count(*)::int as n,
        max(left(record->'refusal'->0->>'detail', 160)) as detail
      from cp_log_scout_results where ${REFUSED} and not ${TEST_RESULT} group by 1, 2`,
      [testIds],
    );

    const top = await client.query(
      `
      select * from (
        select st, id, subject, record_class, attempts, usd, refused, ${OUTCOME_NAMES}, last,
          row_number() over (partition by st order by usd desc) as rk
        from (
          select ${STATE_OF} as st, record->>'obligationId' as id, max(record->>'subjectId') as subject,
            max(record->>'recordClass') as record_class, count(*)::int as attempts,
            coalesce(sum((record->>'usd')::numeric), 0)::float8 as usd,
            count(*) filter (where ${REFUSED})::int as refused,
            ${OUTCOME_COLUMNS},
            max(record->>'startedAt') as last
          from cp_log_scout_results where not ${TEST_RESULT} group by 1, 2
        ) g
      ) x where rk <= 6`,
      [testIds],
    );

    /* MW-013: what each paid charge was for, as the charge itself records it. */
    const purpose = await client.query(`
      with paid as (select record from cp_log_costs where ${PAID_CHARGE}),
        kept_since as (select min(record->>'recordedAt') as t from paid where record ? 'recordClass')
      select ${CHARGE_STATE_OF} as st,
        case when record ? 'recordClass' then 'KEPT'
          when (select t from kept_since) is null or record->>'recordedAt' < (select t from kept_since) then 'BEFORE'
          else 'NOT_KEPT' end as kept,
        record->>'recordClass' as record_class, record->>'question' as question,
        (case when jsonb_typeof(record->'assignmentKeys') = 'array' then jsonb_array_length(record->'assignmentKeys') else 0 end) > 0 as assigned,
        record->>'resultKind' as result_kind,
        ${TEST_CHARGE} as test,
        coalesce(record->>'role', '') as role,
        count(*)::int as charges,
        coalesce(sum((record->'cost'->>'usd')::numeric), 0)::float8 as usd,
        count(*) filter (where record->'cost'->>'usd' is null)::int as unpriced,
        min(record->>'recordedAt') as first, max(record->>'recordedAt') as last
      from paid group by 1, 2, 3, 4, 5, 6, 7, 8`);

    const ledger = await client.query(`
      with l as (
        select record->>'attemptId' as a, sum((record->'cost'->>'usd')::numeric) as usd,
          bool_or(record->>'routeId' = 'scout:prewarm') as prewarm
        from cp_log_costs where record->>'role' = 'SCOUT' group by 1
      ), r as (
        select record->>'attemptId' as a, (record->>'usd')::numeric as usd from cp_log_scout_results
      )
      select count(*) filter (where l.a is not null and r.a is not null)::int as on_both,
        count(*) filter (where l.a is null)::int as results_only,
        count(*) filter (where r.a is null)::int as ledger_only,
        coalesce(sum(l.usd) filter (where r.a is null), 0)::float8 as ledger_only_usd,
        count(*) filter (where r.a is null and l.prewarm)::int as ledger_only_prewarm,
        coalesce(sum(abs(coalesce(l.usd, 0) - coalesce(r.usd, 0))) filter (where l.a is not null and r.a is not null), 0)::float8 as difference_usd
      from l full outer join r on l.a = r.a`);

    const lastPaid = await client.query(`
      select max(record->>'recordedAt') as last from cp_log_costs where (record->'cost'->>'usd')::numeric > 0`);

    /*
     * The model ladder (MW-031/MW-033, 2026-09-25): the class each result
     * STARTED on — the class it moved up from, else its own — with results
     * recorded before the ladder counted apart; then every escalation, and
     * every refused one, newest first. Aggregates and six rows, never the log.
     */
    const startedOn = await client.query(`
      select case when record ? 'modelClass' then coalesce(record->>'escalatedFrom', record->>'modelClass') else 'BEFORE_LADDER' end as cls,
        count(*)::int as n
      from cp_log_scout_results group by 1`);
    const escalations = await client.query(`
      select count(*) filter (where record->>'escalatedFrom' is not null)::int as escalated,
        count(*) filter (where jsonb_typeof(record->'escalationRefused') = 'object')::int as refused
      from cp_log_scout_results`);
    const latestEscalations = await client.query(`
      select record->>'startedAt' as at, record->>'obligationId' as id, record->>'subjectId' as subject,
        coalesce(record->>'escalatedFrom', record->>'modelClass') as from_class,
        case when record->>'escalatedFrom' is not null then record->>'modelClass' end as to_class,
        record->>'escalationReason' as reason, record->>'escalationEvidence' as evidence,
        record->'escalationRefused'->>'code' as refused, record->>'usd' as usd,
        (select jsonb_agg(a->'usd') from jsonb_array_elements(case when jsonb_typeof(record->'modelAttempts') = 'array' then record->'modelAttempts' else '[]'::jsonb end) a) as attempts
      from cp_log_scout_results where record->>'escalationReason' is not null
      order by record->>'startedAt' desc limit 6`);

    // Each auditor step is already a separate cost-ledger attempt. Show its
    // transition here without adding those dollars to Scout or provider totals.
    const auditEscalations = await client.query(`
      select (count(*) over ())::int as total,
        w.record->>'endedAt' as at, w.record->>'workItemId' as id,
        w.record#>>'{auditContext,subjectId}' as subject,
        w.record#>>'{modelReview,escalation,from}' as from_model,
        w.record#>>'{modelReview,model}' as to_model,
        w.record#>>'{modelReview,escalation,reason}' as reason,
        w.record#>>'{result,verdict}' as verdict, w.record#>>'{cost,usd}' as usd
      from cp_log_worker_results w join cp_attempts a on a.id = w.record->>'attemptId'
      where w.record#>>'{modelReview,escalation,previousResultId}' is not null
        and a.value->>'outcome' = 'COMPLETED'
      order by w.record->>'endedAt' desc limit 6`);

    await client.query("ROLLBACK");

    const l = (ledger.rows[0] ?? {}) as Record<string, unknown>;
    const t = (testAttempts.rows[0] ?? {}) as Record<string, unknown>;
    return {
      asOf: nowIso,
      purpose: purpose.rows.map((r: Record<string, unknown>) => ({
        state: String(r.st ?? ""),
        kept: r.kept === "KEPT" || r.kept === "BEFORE" ? r.kept : "NOT_KEPT",
        recordClass: str(r.record_class),
        question: str(r.question),
        assigned: r.assigned === true,
        resultKind: str(r.result_kind),
        test: r.test === true,
        role: String(r.role ?? ""),
        charges: num(r.charges),
        usd: num(r.usd),
        unpriced: num(r.unpriced),
        first: str(r.first),
        last: str(r.last),
      })),
      testAttempts: { attempts: num(t.attempts), usd: num(t.usd) },
      outcomes: outcomes.rows.map((r: Record<string, unknown>) => ({
        state: String(r.st ?? ""),
        outcome: String(r.outcome ?? "UNRECORDED"),
        attempts: num(r.attempts),
        usd: num(r.usd),
        unpriced: num(r.unpriced),
        first: str(r.first),
        last: str(r.last),
      })),
      refusals: refusals.rows.map((r: Record<string, unknown>) => ({
        state: String(r.st ?? ""),
        code: String(r.code ?? "UNRECORDED"),
        count: num(r.n),
        detail: str(r.detail),
      })),
      top: top.rows.map((r: Record<string, unknown>) => ({
        state: String(r.st ?? ""),
        id: String(r.id ?? ""),
        subject: str(r.subject),
        recordClass: str(r.record_class),
        attempts: num(r.attempts),
        usd: num(r.usd),
        refused: num(r.refused),
        outcomes: Object.fromEntries(OUTCOMES.map((o) => [o, num(r[o])])),
        last: str(r.last),
      })),
      ledger: {
        onBoth: num(l.on_both),
        resultsOnly: num(l.results_only),
        ledgerOnly: num(l.ledger_only),
        ledgerOnlyUsd: num(l.ledger_only_usd),
        ledgerOnlyPrewarm: num(l.ledger_only_prewarm),
        differenceUsd: num(l.difference_usd),
        lastPaidAt: str((lastPaid.rows[0] as Record<string, unknown> | undefined)?.last),
      },
      ladder: {
        startedOn: startedOn.rows.map((r: Record<string, unknown>) => ({ modelClass: String(r.cls ?? "BEFORE_LADDER"), attempts: num(r.n) })),
        escalated: num((escalations.rows[0] as Record<string, unknown> | undefined)?.escalated) + num(auditEscalations.rows[0]?.total),
        escalationsRefused: num((escalations.rows[0] as Record<string, unknown> | undefined)?.refused),
        latest: [...latestEscalations.rows.map((r: Record<string, unknown>): EscalationFact => ({
          at: str(r.at),
          obligationId: String(r.id ?? ""),
          subjectId: str(r.subject),
          from: String(r.from_class ?? ""),
          to: str(r.to_class),
          reason: String(r.reason ?? ""),
          evidence: str(r.evidence),
          refused: str(r.refused),
          attemptsUsd: Array.isArray(r.attempts) ? (r.attempts as unknown[]).map((u) => (typeof u === "number" && Number.isFinite(u) ? u : null)) : [],
          // An unpriced result is unmeasured, never $0 — `num` would coerce it.
          combinedUsd: r.usd === null || r.usd === undefined ? null : num(r.usd),
        })), ...auditEscalations.rows.map((r: Record<string, unknown>): EscalationFact => ({
          role: "ADVERSARIAL_AUDITOR", at: str(r.at), obligationId: String(r.id), subjectId: str(r.subject),
          from: String(r.from_model), to: str(r.to_model), reason: String(r.reason),
          evidence: `Independent worker outcome: ${String(r.verdict)}. Public delivery requires the linked publication receipt.`,
          refused: null, attemptsUsd: [r.usd == null ? null : num(r.usd)], combinedUsd: r.usd == null ? null : num(r.usd),
        }))].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")).slice(0, 6),
      },
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

/* ==================================================================== *
 * WHAT THE SCOUT RESULTS SAY ABOUT LEARNING (Fleet · Is it learning)
 * ==================================================================== */

export interface WeekRow {
  /** The Monday the UTC week starts on. */
  readonly week: string;
  readonly attempts: number;
  /** Unrefused attempts that found a way in or the record itself. */
  readonly found: number;
  readonly refused: number;
  readonly usd: number;
}

export interface LearningFacts {
  readonly asOf: string;
  readonly weeks: readonly WeekRow[];
  /** The field-manual pair, recorded on each walk since it was introduced. */
  readonly manual: { readonly recorded: number; readonly inherited: number; readonly rebuilt: number; readonly since: string | null };
  /** Walks that started from an earlier walk's recorded rungs, against walks that started fresh — unrefused only. */
  readonly resumed: { readonly walks: number; readonly found: number; readonly freshWalks: number; readonly freshFound: number; readonly since: string | null };
}

const FOUND = `record->>'outcome' in ('ROUTE_CANDIDATE', 'EVIDENCE_FOUND')`;

export async function readLearningFacts(connection: string, nowIso: string): Promise<LearningFacts> {
  const pool = new Pool({ connectionString: connection });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ");
    await client.query(`SET LOCAL statement_timeout = ${SPEND_STORE_STATEMENT_TIMEOUT_MS}`);
    const weeks = await client.query(`
      select to_char(date_trunc('week', (record->>'startedAt')::timestamptz at time zone 'UTC'), 'YYYY-MM-DD') as wk,
        count(*)::int as attempts,
        count(*) filter (where not (${REFUSED}) and ${FOUND})::int as found,
        count(*) filter (where ${REFUSED})::int as refused,
        coalesce(sum((record->>'usd')::numeric), 0)::float8 as usd
      from cp_log_scout_results group by 1 order by 1`);
    const manual = await client.query(`
      select count(*) filter (where record ? 'inheritedFieldManual')::int as recorded,
        count(*) filter (where coalesce((record->>'inheritedFieldManual')::numeric, 0) > 0)::int as inherited,
        count(*) filter (where (case when jsonb_typeof(record->'rebuiltExistingRoutes') = 'array' then jsonb_array_length(record->'rebuiltExistingRoutes') else 0 end) > 0)::int as rebuilt,
        min(record->>'startedAt') filter (where record ? 'inheritedFieldManual') as since
      from cp_log_scout_results`);
    const resumed = await client.query(`
      select count(*) filter (where coalesce((record->>'resumedFromRungs')::numeric, 0) > 0)::int as walks,
        count(*) filter (where coalesce((record->>'resumedFromRungs')::numeric, 0) > 0 and ${FOUND})::int as found,
        count(*) filter (where record ? 'resumedFromRungs' and coalesce((record->>'resumedFromRungs')::numeric, 0) = 0)::int as fresh_walks,
        count(*) filter (where record ? 'resumedFromRungs' and coalesce((record->>'resumedFromRungs')::numeric, 0) = 0 and ${FOUND})::int as fresh_found,
        min(record->>'startedAt') filter (where record ? 'resumedFromRungs') as since
      from cp_log_scout_results where not (${REFUSED})`);
    await client.query("ROLLBACK");
    const m = (manual.rows[0] ?? {}) as Record<string, unknown>;
    const r = (resumed.rows[0] ?? {}) as Record<string, unknown>;
    return {
      asOf: nowIso,
      weeks: weeks.rows.map((w: Record<string, unknown>) => ({ week: String(w.wk ?? ""), attempts: num(w.attempts), found: num(w.found), refused: num(w.refused), usd: num(w.usd) })),
      manual: { recorded: num(m.recorded), inherited: num(m.inherited), rebuilt: num(m.rebuilt), since: str(m.since) },
      resumed: { walks: num(r.walks), found: num(r.found), freshWalks: num(r.fresh_walks), freshFound: num(r.fresh_found), since: str(r.since) },
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

export type LearningRead = { readonly kind: "HELD"; readonly facts: LearningFacts } | { readonly kind: "UNREAD"; readonly detail: string };

/*
 * A minute fresh, five minutes recent (see shared-read.ts): while the paid lane
 * is closed these do not move at all, and when it is open they move once a
 * cycle. Every page names the time its figures were read.
 */
const learningShared = sharedRead<LearningRead>({
  freshMs: 60_000,
  staleMs: 5 * 60_000,
  deadlineMs: ADMIN_READ_DEADLINE_MS,
  keep: (r) => r.kind === "HELD",
  late: (ms) => ({ kind: "UNREAD", detail: lateWords("The Scout result aggregate", ms) }),
});

export async function loadLearningFacts(nowIso: string): Promise<LearningRead> {
  return learningShared.read(async () => {
    const connection = process.env[CONTROL_PLANE_URL_VAR]?.trim() ?? "";
    if (connection === "") return { kind: "UNREAD", detail: "This Admin runtime has no connection to the control plane, so the Scout results were not read." };
    try {
      return { kind: "HELD", facts: await readLearningFacts(connection, nowIso) };
    } catch (error) {
      console.error("[admin learning] the Scout result aggregate could not be read:", error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g, "<connection>") : "unknown error");
      return { kind: "UNREAD", detail: "The Scout results could not be read just now, so the readings that depend on them are not shown." };
    }
  });
}

export type SpendRead = { readonly kind: "HELD"; readonly facts: SpendFacts } | { readonly kind: "UNREAD"; readonly detail: string };

const spendShared = sharedRead<SpendRead>({
  freshMs: 60_000,
  staleMs: 5 * 60_000,
  deadlineMs: ADMIN_READ_DEADLINE_MS,
  keep: (r) => r.kind === "HELD",
  late: (ms) => ({ kind: "UNREAD", detail: lateWords("The Scout result aggregate", ms) }),
});

export async function loadSpendFacts(nowIso: string): Promise<SpendRead> {
  return spendShared.read(async () => {
    const connection = process.env[CONTROL_PLANE_URL_VAR]?.trim() ?? "";
    if (connection === "") {
      return { kind: "UNREAD", detail: "This Admin runtime has no connection to the control plane, so the Scout results were not read. That is not the same as nothing spent." };
    }
    try {
      return { kind: "HELD", facts: await readSpendFacts(connection, nowIso) };
    } catch (error) {
      console.error("[admin money] the Scout result aggregate could not be read:", error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g, "<connection>") : "unknown error");
      return { kind: "UNREAD", detail: "The Scout results could not be read just now, so what the paid work produced is not shown. Nothing here is a zero." };
    }
  });
}
