import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Compares the committed migration journal with the `created_at` values the
 * database says it has applied, and names what is missing by tag. Pure; no
 * database. The join key is the journal's `when`, which Drizzle writes into
 * `created_at`.
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
  /** Applied `created_at` values matching no committed migration: the database is ahead of the code. */
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
    codeHead: last ? last.tag : "unknown",
    codeCount: journal.length,
    appliedCount: applied.size,
    missing,
    unknownApplied,
    inSync: missing.length === 0 && unknownApplied.length === 0,
  };
}

/**
 * The committed journal, read from disk. Server-only; `next.config.ts` must
 * trace this file for the route, or the read is absent on deploy.
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
