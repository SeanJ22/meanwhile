import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { applyManualEdit, checkDoorDraft, listDoors } from "../lib/doors/registry.ts";
import { readRunnerDoors } from "../lib/doors/runner-reads.ts";
import { planProbes } from "../lib/doors/hourly-check.ts";
import { pageDoorsDue } from "../lib/doors/page-refresh.ts";
import { doorPartitionIds, readNowDueRequests } from "../lib/doors/mission-refresh.ts";
import { editDeriveDueRequests } from "../lib/doors/edit-derive.ts";
import { publishNowDoorTasks } from "../lib/civic-data/publish-now.ts";
import { DOOR_DERIVE_CONTRACT_IDS } from "../lib/civic-data/routine-due-request.ts";
import type { RoutineSourceTask } from "../lib/civic-data/runner.ts";

const before = "2026-10-25T00:00:00.000Z", now = "2026-10-25T12:00:00.000Z";
const changed = "2026-10-25T11:59:00.000Z";

test("runner selectors choose the same probes, pages and due work without receiving saved page bodies, and observe later changes", async t => {
  const { doors: repo } = createMemoryRepositories();
  for (const [id, kind, status, readNow] of [["hot-a", "ical", "OPEN", true], ["page-a", "page", "OPEN", false],
    ["shut-a", "ical", "SHUT", false], ["aside-a", "page", "SUSPENDED", true]] as const) {
    const draft = checkDoorDraft({ doorId: id, kind, status, hosts: ["city.example.gov"], bodyIds: ["ocd-division/country:us/state:az/place:example"],
      ocdId: "ocd-division/country:us/state:az", holds: ["meetings"],
      config: { feedUrl: "https://city.example.gov/calendar", url: "https://city.example.gov/page", workItemId: "held-work",
        savedPageText: "DO_NOT_TRANSFER_SAVED_PAGE".repeat(10_000), extractionPlan: "held-input".repeat(1000) },
      meeting: kind === "ical" ? { agendaSourceType: "ICAL", jurisdiction: "Example", publishingOrg: "Example", timeZone: "America/Phoenix", verifiedAt: before } : null });
    assert.ok(draft.ok, draft.ok ? "" : draft.why); if (!draft.ok) return;
    const door = { ...applyManualEdit(null, draft.value, before), readNow, editedAt: changed, updatedAt: changed, lastSuccessAt: before,
      validators: { etag: "etag", lastModified: null, contentHash: "sha", checkedAt: before, changedAt: changed } };
    await repo.put(id, door, before);
  }
  const all = (await listDoors(repo)).doors;
  const whole = t.mock.method(repo, "list", async () => { throw Error("whole door read reached"); });
  const open = await readRunnerDoors(repo, ["status"], "OPEN"), hot = new Set(all.flatMap(doorPartitionIds));
  assert.deepEqual(planProbes(open, hot, now).doors.map(door => door.doorId), planProbes(all, hot, now).doors.map(door => door.doorId));
  assert.deepEqual(readNowDueRequests(await readRunnerDoors(repo, ["readNow"], "true"), hot, now), readNowDueRequests(all, hot, now));
  assert.deepEqual(editDeriveDueRequests(await readRunnerDoors(repo, ["origin"], "MANUAL"), new Set(DOOR_DERIVE_CONTRACT_IDS), now),
    editDeriveDueRequests(all, new Set(DOOR_DERIVE_CONTRACT_IDS), now));
  assert.deepEqual(pageDoorsDue(await readRunnerDoors(repo, ["kind"], "page"), now).map(door => door.doorId), pageDoorsDue(all, now).map(door => door.doorId));
  const tasks = [...hot].map(id => ({ id }) as RoutineSourceTask);
  assert.deepEqual(publishNowDoorTasks(open, tasks, now), publishNowDoorTasks(all, tasks, now));
  assert.ok(!JSON.stringify(open).includes("DO_NOT_TRANSFER_SAVED_PAGE"));
  assert.ok(!JSON.stringify(open).includes("extractionPlan"));
  assert.equal(whole.mock.callCount(), 0);
  const row = await repo.mustRead("hot-a");
  await repo.compareAndSet(row.id, row.revision, { ...row.value, lastSuccessAt: now }, now);
  assert.equal(publishNowDoorTasks(await readRunnerDoors(repo, ["status"], "OPEN"), tasks, now).length,
    publishNowDoorTasks(open, tasks, now).length - 1, "the post-probe read observes newly settled work");
  assert.equal((await repo.mustRead("hot-a")).value.config.savedPageText, row.value.config.savedPageText, "stored evidence is retained");
});
