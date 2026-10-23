import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { temporaryPath } from "../civic-data/temporary-path.ts";
import type { Persisted } from "../control-plane/repository/types.ts";
import { isDoorRecord, type DoorRecord } from "./registry.ts";

type Query = (sql: string, parameters: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
interface DoorCopy { formatVersion: 1; through: string; rows: Persisted<DoorRecord>[] }

/** One retained copy of the necessary meeting rows. Database-clock overlap includes late commits; known revisions are never downloaded again. */
export async function changedMeetingDoors(input: {
  connection: string;
  query: Query;
  root?: string;
  state?: string;
}): Promise<Persisted<DoorRecord>[]> {
  if (input.state && !/^[a-z]{2}$/i.test(input.state)) throw new Error("Invalid meeting-door state");
  const root = temporaryPath(input.root ?? join(tmpdir(), "meanwhile-meeting-door-reads"));
  const database = new URL(input.connection);
  const identity = createHash("sha256").update(`${database.hostname.replace("-pooler.", ".")}/${database.pathname}`).digest("hex").slice(0, 16);
  const state = input.state?.toLowerCase();
  const pattern = state ? `/(state|district|territory):${state}(/|#|$)|^curated:${state}/|^government:US-${state.toUpperCase()}:` : null;
  const path = temporaryPath(join(root, `${identity}${state ? `-${state}` : ""}.json`));
  let previous: DoorCopy | null = null;
  try {
    const held = JSON.parse(await readFile(path, "utf8")) as DoorCopy;
    if (held.formatVersion !== 1 || !Number.isFinite(Date.parse(held.through)) || !Array.isArray(held.rows)
      || held.rows.some(row => !isDoorRecord(row.value))) throw new Error("Meeting door copy is unreadable");
    previous = held;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const since = previous ? new Date(Date.parse(previous.through) - 120_000).toISOString() : null;
  const held = previous?.rows.map(({ id, revision }) => ({ id, revision })) ?? [];
  const rows = new Map(previous?.rows.map(row => [row.id, row]) ?? []);
  const clock = await input.query("SELECT now() AS read_at", []);
  const through = new Date(clock[0].read_at as string).toISOString();
  let after = "";
  for (;;) {
    const page = await input.query(`SELECT id,revision,updated_at,
      CASE WHEN value->'meeting' IS NOT NULL AND value->'meeting'<>'null'::jsonb
        AND ($4::text IS NULL OR value->>'ocdId' ~ $4 OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(value->'bodyIds') b WHERE b ~ $4))
        THEN value ELSE 'null'::jsonb END AS value
      FROM cp_doors WHERE id>$1
        AND ($2::timestamptz IS NULL OR changed_at >= $2::timestamptz)
        AND ((value->'meeting' IS NOT NULL AND value->'meeting'<>'null'::jsonb
          AND ($4::text IS NULL OR value->>'ocdId' ~ $4 OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(value->'bodyIds') b WHERE b ~ $4)))
          OR id=ANY($5::text[]))
        AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset($3::jsonb) AS h(id text,revision int)
          WHERE h.id=cp_doors.id AND h.revision=cp_doors.revision)
      ORDER BY id LIMIT 100`, [after, since, JSON.stringify(held), pattern, held.map(row => row.id)]);
    for (const row of page) {
      if (!isDoorRecord(row.value)) rows.delete(String(row.id));
      else rows.set(String(row.id), { id: String(row.id), revision: Number(row.revision),
        updatedAt: new Date(row.updated_at as string).toISOString(), value: row.value });
    }
    if (page.length < 100) break;
    after = String(page.at(-1)!.id);
  }
  const next: DoorCopy = { formatVersion: 1, through, rows: [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)) };
  await mkdir(temporaryPath(root), { recursive: true });
  const pending = temporaryPath(`${path}.${randomUUID()}.tmp`);
  await writeFile(temporaryPath(pending), JSON.stringify(next) + "\n", { mode: 0o600 });
  await rename(temporaryPath(pending), temporaryPath(path));
  return next.rows;
}
