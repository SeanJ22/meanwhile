/**
 * PB-01: the role instructions every worker reads, seeded into the control plane.
 *
 * These rows live in `cp_field_manual_entries`, a control-plane table. The reader
 * database's migration journal must never name it, so the seed and the one-time
 * retirement of the old instruction rows run through the repository that already
 * creates and writes the control-plane tables.
 */

import seedRows from "./playbook-seed.json" with { type: "json" };
import { createHash } from "node:crypto";
import { fieldManualEntryId, newFieldManualEntry, type FieldManualEntry, type FieldManualRepos } from "./field-manual.ts";
import { updateRolePlaybook } from "./playbook-edit.ts";
import { rolePlaybook } from "./playbooks.ts";

/** The canonical role instructions, exactly as first written. A row that already exists always wins. */
export const PLAYBOOK_SEED_ROWS: readonly FieldManualEntry[] = seedRows as unknown as readonly FieldManualEntry[];

/** The measure writer and checker start from the translator instructions already in use, so a deploy keeps their text, history and model. */
const TRANSLATOR_CARRY: Readonly<Record<string, "writerModel" | "checkerModel">> = {
  "fm-220766cd29b8177fbe15c604": "writerModel",
  "fm-3069eaa6952134d521f4d731": "checkerModel",
};

/** Rows from the files and instruction sets that no longer exist. */
const RETIRED_ROW_IDS = ["fm-46726d913a9a3adc8328ce1d", "fm-1ded93f8737b6452eac13b87", "fm-7fa3809c57f6fdfc46ea5451"] as const;
const RETIRED_DOCS = ["docs/branch-manifest.md", "docs/zip-playbook.md", "docs/source-ladder.md"] as const;
const OLD_INSTRUCTION_ROLES = ["SCOUT", "DETECTIVE", "PARSER", "AUDITOR", "ENGINEER", "MEASURE_WRITER", "MEASURE_CHECKER", "ASK_READER", "ASK_WRITER", "ASK_FALLBACK", "VALIDATOR"] as const;

/** Written once the old rows are gone; a bookkeeping row, so no worker is ever shown it. */
export const PLAYBOOK_RETIREMENT_MARKER_KIND = "PLAYBOOK_RETIREMENT";
export const PLAYBOOK_RETIREMENT_MARKER = newFieldManualEntry("pb01-instructions", "retired", {
  role: "SHARED", kind: PLAYBOOK_RETIREMENT_MARKER_KIND, title: "Old instruction rows retired",
  summary: "The retired instruction rows and pointers were removed once, after the canonical role instructions existed.", outcome: "REFERENCE",
});

const quoted = (values: readonly string[]): string => values.map(value => {
  if (!/^[A-Za-z0-9_./:-]+$/.test(value)) throw new Error(`PLAYBOOK_RETIREMENT_UNSAFE_LITERAL:${value}`);
  return `'${value}'`;
}).join(", ");

/**
 * One statement, so one transaction: the guard that refuses deletes is lifted for
 * this removal only and is back before the statement ends, or the whole removal is
 * undone. Ordinary writers still cannot delete.
 */
export function retireInstructionsSql(): string {
  const canonical = PLAYBOOK_SEED_ROWS.map(row => row.id);
  return `DO $retire$ BEGIN
  ALTER TABLE cp_field_manual_entries DISABLE TRIGGER cp_field_manual_entries_no_rewrite;
  DELETE FROM cp_field_manual_entries WHERE id IN (${quoted(RETIRED_ROW_IDS)})
    OR value->>'source' IN (${quoted(RETIRED_DOCS)})
    OR value #>> '{payload,path}' IN (${quoted(RETIRED_DOCS)})
    OR value->>'url' IN (${quoted(RETIRED_DOCS)})
    OR (value->>'kind' = 'PLAYBOOK' AND id NOT IN (${quoted(canonical)})
      AND (value->>'role' IN (${quoted(OLD_INSTRUCTION_ROLES)}) OR value #>> '{payload,translator}' = 'true'));
  ALTER TABLE cp_field_manual_entries ENABLE TRIGGER cp_field_manual_entries_no_rewrite;
END $retire$;`;
}

const isTranslatorText = (entry: FieldManualEntry): boolean => {
  const payload = entry.payload as { translator?: unknown; text?: unknown } | null;
  return (payload?.translator === true || payload?.translator === "true") && typeof payload.text === "string" && payload.text.length > 0;
};

/** The translator instructions already in use: the newest row that has text. */
async function translatorCarry(repos: FieldManualRepos): Promise<{ text: unknown; history: unknown; writerModel: unknown; checkerModel: unknown } | null> {
  const rows = (await repos.fieldManual.listWhere(["kind"], "PLAYBOOK")).filter(row => isTranslatorText(row.value));
  const newest = rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))[0];
  const payload = newest?.value.payload as { text: unknown; history?: unknown; writerModel?: unknown; checkerModel?: unknown } | undefined;
  return payload ? { text: payload.text, history: payload.history ?? [], writerModel: payload.writerModel ?? null, checkerModel: payload.checkerModel ?? null } : null;
}

/** Create each missing canonical row. An existing row, with its edits and history, is never read into, merged or replaced. */
export async function seedRolePlaybooks(repos: FieldManualRepos, now: string): Promise<{ created: number; present: number }> {
  let created = 0;
  let present = 0;
  let carry: Awaited<ReturnType<typeof translatorCarry>> | undefined;
  for (const row of PLAYBOOK_SEED_ROWS) {
    if (await repos.fieldManual.read(row.id) !== null) { present += 1; continue; }
    const from = TRANSLATOR_CARRY[row.id];
    if (from !== undefined && carry === undefined) carry = await translatorCarry(repos);
    const entry: FieldManualEntry = from !== undefined && carry
      ? { ...row, payload: { text: carry.text, history: carry.history, model: carry[from] } }
      : row;
    try {
      await repos.fieldManual.put(row.id, entry, now);
      created += 1;
    } catch (error) {
      // Another process seeded the same row first. Whatever it wrote stands.
      if (await repos.fieldManual.read(row.id) === null) throw error;
      present += 1;
    }
  }
  return { created, present };
}

/** The detective text written before hunting was rebuilt; a row still holding it exactly gets the current text, with undo. */
const DETECTIVE_BEFORE_HUNTING = "31482734e7a60e424b35d5e29d1b4098176c0d844558d3fcf77517440f21a65d";

async function refreshUnchangedDetective(repos: FieldManualRepos, now: string): Promise<void> {
  const held = await repos.fieldManual.read(fieldManualEntryId("role-playbook", "DETECTIVE"));
  const book = rolePlaybook(held ? [held.value] : [], "DETECTIVE");
  if (createHash("sha256").update(book.text).digest("hex") !== DETECTIVE_BEFORE_HUNTING) return;
  const text = (PLAYBOOK_SEED_ROWS.find(row => row.role === "DETECTIVE")?.payload as { text: string }).text;
  await updateRolePlaybook(repos, { role: "DETECTIVE", text, expectedVersion: book.version, id: "h01-detective-blanks", at: now,
    why: "Hunting rebuilt: the detective works a government's open blanks and reports each fact as found", factory: "H-01" });
}

/** Replace the shipped Ask instructions once, through the normal edit log and undo path. */
async function refreshUnchangedAsk(repos: FieldManualRepos, now: string): Promise<void> {
  const previous: Record<string, readonly string[]> = {
    ASK_READER: ["9802b4f085aa77199e4e0d41735ccf1b3e5412484d264877a26097cfc6598f0f"],
    ASK_WRITER: ["f35f2275e91d59d09884ac363d38bdc30a3fac113dcccfd72c239b0cfacc91ac", "b7a4a54af7c6f891dde081a9f5d02adadde2d5664a8271e594e3176dfd040833"],
    ASK_FALLBACK: ["bb1a9aa311e2c0c10f0fd143aa4341ec077b3a943dd1fe5a671ea5de08035ee7", "51123beb43ed925452255dcd961349d831cf7194e6c60551561b0d3b7b528eb3"],
  };
  for (const role of ["ASK_READER", "ASK_WRITER", "ASK_FALLBACK"] as const) {
    const held = await repos.fieldManual.read(fieldManualEntryId("role-playbook", role));
    const book = rolePlaybook(held ? [held.value] : [], role);
    if (!previous[role].includes(book.version)) continue;
    const text = (PLAYBOOK_SEED_ROWS.find(row => row.role === role)!.payload as { text: string }).text;
    await updateRolePlaybook(repos, { role, text, expectedVersion: book.version, id: `aq-01-${role.toLowerCase()}`,
      at: now, why: "Ask understands local wording and answers the question directly", factory: "AQ-01" });
  }
}

export interface PlaybookSetupReport { readonly created: number; readonly present: number; readonly retired: boolean }

/**
 * Seed every canonical row, then — once, and only when all of them exist — remove the
 * old instruction rows and pointers. `retire` is the store's own removal path; a store
 * without one (memory, files) has nothing to retire.
 */
export async function ensureRolePlaybooks(repos: FieldManualRepos, now: string): Promise<PlaybookSetupReport> {
  const seeded = await seedRolePlaybooks(repos, now);
  await refreshUnchangedDetective(repos, now);
  await refreshUnchangedAsk(repos, now);
  const retire = repos.fieldManual.retireInstructions;
  if (retire === undefined) return { ...seeded, retired: false };
  if (await repos.fieldManual.read(PLAYBOOK_RETIREMENT_MARKER.id) !== null) return { ...seeded, retired: false };
  for (const row of PLAYBOOK_SEED_ROWS) {
    if (await repos.fieldManual.read(row.id) === null) throw new Error(`PLAYBOOK_RETIREMENT_BEFORE_CANONICAL_ROWS:${row.id}`);
  }
  await retire.call(repos.fieldManual);
  try { await repos.fieldManual.put(PLAYBOOK_RETIREMENT_MARKER.id, { ...PLAYBOOK_RETIREMENT_MARKER, observedAt: now, payload: { retiredAt: now } }, now); }
  catch { /* A concurrent start wrote it; the removal is idempotent and already done. */ }
  return { ...seeded, retired: true };
}
