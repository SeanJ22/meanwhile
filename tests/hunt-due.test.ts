import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { isScheduled, scheduleObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { blankDigest } from "../lib/hunt/packet-due.ts";
import { blankFingerprint, huntPacketObligationId, type HuntPacket } from "../lib/hunt/packet.ts";
import { duePackets, packetWoken, readPacketSignals, type PacketSignals } from "../lib/hunt/runtime.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";

const NOW = "2026-10-15T12:00:00.000Z";
const PIMA = "ocd-division/country:us/state:az/county:pima";
const COCHISE = "ocd-division/country:us/state:az/county:cochise";
const DAY = 86_400_000;

const packet = (governmentId: string): HuntPacket => ({ governmentId, label: governmentId, held: [],
  blanks: [{ subjectId: `${governmentId}#board`, subjectLabel: "Board", checklistId: "MTG-01", family: "MTG", requirement: "Regular meeting schedule" }] });
const signals = (over: Partial<PacketSignals> = {}): PacketSignals => ({ doors: new Map(), asked: [], changedAt: new Map(), maxWaitMs: 5 * DAY, ...over });

test("the due check reads every packet's last job in one narrowed read and tells a packet with nothing new how long to wait", async () => {
  const repos = createMemoryRepositories();
  const lastJob = { attemptId: "a1", obligationId: huntPacketObligationId(PIMA), recordedAt: "2026-10-14T12:00:00.000Z",
    blankFingerprint: blankFingerprint(packet(PIMA)), blankDigests: packet(PIMA).blanks.map(blankDigest), rungs: [{ observed: "x".repeat(10_000) }] } as unknown as ScoutResult;
  await repos.scoutResults.append(lastJob.obligationId, lastJob.attemptId, lastJob, lastJob.recordedAt);
  const reads: string[][] = [];
  const latest = repos.scoutResults.readLatest.bind(repos.scoutResults);
  repos.scoutResults.readLatest = async (keys, projection) => {
    reads.push([...keys]);
    assert.deepEqual(Object.keys(projection).sort(), ["blankDigests", "blankFingerprint", "recordedAt"], "the steps a job walked are never read to decide due");
    return latest(keys, projection);
  };
  const due = await duePackets(repos, [{ governmentId: PIMA }, { governmentId: COCHISE }], NOW, signals(),
    async ids => new Map(ids.map(id => [id, packet(id)])));
  assert.deepEqual(reads, [[huntPacketObligationId(PIMA), huntPacketObligationId(COCHISE)]]);
  assert.equal(due.get(COCHISE)?.due, true, "a packet never hunted is due");
  const pima = due.get(PIMA)!;
  assert.equal(pima.due, false);
  assert.equal(pima.waitUntil, "2026-10-19T12:00:00.000Z", "it waits until the dead end's limit counted from its last job");
});

test("a waiting packet is not due before its time, and only an order, a shut door, a question or a held change wakes it", () => {
  const waiting = { since: "2026-10-15T00:00:00.000Z", until: "2026-10-19T12:00:00.000Z" };
  const row = { id: huntPacketObligationId(PIMA), recordClass: "HUNT_PACKET", subjectId: PIMA, routeId: "hunter:packet", active: true,
    readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: "2026-10-14T12:00:00.000Z", waiting };
  const scheduled = scheduleObligation(row, Date.parse(NOW));
  assert.ok(isScheduled(scheduled));
  assert.equal(scheduled.nextDueAt, waiting.until);
  assert.equal(scheduled.cadenceSource, "WAITING_FOR_CHANGE");
  assert.equal(packetWoken(row, signals()), null);
  assert.equal(packetWoken({ ...row, assignments: [{ at: "2026-10-15T06:00:00.000Z" }] } as never, signals()), "a new order");
  assert.equal(packetWoken({ ...row, assignments: [{ at: "2026-10-14T06:00:00.000Z" }] } as never, signals()), null, "an order the last check already saw");
  assert.equal(packetWoken(row, signals({ doors: new Map([[PIMA, [{ doorId: "d1", shutSince: "2026-10-15T08:00:00.000Z", evidence: "403" }]]]) })), "a door shut");
  assert.equal(packetWoken(row, signals({ asked: [{ bodyId: `${PIMA}#board`, code: "MEETINGS_NOT_HELD", recordClass: "MEETING", asks: 2, days: 1,
    firstDay: "2026-10-16", lastDay: "2026-10-16" }] as never })), "a question Ask could not answer");
  assert.equal(packetWoken(row, signals({ changedAt: new Map([[PIMA, "2026-10-15T09:00:00.000Z"]]) })), "its held data changed");
  assert.equal(packetWoken(row, signals({ changedAt: new Map([[COCHISE, "2026-10-15T09:00:00.000Z"]]) })), null, "another place's change");
});

test("a cycle reads shut doors and Ask's gaps once for every packet, and held changes only since the oldest wait", async () => {
  const repos = createMemoryRepositories();
  let doorLists = 0, gapLists = 0;
  const doors = repos.doors.listWhereNarrowed.bind(repos.doors), gaps = repos.askGapObservations.list.bind(repos.askGapObservations);
  repos.doors.listWhereNarrowed = async (path, value, projection) => {
    doorLists++;
    assert.deepEqual([path, value], [["status"], "SHUT"], "only shut doors are read");
    return doors(path, value, projection);
  };
  repos.askGapObservations.list = async () => { gapLists++; return gaps(); };
  const since: string[] = [];
  const read = await readPacketSignals(repos, NOW, "2026-10-12T00:00:00.000Z", async from => { since.push(from); return new Map([[PIMA, NOW]]); });
  assert.deepEqual([doorLists, gapLists, since], [1, 1, ["2026-10-12T00:00:00.000Z"]]);
  assert.equal(read.changedAt.get(PIMA), NOW);
  assert.equal((await readPacketSignals(repos, NOW, null, async () => { throw new Error("no wait, no change read"); })).changedAt.size, 0);
});
