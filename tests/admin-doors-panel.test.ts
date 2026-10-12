/**
 * The command center shows the Door Registry and the door.save receipts in plain
 * English: counts, shut doors first with why and since when, and the newest changes, never a door's id.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { submit } from "@/lib/control-plane/gateway/gateway.ts";
import { ADMIN_RECEIPT_LOG_KEY, type ActionReceipt } from "@/lib/control-plane/gateway/contract.ts";
import { listDoors } from "@/lib/doors/registry.ts";
import { DOOR_CHANGES_SHOWN, projectDoors } from "@/lib/control-plane/admin-view/v6-doors-read.ts";

const AT = "2026-10-04T12:00:00.000Z";

async function save(repos: ReturnType<typeof createMemoryRepositories>, input: Record<string, unknown>, key: string, at: string) {
  return submit({ type: "door.save", subject: String(input.doorId), input, stateVersion: null, idempotencyKey: key, caller: "OWNER_SESSION", actorRef: "owner" },
    { repos, now: () => at, currentStateVersion: null, codeSha: null });
}

test("doors show counts, shut doors first in words, and the newest door changes with no ids", async () => {
  const repos = createMemoryRepositories();
  assert.equal((await save(repos, { doorId: "meetings:test:body-one", kind: "ical", hosts: ["calendar.example.gov"], holds: ["meetings"] }, "door-save-one", AT)).ok, true);
  assert.equal((await save(repos, { doorId: "votes:test:body-two", kind: "rollcall", hosts: ["votes.example.gov"], holds: ["votes"], status: "SUSPENDED" }, "door-save-two", "2026-10-04T12:05:00.000Z")).ok, true);
  const { doors, unreadable } = await listDoors(repos.doors);
  const saves = await repos.adminReceipts.readRecentWhere(ADMIN_RECEIPT_LOG_KEY, ["type"], "door.save", DOOR_CHANGES_SHOWN,
    { subject: true, says: true, outcome: true, startedAt: true, completedAt: true }) as readonly ActionReceipt[];
  const view = projectDoors({ doors, unreadable, saves, observedAt: AT });
  assert.deepEqual(view.counts, { open: 1, shut: 0, setAside: 1, unreadable: 0 });
  assert.deepEqual(view.rows.map((r) => [r.name, r.kind, r.status]), [["Votes on votes.example.gov", "Rollcall", "Set aside"], ["Meetings on calendar.example.gov", "Ical", "Open"]]);
  assert.equal(view.total, 2);
  assert.deepEqual(view.rows.map((r) => [r.body, r.lastWorked, r.lastFailed]), [["—", null, null], ["—", null, null]]);
  assert.deepEqual(view.changes.map((c) => c.says), ["Door added: Votes on votes.example.gov (set aside)", "Door added: Meetings on calendar.example.gov (open)"]);
  for (const text of [...view.rows.map((r) => r.name), ...view.changes.map((c) => c.says)]) assert.doesNotMatch(text, /body-one|body-two|meetings:|votes:/);
});
