import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { isScheduled, scheduleObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { blankDigest } from "../lib/hunt/packet-due.ts";
import { blankFingerprint, huntPacketObligationId, type HuntPacket } from "../lib/hunt/packet.ts";
import { duePackets } from "../lib/hunt/runtime.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";

const NOW = "2026-10-15T12:00:00.000Z";
const PIMA = "ocd-division/country:us/state:az/county:pima";
const COCHISE = "ocd-division/country:us/state:az/county:cochise";

const packet = (governmentId: string): HuntPacket => ({ governmentId, label: governmentId, held: [],
  blanks: [{ subjectId: `${governmentId}#board`, subjectLabel: "Board", checklistId: "MTG-01", family: "MTG", requirement: "Regular meeting schedule" }] });
const obligation = (governmentId: string) => ({ id: huntPacketObligationId(governmentId), recordClass: "HUNT_PACKET", subjectId: governmentId,
  routeId: "hunter:packet", active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: "2026-10-14T12:00:00.000Z" });

test("one due check reads shut doors, Ask's gaps and every last job once, and a packet with nothing new waits on its own row", async () => {
  const repos = createMemoryRepositories();
  const lastJob = { attemptId: "a1", obligationId: huntPacketObligationId(PIMA), recordedAt: "2026-10-14T12:00:00.000Z",
    blankFingerprint: blankFingerprint(packet(PIMA)), blankDigests: packet(PIMA).blanks.map(blankDigest), rungs: [{ observed: "x".repeat(10_000) }] } as unknown as ScoutResult;
  await repos.scoutResults.append(lastJob.obligationId, lastJob.attemptId, lastJob, lastJob.recordedAt);
  await repos.obligations.put(huntPacketObligationId(PIMA), obligation(PIMA) as never, NOW);
  const reads: string[][] = [], doorReads: unknown[] = [];
  let gapReads = 0;
  const latest = repos.scoutResults.readLatest.bind(repos.scoutResults), shut = repos.doors.listWhereNarrowed.bind(repos.doors), gaps = repos.askGapObservations.list.bind(repos.askGapObservations);
  repos.scoutResults.readLatest = async (keys, projection) => {
    reads.push([...keys]);
    assert.deepEqual(Object.keys(projection).sort(), ["blankDigests", "blankFingerprint", "recordedAt"], "the steps a job walked are never read to decide due");
    return latest(keys, projection);
  };
  repos.doors.listWhereNarrowed = async (path, value, projection) => { doorReads.push([path, value]); return shut(path, value, projection); };
  repos.doors.list = async () => { throw new Error("the whole doors table is never read"); };
  repos.askGapObservations.list = async () => { gapReads++; return gaps(); };
  const due = await duePackets(repos, [{ governmentId: PIMA }, { governmentId: COCHISE }], NOW, async ids => new Map(ids.map(id => [id, packet(id)])));
  assert.deepEqual([reads, doorReads, gapReads], [[[huntPacketObligationId(PIMA), huntPacketObligationId(COCHISE)]], [[["status"], "SHUT"]], 1]);
  assert.equal(due.get(COCHISE)?.due, true, "a packet never hunted is due");
  assert.equal(due.get(PIMA)?.due, false);
  const held = (await repos.obligations.read(huntPacketObligationId(PIMA)))!.value as { waiting?: unknown };
  assert.deepEqual(held.waiting, { since: NOW, until: "2026-10-19T12:00:00.000Z" }, "it waits until the dead end's limit counted from its last job");
});

test("a waiting packet is not due before its time unless an order reaches it after the wait began", () => {
  const waiting = { since: "2026-10-15T00:00:00.000Z", until: "2026-10-19T12:00:00.000Z" };
  const row = { ...obligation(PIMA), waiting };
  const held = scheduleObligation(row, Date.parse(NOW));
  assert.ok(isScheduled(held));
  assert.deepEqual([held.nextDueAt, held.cadenceSource], [waiting.until, "WAITING_FOR_CHANGE"]);
  const order = (at: string) => ({ ...row, assignments: [{ at, assignmentKey: "send-1", ref: "ref-1", relation: "CREATED" as const }] });
  const seen = scheduleObligation(order("2026-10-14T06:00:00.000Z"), Date.parse(NOW));
  assert.ok(isScheduled(seen) && seen.cadenceSource === "WAITING_FOR_CHANGE", "an order the last check already saw");
  const woken = scheduleObligation(order("2026-10-15T06:00:00.000Z"), Date.parse(NOW));
  assert.ok(isScheduled(woken) && woken.cadenceSource !== "WAITING_FOR_CHANGE", "a new order wakes it");
  const over = scheduleObligation(row, Date.parse("2026-10-20T00:00:00.000Z"));
  assert.ok(isScheduled(over) && over.cadenceSource !== "WAITING_FOR_CHANGE", "a wait that ran out holds nothing");
});
