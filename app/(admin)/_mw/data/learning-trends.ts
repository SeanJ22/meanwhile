import "server-only";

/** Aggregates over the Scout result log, never the log itself: database transfer is billed. A failure is returned as unread, never as an empty week. */
import { neon } from "../../../../lib/db/client.ts";

import { SCOUT_LEARNING_SQL, type WeekLearningRow } from "@/lib/control-plane/admin-view/learning-trends.ts";
import { CONTROL_PLANE_URL_VAR } from "@/lib/control-plane/repository/pg-store.ts";

import { ADMIN_READ_DEADLINE_MS, lateWords, sharedRead } from "./shared-read.ts";

export const LEARNING_TRENDS_STATEMENT_TIMEOUT_MS = 6_000;

export interface DoorUse {
  readonly walks: number;
  readonly given: number;
  readonly used: number;
  readonly since: string | null;
  readonly named: readonly { readonly id: string; readonly walks: number }[];
}

export interface LearningTrendFacts {
  readonly asOf: string;
  readonly weeks: readonly WeekLearningRow[];
  readonly doors: DoorUse;
  readonly bankWriteErrors: number;
}

type Rows = Record<string, unknown>[];

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

export async function readLearningTrends(connection: string, nowIso: string): Promise<LearningTrendFacts> {
  const sql = neon(connection);
  const results = await sql.transaction(
    [sql.query(`SET LOCAL statement_timeout = ${LEARNING_TRENDS_STATEMENT_TIMEOUT_MS}`), sql.query(SCOUT_LEARNING_SQL)],
    { readOnly: true, isolationLevel: "RepeatableRead" },
  );
  const [, aggregate] = results as unknown as Rows[];
  const row = aggregate[0] ?? {};
  const weekRows = row.week_rows as Rows, namedRows = row.named_rows as Rows;
  const d = row.door_row as Record<string, unknown>;
  return {
    asOf: nowIso,
    bankWriteErrors: num(row.write_errors),
    weeks: weekRows.map((w) => ({
      week: String(w.wk ?? ""),
      walks: num(w.walks),
      pairRecorded: num(w.pair_recorded),
      handed: num(w.handed),
      usedRecorded: num(w.used_recorded),
      usedWalks: num(w.used_walks),
      reusedDoors: num(w.reused_doors),
      finderAttributed: num(w.finder_attributed),
      scoutReusedDoors: num(w.scout_reused),
      detectiveReusedDoors: num(w.detective_reused),
      rebuiltRecorded: num(w.rebuilt_recorded),
      rebuiltRoutes: num(w.rebuilt_routes),
      resumed: num(w.resumed),
      resumedFound: num(w.resumed_found),
      fresh: num(w.fresh),
      freshFound: num(w.fresh_found),
      found: num(w.found),
      usd: num(w.usd),
      unpriced: num(w.unpriced),
      ladderRecorded: num(w.ladder_recorded),
      escalated: num(w.escalated),
    })),
    doors: {
      walks: num(d.walks),
      given: num(d.given),
      used: num(d.used),
      since: str(d.since),
      named: namedRows.map((r) => ({ id: String(r.id ?? ""), walks: num(r.n) })),
    },
  };
}

export type LearningTrendRead = { readonly kind: "HELD"; readonly facts: LearningTrendFacts } | { readonly kind: "UNREAD"; readonly detail: string };

/* A minute fresh, five minutes recent, like the other Scout aggregates: they move at most once a cycle. */
const trendsShared = sharedRead<LearningTrendRead>({
  freshMs: 60_000,
  staleMs: 5 * 60_000,
  deadlineMs: ADMIN_READ_DEADLINE_MS,
  keep: (r) => r.kind === "HELD",
  late: (ms) => ({ kind: "UNREAD", detail: lateWords("The weekly Scout series", ms) }),
});

export async function loadLearningTrends(nowIso: string): Promise<LearningTrendRead> {
  return trendsShared.read(async () => {
    const connection = process.env[CONTROL_PLANE_URL_VAR]?.trim() ?? "";
    if (connection === "") return { kind: "UNREAD", detail: "This Admin runtime has no connection to the control plane, so the weekly series were not read." };
    try {
      return { kind: "HELD", facts: await readLearningTrends(connection, nowIso) };
    } catch (error) {
      console.error("[admin learning] the weekly Scout series could not be read:", error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g, "<connection>") : "unknown error");
      return { kind: "UNREAD", detail: "The weekly Scout series could not be read just now, so no week is drawn. Nothing here is a zero." };
    }
  });
}
