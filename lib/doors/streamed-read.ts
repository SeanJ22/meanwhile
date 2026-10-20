import { forEachAggregate, withHistoryIndex } from "../control-plane/workers/streamed-history.ts";
import { isDoorRecord, type DoorRecord, type DoorRepository } from "./registry.ts";
import type { ProbeResult } from "./probe.ts";
import type { ProbeRunCache } from "./hourly-check.ts";
import { stateOfPlace } from "../method/fix-map.ts";

/** The pass orders identities on disk and opens one door's configuration at a time. */
export async function visitDoorRecords(repo: DoorRepository,
  visit: (door: DoorRecord, cache: ProbeRunCache) => Promise<void>, order: "STATUS" | "CHECKED" = "STATUS",
  before?: (states: readonly string[]) => void): Promise<void> {
  await withHistoryIndex(async index => {
    index.exec("CREATE TABLE doors(id TEXT PRIMARY KEY,rank INTEGER NOT NULL,checked_at REAL NOT NULL,state TEXT NOT NULL); CREATE TABLE probes(url TEXT PRIMARY KEY,body TEXT NOT NULL,counted INTEGER NOT NULL DEFAULT 0)");
    const insert = index.prepare("INSERT INTO doors VALUES(?,?,?,?)");
    await forEachAggregate(repo, row => {
      const checked = Date.parse(row.value.validators?.checkedAt ?? "");
      insert.run(row.id, row.value.status === "SHUT" ? 0 : row.value.status === "SUSPENDED" ? 1 : 2,
        Number.isFinite(checked) ? checked : Number.MIN_SAFE_INTEGER, stateOfPlace(row.value.ocdId ?? "") ?? "");
    }, { status: true, validators: ["checkedAt"], ocdId: true });
    before?.([...index.prepare("SELECT DISTINCT state FROM doors WHERE state<>'' ORDER BY state").iterate()].map(row => row.state));
    const read = index.prepare("SELECT body FROM probes WHERE url=?");
    const put = index.prepare("INSERT INTO probes(url,body) VALUES (?,?)");
    const counted = index.prepare("SELECT counted FROM probes WHERE url=?"), count = index.prepare("UPDATE probes SET counted=1 WHERE url=?");
    const cache: ProbeRunCache = {
      get: url => { const row = read.get(url); return row ? JSON.parse(row.body) as ProbeResult : undefined; },
      put: (url, value) => { put.run(url, JSON.stringify(value)); },
      countOnce: url => { const first = Number(counted.get(url)?.counted ?? 0) === 0; count.run(url); return first; },
    };
    for (const entry of index.prepare(`SELECT id FROM doors ORDER BY ${order === "CHECKED" ? "checked_at" : "rank"},id`).iterate()) {
      const row = await repo.read(entry.id);
      if (row && isDoorRecord(row.value)) await visit(row.value, cache);
    }
  });
}
