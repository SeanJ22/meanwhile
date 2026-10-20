import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { temporaryPath } from "../../civic-data/temporary-path.ts";

/** Queue identities and completion marks stay on disk; a handout holds one id. */
export function taskIdentityQueue(ids: Iterable<string>, fundedSubjects: Iterable<string> = []) {
  const directory = mkdtempSync(temporaryPath(join(tmpdir(), "meanwhile-worker-queue-")));
  const db = new DatabaseSync(temporaryPath(join(directory, "queue.sqlite")));
  db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-1024; PRAGMA mmap_size=0; CREATE TABLE tasks (seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, state TEXT NOT NULL DEFAULT 'pending'); CREATE INDEX task_state ON tasks(state,seq); CREATE TABLE funded(subject TEXT PRIMARY KEY)");
  const insert = db.prepare("INSERT OR IGNORE INTO tasks(id) VALUES (?)");
  const add = (more: Iterable<string>) => { db.exec("BEGIN"); try { for (const id of more) insert.run(id); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; } };
  add(ids);
  const putFunded = db.prepare("INSERT OR IGNORE INTO funded VALUES (?)");
  db.exec("BEGIN"); for (const subject of fundedSubjects) putFunded.run(subject); db.exec("COMMIT");
  const counts = db.prepare("SELECT count(*) AS n FROM tasks WHERE state=?");
  const state = db.prepare("SELECT state FROM tasks WHERE id=?");
  const set = db.prepare("UPDATE tasks SET state=? WHERE id=? AND state=?");
  const page = db.prepare("SELECT id,seq FROM tasks WHERE state='pending' AND seq>? ORDER BY seq LIMIT 511");
  const funded = db.prepare("SELECT 1 FROM funded WHERE subject=?");
  let closed = false;
  const close = () => { if (closed) return; closed = true; db.close(); rmSync(temporaryPath(directory), { recursive: true, force: true }); };
  process.once("exit", close);
  return {
    add,
    count: () => Number(counts.get("pending")!.n) + Number(counts.get("assigned")!.n),
    waiting: () => Number(counts.get("pending")!.n),
    has: (id: string) => state.get(id)?.state === "pending" || state.get(id)?.state === "assigned",
    finish: (id: string) => { set.run("done", id, "pending"); set.run("done", id, "assigned"); },
    release: (id: string) => { set.run("pending", id, "assigned"); },
    isFunded: (subject: string) => funded.get(subject) !== undefined,
    /** Keep the current winner beside one bounded page, so global priority survives. */
    async claim(order?: (ids: readonly string[]) => Promise<readonly string[]>): Promise<string | null> {
      for (;;) {
        let winner: string | null = null, after = 0;
        for (;;) {
          const rows = page.all(after) as { id: string; seq: number }[];
          if (!rows.length) break;
          after = rows.at(-1)!.seq;
          if (!order) { winner = rows[0]!.id; break; }
          const ordered = await order(winner === null ? rows.map(row => row.id) : [winner, ...rows.map(row => row.id)]);
          winner = ordered.find(id => state.get(id)?.state === "pending") ?? null;
        }
        if (winner === null) return null;
        if (Number(set.run("assigned", winner, "pending").changes) === 1) return winner;
      }
    },
    *unfinished(): Iterable<string> {
      for (const row of db.prepare("SELECT id FROM tasks WHERE state!='done' ORDER BY seq").iterate()) yield String(row.id);
    },
    close: () => { process.removeListener("exit", close); close(); },
  };
}
