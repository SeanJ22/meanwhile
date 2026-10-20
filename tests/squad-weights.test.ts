import { orderedAutonomousWorkIds, readCoordinatorWeights } from "./helpers/ordered-autonomous-work.ts";
/**
 * Squads are sized to their parts, and hunters move to the gaps. The coordinator's fairness is round-robin
 * over (Send, part), weighted by each part's open blanks and recent difficulty, re-read every wave.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import type { RouteTask } from "../lib/control-plane/route-task.ts";
import type { FreshnessDebt } from "../lib/control-plane/scheduler/debt.ts";
import { runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import { partOfItem, squadKey } from "../lib/control-plane/workers/squad-weights.ts";
import { autonomousHarness } from "./helpers/autonomous-fleet.ts";

const now = "2026-10-05T21:00:00Z";
const CLASS = { "governments-meetings": "MEETING", "people-money": "OFFICIAL_ROSTER", ballot: "BALLOT_CONTEST" } as const;
function work(id: string, send: string, part: keyof typeof CLASS, createdAt = "2026-10-05T00:00:00Z"): WorkItem {
  return { id, createdAt, subject: `subject:${id}`,
    autonomousPlan: { ownerInstructions: [send], missionPart: part, contract: { recordClass: CLASS[part] } } } as unknown as WorkItem;
}
const weightsFrom = (table: Record<string, number>) => ({ partOf: (item: WorkItem) => partOfItem(item),
  weightOf: (send: string, part: string) => table[`${send}/${part}`] ?? 1 });

test("a part's turns follow its weight; a part with no open blanks gets none while another has work", async () => {
  const items = [...Array.from({length:6}, (_, i) => work(`a${i+1}`, "send-a", "governments-meetings")),
    ...Array.from({length:2}, (_, i) => work(`b${i+1}`, "send-a", "people-money")), work("z1", "send-a", "ballot")];
  const order = await orderedAutonomousWorkIds(items, new Map(), [],
    weightsFrom({"send-a/governments-meetings":3,"send-a/people-money":1,"send-a/ballot":0}));
  assert.deepEqual(order.slice(0, 4).filter((id) => id.startsWith("a")).length, 3, "three of every four turns go to the heavier part");
  assert.equal(order.at(-1), "z1", "an empty part waits behind every part with open blanks");
  assert.equal(order.length, 9, "no item is dropped");
});

test("fairness is round-robin over Sends first, then weighted over each Send's parts", async () => {
  const items = [
    ...["g1", "g2", "g3", "g4"].map((id) => work(id, "send-a", "governments-meetings")),
    ...["p1", "p2"].map((id) => work(id, "send-a", "people-money")),
    work("x1", "send-b", "ballot"), work("x2", "send-b", "ballot"),
  ];
  const priorities = [{ receiptId: "send-a", priority: 0 }, { receiptId: "send-b", priority: 1 }];
  const plain = await orderedAutonomousWorkIds(items, new Map(), priorities);
  assert.deepEqual(plain.slice(0, 4), ["g1", "x1", "p1", "x2"], "with no reading each Send alternates its parts");
  const weighted = await orderedAutonomousWorkIds(items, new Map(), priorities,
    weightsFrom({ "send-a/governments-meetings": 0, "send-a/people-money": 5, "send-b/ballot": 1 }));
  assert.deepEqual(weighted.filter((id) => !id.startsWith("x")), ["p1", "p2", "g1", "g2", "g3", "g4"], "the emptied part follows the part with gaps");
  assert.deepEqual(weighted.slice(0, 2), ["p1", "x1"], "another Send still gets its turn between them");
  assert.equal(new Set(weighted).size, items.length);
});

test("weights are open blanks times difficulty: the Send's recent detective turns and open debts on that part", async () => {
  const items = [work("g1", "send-a", "governments-meetings"), work("p1", "send-a", "people-money"), work("s1", "standing", "ballot")];
  const detective = (workItemId: string, createdAt: string) => ({ workItemId, createdAt, workerTask: { role: "DETECTIVE" } }) as unknown as RouteTask;
  const debt = (workItemId: string) => ({ debt: { obligationId: `o:${workItemId}` } as FreshnessDebt, workItemId });
  const weights = await readCoordinatorWeights({ items, priority: new Map([["send-a", 0]]), now,
    reading: { open: new Map([["send-a", new Map([["governments-meetings", 10], ["people-money", 10]])]]) },
    routeTasks: [detective("p1", "2026-10-05T20:00:00Z"), detective("p1", "2026-10-05T19:00:00Z"), detective("g1", "2026-10-03T00:00:00Z")],
    debts: [debt("p1"), debt("g1")] });
  const g = weights.get(squadKey("send-a", "governments-meetings"))!;
  const p = weights.get(squadKey("send-a", "people-money"))!;
  assert.equal(g.detectiveTurns, 0, "a detective turn older than the window does not count");
  assert.equal(p.detectiveTurns, 2);
  assert.equal(g.weight, 10 * (1 + 0 + 0.5));
  assert.equal(p.weight, 10 * (1 + 1 + 0.5), "the harder part gets more turns at equal open blanks");
  const standing = weights.get(squadKey("standing", "ballot"))!;
  assert.equal(standing.open, null, "work no Send ordered has no open-blank reading");
  assert.equal(standing.weight, 1, "no reading never stops a part");
  const emptied = await readCoordinatorWeights({ items, priority: new Map([["send-a", 0]]), now, routeTasks: [], debts: [],
    reading: { open: new Map([["send-a", new Map([["people-money", 4]])]]) } });
  assert.equal(emptied.get(squadKey("send-a", "governments-meetings"))!.weight, 0, "a part whose blanks are all filled stops getting turns");
});

test("the coordinator reads the wave's open blanks and reports each (Send, part) weight", async () => {
  const h = await autonomousHarness();
  const send = h.item.autonomousPlan?.ownerInstructions?.[0] ?? "standing";
  const report = await runAutonomousCoordinator(h.runtime, { planOnly: true,
    squads: { open: new Map([[send, new Map([["people-money", 3]])]]) } });
  assert.ok(report.squadWeights.length >= 1);
  assert.ok(report.squadWeights.every((row) => Number.isFinite(row.weight)));
  const plain = await runAutonomousCoordinator(h.runtime, { planOnly: true });
  assert.deepEqual(plain.squadWeights, [], "no reading, no weights and no extra reads");
});
