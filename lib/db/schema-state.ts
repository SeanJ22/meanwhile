import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **THE SCHEMA GATE — D73's CLASS, NOT ITS INSTANCE** (Prompt D item 6.1,
 * 2026-08-20).
 *
 * ## What happened, stated once, here
 *
 * Migration 0011 added `coverage_tier` to `search_log` and `reactions`. The
 * code that names that column shipped in Prompt B. The migration was never
 * applied to production. So every insert into either sold store named a column
 * the database did not have, and every insert failed — from 15:53:51Z until
 * 20:11:46Z the next session, four hours in which the revenue path recorded
 * nothing.
 *
 * The route catches that error and serves the page anyway, which is CORRECT
 * for a reader: a search still answers. RULING 25 keeps it exactly as it is.
 * The consequence is that the loss was invisible from every surface — the site
 * was up, the pages rendered, the walk was green, and two sold stores were
 * dark.
 *
 * ## The class
 *
 * A column in the code and not in the database fails every insert that names
 * it. That is not a bug in migration 0011; it is a permanent property of
 * shipping code and schema on separate tracks. The instance is closed by
 * applying 0011. The CLASS is closed by asking, out loud, whether the database
 * the deploy is talking to has the migrations the deploy was built from.
 *
 * ## What this module is
 *
 * Pure comparison, no database. It takes the committed journal and the set of
 * `created_at` values the database says it has applied, and returns what is
 * missing BY TAG — so a mismatch names `0011_...` rather than reporting a
 * number. `app/api/schema/route.ts` runs it against production on request,
 * `scripts/check-schema-state.mts` runs it in the scheduled jobs, and
 * `tests/schema-gate.test.ts` runs it against fixtures.
 *
 * The join key is `when`, matching `scripts/apply-migrations.mts`: Drizzle
 * writes the journal's own `when` into `created_at`, so the two sides compare
 * without hashing anything.
 */

export interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

export interface SchemaState {
  /** The last migration in the committed journal — what the code expects. */
  codeHead: string;
  /** How many migrations the journal holds. */
  codeCount: number;
  /** How many of them the database says it has applied. */
  appliedCount: number;
  /** Committed migrations the database does not have, in journal order. */
  missing: string[];
  /**
   * Applied `created_at` values matching no committed migration. A database
   * ahead of the code is its own problem — a rollback that left rows behind,
   * or two branches applying to one database — and it is reported rather than
   * folded into `missing`, because the two need different answers.
   */
  unknownApplied: number[];
  inSync: boolean;
}

export function compareSchemaState(
  journal: JournalEntry[],
  appliedWhen: readonly number[],
): SchemaState {
  const applied = new Set(appliedWhen.map(Number));
  const committed = new Set(journal.map((e) => e.when));
  const missing = journal.filter((e) => !applied.has(e.when)).map((e) => e.tag);
  const unknownApplied = [...applied].filter((w) => !committed.has(w)).sort();
  const last = journal[journal.length - 1];
  return {
    // An empty journal has no head, and "unknown" is the named gap rather
    // than a plausible tag.
    codeHead: last ? last.tag : "unknown",
    codeCount: journal.length,
    appliedCount: applied.size,
    missing,
    unknownApplied,
    inSync: missing.length === 0 && unknownApplied.length === 0,
  };
}

/**
 * The committed journal, read from disk.
 *
 * Server-only. `next.config.ts` names this file in the route's traced set —
 * a file read through `process.cwd()` is absent from a Netlify deploy unless
 * the tracer is told about it, and the failure renders as honest missing data,
 * which is exactly the shape this module exists to refuse.
 */
export function readJournal(): JournalEntry[] {
  const raw = readFileSync(
    join(process.cwd(), "lib", "db", "migrations", "meta", "_journal.json"),
    "utf8",
  );
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

/** One sentence a human can act on, for a log line or an HTTP body. */
export function describeSchemaState(state: SchemaState): string {
  if (state.inSync) {
    return `schema in sync at ${state.codeHead} (${state.appliedCount} of ${state.codeCount} applied)`;
  }
  const parts: string[] = [];
  if (state.missing.length > 0) {
    parts.push(
      `${state.missing.length} committed migration(s) NOT APPLIED: ${state.missing.join(", ")}. ` +
        "Every insert naming a column they add will fail, and the route will catch it and " +
        "serve the page. Run: corepack pnpm db:apply --target=production",
    );
  }
  if (state.unknownApplied.length > 0) {
    parts.push(
      `${state.unknownApplied.length} applied migration(s) match nothing in the committed ` +
        `journal (created_at ${state.unknownApplied.join(", ")}) — the database is ahead of ` +
        "this checkout, or two branches have written to it.",
    );
  }
  return parts.join(" ");
}
