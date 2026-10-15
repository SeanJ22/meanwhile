import { createRequire } from "node:module";
import { dirname, join, basename } from "node:path";
import { stateOfSubject } from "../expansion/subjects.ts";
import type { AssignmentBudgetSpec } from "../expansion/assignment-budget.ts";
import type { BudgetScope } from "../expansion/membership.ts";
import type { ProviderCircuit } from "../fleet-safety.ts";

export const HUNTER_LANE_ARMING_FORMAT = 2;
export interface ArmingIndexHeader {
  readonly format: typeof HUNTER_LANE_ARMING_FORMAT;
  readonly readAt: string;
  readonly indexFile: string;
  readonly costsReadable: boolean;
  readonly areas: { readonly malformedScopes: number; readonly hasSelectedHunts: boolean } | null;
  readonly circuits: readonly ProviderCircuit[];
  readonly worstCaseUsd: number;
}
interface Statement {
  get(...values: unknown[]): Record<string, unknown> | undefined;
  all(...values: unknown[]): Record<string, unknown>[];
  run(...values: unknown[]): unknown;
}
export interface ArmingDatabase {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string, options?: { readOnly: boolean }) => ArmingDatabase;
};
export const openArmingDatabase = (path: string, readOnly = false): ArmingDatabase => {
  const db = new DatabaseSync(path, { readOnly });
  db.exec("PRAGMA cache_size=-128; PRAGMA temp_store=FILE");
  return db;
};

export interface HunterLaneArmingIndex extends ArmingIndexHeader {
  assignment(key: string): { known: boolean; spec: AssignmentBudgetSpec | null; usd: number | null };
  reached(obligationId: string): readonly string[];
  scopesFor(subjectId: string, stateHint?: string | null): readonly BudgetScope[];
  lifetimeSubject(subjectId: string): boolean;
}

export function armingIndex(path: string, header: ArmingIndexHeader): HunterLaneArmingIndex {
  if (basename(header.indexFile) !== header.indexFile || !/^arming-[a-f0-9-]+\.sqlite$/.test(header.indexFile)) throw new Error("Invalid arming index identity.");
  const indexPath = join(dirname(path), header.indexFile);
  const query = <T>(read: (db: ArmingDatabase) => T): T => {
    const db = openArmingDatabase(indexPath, true);
    try { return read(db); } finally { db.close(); }
  };
  query(db => {
    if (db.prepare("SELECT value FROM metadata WHERE key='readAt'").get()?.value !== header.readAt) throw new Error("Arming index differs from its reading.");
  });
  return { ...header,
    assignment: key => query(db => {
      const row = db.prepare("SELECT known, spec, usd FROM sends WHERE key=?").get(key);
      return { known: row?.known === 1, spec: row?.spec ? JSON.parse(String(row.spec)) as AssignmentBudgetSpec : null,
        usd: typeof row?.usd === "number" ? row.usd : null };
    }),
    reached: obligationId => query(db => {
      const row = db.prepare("SELECT keys FROM reached WHERE obligation=?").get(obligationId);
      return row ? JSON.parse(String(row.keys)) as string[] : [];
    }),
    lifetimeSubject: subjectId => query(db => Boolean(db.prepare("SELECT 1 FROM lifetime WHERE subject=?").get(subjectId))),
    scopesFor: (subjectId, stateHint) => query(db => {
      const state = stateOfSubject(subjectId) ?? (stateHint ? stateOfSubject(/^[a-z]{2}$/i.test(stateHint) ? `${stateHint.toUpperCase()}:state` : stateHint) : null);
      if (state === null && db.prepare("SELECT 1 FROM unresolved LIMIT 1").get()) throw new Error("An unresolved area budget binds this work, whose state is unknown.");
      const rows = db.prepare(`SELECT data FROM scopes WHERE key IN (
        SELECT scope FROM members WHERE subject=? UNION SELECT scope FROM unresolved WHERE state=?)`).all(subjectId, state ?? "");
      return rows.map(row => ({ ...JSON.parse(String(row.data)) as Omit<BudgetScope, "members">, members: new Set([subjectId]) }));
    }),
  };
}
