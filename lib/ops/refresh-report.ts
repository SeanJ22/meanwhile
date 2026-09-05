/**
 * THE DAILY REFRESH'S RECORD OF ITSELF, MACHINE-READABLE, AND THE DEBT IT
 * LEAVES BEHIND. (2026-09-02, the refresh-failure session.)
 *
 * ## Why a JSON beside the Markdown
 *
 * `docs/refresh-run.md` was the only account of what a refresh did, and it
 * was prose: another tool that wanted to know which source landed had to parse
 * a table. `docs/refresh-run.json` is the same run as data, with one typed
 * outcome per source, and the Markdown is RENDERED from it — one writer, one
 * truth, two views. The JSON is canonical; the `.md` is a view of it.
 *
 * ## The four outcomes, and why there are exactly four
 *
 *   INGESTED      the source ran clean AND its governed paths changed. These
 *                 bytes are what the commit carries.
 *   UNCHANGED     the source ran clean and its governed paths are byte-identical
 *                 to HEAD. Nothing to commit, and that is stated rather than
 *                 inferred from the absence of a diff.
 *   ROUTE_UNREAD  the source did NOT land: a command failed, or the gate
 *                 refused its data. The reason is named. Its governed paths are
 *                 NOT in the commit.
 *   NOT_DUE       the cadence did not call for it today.
 *
 * "UNCHANGED" and "ROUTE_UNREAD" are the two that used to be one silence. A
 * source whose data the suite refused was, before this, indistinguishable from
 * a source that had nothing new — both left `main` untouched — and the two
 * scheduled runs of 2026-09-01 and 2026-09-02 were the proof: every source's
 * data was thrown away because one source's data failed one test, and the
 * report said "3 clean".
 *
 * ## Debt
 *
 * A source that did not land owes the reader its data until it does.
 * `data/ops/refresh-debt.json` carries that obligation across runs: first
 * failure, latest failure, how many in a row, why, and when it is next due —
 * which is TOMORROW regardless of cadence, because a weekly source refused on
 * Monday is not owed on the following Monday, it is owed now. The orchestrator
 * reads the debt file and treats every source in it as DUE. The file is
 * written only when its content moves, so a quiet day still commits nothing
 * (RULING 124), and it lives under `data/ops/`, which `lib/ops/deploy-paths.ts`
 * classifies as non-shipping — a debt commit costs no build.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { CATCH_UP_MAX_DAYS, cadenceOn, isDue, utcDay, type RefreshSource } from "./refresh-cadence.ts";
import { renewalSummary } from "./refresh-renewal.ts";
import type { RefreshObservation } from "./stamp-stable.ts";

export const REFRESH_RUN_PATH = "docs/refresh-run.json";
export const REFRESH_REPORT_PATH = "docs/refresh-run.md";
export const REFRESH_DEBT_PATH = "data/ops/refresh-debt.json";

export type SourceOutcome = "INGESTED" | "UNCHANGED" | "ROUTE_UNREAD" | "NOT_DUE";
export const SOURCE_OUTCOMES: readonly SourceOutcome[] = ["INGESTED", "UNCHANGED", "ROUTE_UNREAD", "NOT_DUE"];

/** One source's row in the run record. Field names are a contract another lane reads. */
export interface RefreshSourceRun {
  id: string;
  due: boolean;
  ran: boolean;
  outcome: SourceOutcome;
  reason: string;
  commands: string[];
  failedCommand: string | null;
  exitCode: number | null;
  governs: string[];
  /** The governed paths that differ from HEAD and WILL be committed. Empty for a refused source. */
  changedPaths: string[];
  /** Earlier calendar days this run recovered for the source, `YYYY-MM-DD`. */
  recoveredFrom: string[];
  nextDueAt: string | null;
  /**
   * Additive (RL-1, 2026-09-05): what each of this source's writers observed —
   * facts unchanged and bytes left alone, or facts changed and written. A
   * no-op day's "we looked at HH:MM" lives here, never in the artifact.
   */
  observations?: RefreshObservation[];
}

/** One step of the Reader proof renewal, timed, so a red run names where it stopped. */
export interface RefreshRenewalStep {
  name: string;
  ok: boolean;
  secs: number;
  detail: string | null;
}

/**
 * Additive (RL-2/RL-3, 2026-09-05): what the refresh did about the Reader
 * Last-Mile closure receipt when a canonical holding changed. NOT_NEEDED when
 * no holding's bytes moved; RENEWED when the existing dependency-aware
 * finalizer re-proved the invalidated rows at this head; FAILED when it could
 * not, in which case every source whose changed paths include a holding is
 * refused, its paths are back at HEAD, and the gate records the debt.
 */
export interface RefreshRenewal {
  verdict: "NOT_NEEDED" | "RENEWED" | "FAILED";
  ranAt: string;
  exactHead: string;
  /** Canonical holdings whose bytes differ from the committed closure census. */
  changedHoldings: string[];
  /** The evidence prefix the renewal archived the prior receipt under, when it ran. */
  prefix: string | null;
  steps: RefreshRenewalStep[];
  /** Sources refused because their holding change could not be proved; empty unless FAILED. */
  refusedSources: { id: string; paths: string[]; why: string }[];
  failure: string | null;
}

export type GateVerdict = "NOT_RUN" | "GREEN" | "REFUSED" | "CANNOT_RUN";

export interface GateAttribution {
  file: string;
  /** The source whose data this file refuses, or null when it is the tree's. */
  sourceId: string | null;
  basis: string;
}

export interface RefreshRun {
  formatVersion: 1;
  runDate: string;
  startedAt: string;
  finishedAt: string;
  mode: "CADENCE" | "ALL";
  exitCode: 0 | 1 | 2;
  sources: RefreshSourceRun[];
  /** Additive: which days this run answered for. */
  catchUp: {
    /** Where the last-landed date was read from, or why none is claimed. */
    lastLanded: string;
    days: string[];
    cap: number;
    off: boolean;
  };
  /** Additive: what the gate did with the data, filled in by `refresh-gate`. */
  gate: {
    verdict: GateVerdict;
    ranAt: string | null;
    failingFiles: string[];
    attribution: GateAttribution[];
    note: string;
  };
  /** Additive (RL-2/RL-3, 2026-09-05): what the refresh did about the Reader proof when a holding changed. */
  renewal?: RefreshRenewal;
}

export interface RefreshDebt {
  sourceId: string;
  firstFailedOn: string;
  lastFailedOn: string;
  consecutiveFailures: number;
  reason: string;
  nextDueAt: string;
}

export interface RefreshDebtFile {
  formatVersion: 1;
  updatedOn: string;
  debts: RefreshDebt[];
}

/* -------------------------------------------------------------------------- */
/* READ AND WRITE                                                              */
/* -------------------------------------------------------------------------- */

export function readRefreshRun(root: string): RefreshRun | null {
  const path = join(root, REFRESH_RUN_PATH);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as RefreshRun;
  if (parsed.formatVersion !== 1 || !Array.isArray(parsed.sources)) {
    throw new Error(`${REFRESH_RUN_PATH}: not a formatVersion 1 run record`);
  }
  return parsed;
}

/** Write the JSON and render the Markdown from it, in that order. */
export function writeRefreshRun(root: string, run: RefreshRun, sources: readonly RefreshSource[]): void {
  const path = join(root, REFRESH_RUN_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  writeFileSync(join(root, REFRESH_REPORT_PATH), renderRefreshRunMarkdown(run, sources), "utf8");
}

export function emptyDebt(today: string): RefreshDebtFile {
  return { formatVersion: 1, updatedOn: today, debts: [] };
}

export function readDebt(root: string, today: string): RefreshDebtFile {
  const path = join(root, REFRESH_DEBT_PATH);
  if (!existsSync(path)) return emptyDebt(today);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as RefreshDebtFile;
  if (parsed.formatVersion !== 1 || !Array.isArray(parsed.debts)) {
    throw new Error(`${REFRESH_DEBT_PATH}: not a formatVersion 1 debt file`);
  }
  return parsed;
}

/**
 * Write the debt file only when its DEBTS moved. `updatedOn` alone never
 * earns a write: a file that changed every day would put every day in the
 * commit decision, which is the ceremonial commit RULING 124 ended.
 */
export function writeDebtIfChanged(root: string, next: RefreshDebtFile, today: string): boolean {
  const current = readDebt(root, today);
  const same = JSON.stringify(current.debts) === JSON.stringify(next.debts);
  if (same && existsSync(join(root, REFRESH_DEBT_PATH))) return false;
  if (same && next.debts.length === 0) return false;
  const path = join(root, REFRESH_DEBT_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...next, updatedOn: today }, null, 2)}\n`, "utf8");
  return true;
}

/** The debt with one source's failure recorded (new or one more in a row). */
export function recordDebt(
  file: RefreshDebtFile,
  input: { sourceId: string; reason: string; today: string; nextDueAt: string },
): RefreshDebtFile {
  const existing = file.debts.find((d) => d.sourceId === input.sourceId);
  const debt: RefreshDebt = existing
    ? {
        ...existing,
        lastFailedOn: input.today,
        consecutiveFailures: existing.lastFailedOn === input.today ? existing.consecutiveFailures : existing.consecutiveFailures + 1,
        reason: input.reason,
        nextDueAt: input.nextDueAt,
      }
    : {
        sourceId: input.sourceId,
        firstFailedOn: input.today,
        lastFailedOn: input.today,
        consecutiveFailures: 1,
        reason: input.reason,
        nextDueAt: input.nextDueAt,
      };
  return {
    ...file,
    debts: [...file.debts.filter((d) => d.sourceId !== input.sourceId), debt].sort((a, b) =>
      a.sourceId.localeCompare(b.sourceId),
    ),
  };
}

/** The debt with one source's obligation discharged — it landed. */
export function clearDebt(file: RefreshDebtFile, sourceId: string): RefreshDebtFile {
  return { ...file, debts: file.debts.filter((d) => d.sourceId !== sourceId) };
}

/* -------------------------------------------------------------------------- */
/* DATES                                                                       */
/* -------------------------------------------------------------------------- */

/** The UTC day after `YYYY-MM-DD`. */
export function dayAfter(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return utcDay(new Date(Date.UTC(y, m - 1, d + 1)));
}

/**
 * The next calendar day after `runDate` on which the source's cadence calls
 * for it, or null if none inside 62 days (which the three cadences here never
 * produce — stated rather than assumed, so a fourth cadence cannot inherit a
 * silent null).
 */
export function nextCadenceDay(source: RefreshSource, runDate: Date): string | null {
  const base = Date.UTC(runDate.getUTCFullYear(), runDate.getUTCMonth(), runDate.getUTCDate());
  for (let i = 1; i <= 62; i++) {
    const day = new Date(base + i * 86_400_000);
    if (isDue(source, day)) return utcDay(day);
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* THE MARKDOWN VIEW                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Annotate a generated line that legitimately names a date in the future.
 *
 * `tests/doc-dates.test.ts` refuses a future date in `docs/*.md` unless the
 * same line declares it expected. Every source whose cadence is elevated
 * through the election carries `2026-11-03` in its reason, and every row now
 * carries a next-due day, so the annotation is computed rather than typed —
 * a pinned date would go stale silently, as a red run at 09:11 UTC.
 */
export function declareFutureDates(line: string, asOfDay: string, why: string): string {
  const dates = line.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  const future = [...new Set(dates.filter((d) => d > asOfDay))];
  if (future.length === 0) return line;
  return `${line} <!-- expected-future: ${future.join(", ")} — ${why} -->`;
}

const NEXT_DUE_WHY = "the next calendar day this source's cadence calls for it, computed from the run date";
const CATCH_UP_WHY = "a UTC calendar day in the catch-up window, one ahead of the America/Phoenix document day";
const ELECTION_WHY = "an election date carried in a cadence reason, not a stamp";

export function renderRefreshRunMarkdown(run: RefreshRun, sources: readonly RefreshSource[]): string {
  const day = run.runDate;
  const runDate = new Date(`${day}T00:00:00Z`);
  const byId = new Map(sources.map((s) => [s.id, s]));
  const ran = run.sources.filter((s) => s.ran);
  const landed = ran.filter((s) => s.outcome === "INGESTED" || s.outcome === "UNCHANGED");
  const refused = ran.filter((s) => s.outcome === "ROUTE_UNREAD");

  const lines: string[] = [];
  lines.push("# The daily refresh run");
  lines.push("");
  lines.push(
    "**GENERATED — `pnpm refresh:daily` (`scripts/refresh-daily.mts`), finalised by `refresh-gate`. Rendered from `docs/refresh-run.json`. Never hand-edited (RULING 92).**",
  );
  lines.push("");
  // `lastLandedFromReport` in the orchestrator reads this exact line back.
  lines.push(`Run date: **${day}** (UTC).`);
  lines.push("");
  lines.push(
    "One scheduled run a day, one commit at most, and nothing committed when nothing moved — RULING 124. Cadence per source and the reason for each is `lib/ops/refresh-cadence.ts`.",
  );
  lines.push("");
  lines.push(
    `## ${landed.length} landed · ${refused.length} not landed · ${run.sources.length - ran.length} not due · gate ${run.gate.verdict}`,
  );
  lines.push("");
  lines.push("| Source | Cadence today | Ran | Why | Outcome | Changed paths | Next due | Governs |");
  lines.push("|---|---|:---:|---|---|---|---|---|");
  for (const s of run.sources) {
    const meta = byId.get(s.id);
    const cad = meta ? cadenceOn(meta, runDate) : "?";
    const why = !s.ran
      ? "—"
      : run.mode === "ALL"
        ? "`--all`"
        : s.recoveredFrom.length > 0
          ? `CATCH-UP for ${s.recoveredFrom.join(", ")}`
          : "today's cadence";
    const outcome =
      s.outcome === "ROUTE_UNREAD"
        ? `**ROUTE_UNREAD** — ${s.reason}`
        : `${s.outcome} — ${s.reason}`;
    const changed = s.changedPaths.length > 0 ? s.changedPaths.map((p) => `\`${p}\``).join(", ") : "—";
    lines.push(
      declareFutureDates(
        `| \`${s.id}\` | ${cad} | ${s.ran ? "yes" : "no"} | ${why} | ${outcome} | ${changed} | ${s.nextDueAt ?? "—"} | ${s.governs.map((g) => `\`${g}\``).join(", ")} |`,
        day,
        NEXT_DUE_WHY,
      ),
    );
  }
  // RL-1: a re-observation that changed no fact is history, not an artifact edit.
  const observed = run.sources.flatMap((s) => (s.observations ?? []).map((o) => ({ id: s.id, ...o })));
  if (observed.length > 0) {
    lines.push("");
    lines.push("## What the writers observed (RL-1)");
    lines.push("");
    lines.push("A re-observation whose facts were unchanged left its file byte-identical; the check time is recorded here, never in the artifact.");
    lines.push("");
    lines.push("| Source | Artifact | Verdict | Observed at | Bytes moved | Stamps left alone |");
    lines.push("|---|---|---|---|:---:|---|");
    for (const o of observed) {
      lines.push(`| \`${o.id}\` | \`${o.path}\` | ${o.verdict} | ${o.observedAt} | ${o.written ? "yes" : "no"} | ${o.stampKeys.map((k) => `\`${k}\``).join(", ") || "—"} |`);
    }
  }
  lines.push("");
  lines.push("## What the gate did");
  lines.push("");
  lines.push(`Verdict: **${run.gate.verdict}**${run.gate.ranAt ? ` at ${run.gate.ranAt}` : ""}. ${run.gate.note}`);
  if (run.gate.failingFiles.length > 0) {
    lines.push("");
    lines.push("| Failing test file | Attributed to | Basis |");
    lines.push("|---|---|---|");
    for (const a of run.gate.attribution) {
      lines.push(`| \`${a.file}\` | ${a.sourceId ? `\`${a.sourceId}\`` : "the tree, not any source's data"} | ${a.basis} |`);
    }
  }
  if (run.renewal) {
    lines.push("");
    lines.push("## Reader proof renewal (RL-2 / RL-3)");
    lines.push("");
    for (const line of renewalSummary(run.renewal)) lines.push(line.startsWith("  ") ? `- ${line.trim()}` : line);
  }
  lines.push("");
  lines.push("## Which days this run answered for");
  lines.push("");
  lines.push(
    declareFutureDates(
      run.catchUp.off
        ? `Catch-up is OFF; this run answered for ${day} alone.`
        : `Last landed refresh: ${run.catchUp.lastLanded}. This run answered for ${run.catchUp.days.length} calendar day(s) — ` +
            `${run.catchUp.days.join(", ")} — capped at ${run.catchUp.cap} days.`,
      day,
      CATCH_UP_WHY,
    ),
  );
  lines.push("");
  lines.push(
    "A late run computes the right cadence on its own, because the cadence is a pure function of the run's calendar date. " +
      "What it cannot do is recover a day that produced NO run at all: `fec` and `legiscan` are Monday-only, so a missed " +
      "Monday would otherwise be a fourteen-day data gap. So this run unions what every uncovered day since the last " +
      "landed refresh asks for, and every source carrying open freshness debt (`data/ops/refresh-debt.json`) is due " +
      "until it lands. A quiet day commits nothing and is therefore indistinguishable from a missed one from " +
      "`main`, which is why both are treated as uncovered and why the window is capped — an uncapped union would put " +
      "every weekly source on a daily cadence during a quiet fortnight. It adds no runs, no commits and no builds: " +
      "`refresh-daily.yml` still commits at most once, and nothing when nothing moved.",
  );
  lines.push("");
  lines.push("## Why each source sits on the cadence it does");
  lines.push("");
  for (const s of sources) {
    const elevated = s.elevatedUntil ? ` (elevated to ${s.elevatedUntil.cadence} until ${s.elevatedUntil.until})` : "";
    lines.push(declareFutureDates(`- **\`${s.id}\`** — ${s.cadence}${elevated}. ${s.why}`, day, ELECTION_WHY));
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export { CATCH_UP_MAX_DAYS };
