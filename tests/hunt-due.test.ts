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
const signals = (over: Partial<PacketSignals> = {}): PacketSignals => ({ doors: new Map(), askedOn: new Map(), changedAt: new Map(), maxWaitMs: 5 * DAY, ...over });

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
  assert.equal(packetWoken(row, signals({ askedOn: new Map([[PIMA, "2026-10-16"]]) })), "a question Ask could not answer");
  assert.equal(packetWoken(row, signals({ askedOn: new Map([[PIMA, "2026-10-15"]]) })), null, "a question on the day the wait began");
  assert.equal(packetWoken(row, signals({ changedAt: new Map([[PIMA, "2026-10-15T09:00:00.000Z"]]) })), "its held data changed");
  assert.equal(packetWoken(row, signals({ changedAt: new Map([[COCHISE, "2026-10-15T09:00:00.000Z"]]) })), null, "another place's change");
});

test("a cycle reads shut doors once and Ask's gaps and held changes only for the days since the oldest wait", async () => {
  const repos = createMemoryRepositories();
  const gap = (day: string, bodyId: string) => repos.askGapObservations.put(`${day}|${bodyId}|MEETINGS_NOT_HELD`,
    { bodyId, code: "MEETINGS_NOT_HELD", recordClass: "MEETING", day, count: 1 } as never, NOW);
  await gap("2026-10-01", `${COCHISE}#board`);
  await gap("2026-10-13", `${PIMA}#board`);
  await gap("2026-10-14", `${PIMA}#planning`);
  let doorLists = 0;
  const days: string[] = [];
  const doors = repos.doors.listWhereNarrowed.bind(repos.doors), gaps = repos.askGapObservations.listWhereNarrowed.bind(repos.askGapObservations);
  repos.doors.listWhereNarrowed = async (path, value, projection) => {
    doorLists++;
    assert.deepEqual([path, value], [["status"], "SHUT"], "only shut doors are read");
    return doors(path, value, projection);
  };
  repos.askGapObservations.list = async () => { throw new Error("the whole table is never read"); };
  repos.askGapObservations.listWhereNarrowed = async (path, value, projection) => {
    assert.deepEqual([path, Object.keys(projection).sort()], [["day"], ["bodyId", "day"]]);
    days.push(value);
    return gaps(path, value, projection);
  };
  const since: string[] = [];
  const read = await readPacketSignals(repos, NOW, "2026-10-12T00:00:00.000Z", async from => { since.push(from); return new Map([[PIMA, NOW]]); });
  assert.deepEqual([doorLists, days, since], [1, ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"], ["2026-10-12T00:00:00.000Z"]]);
  assert.deepEqual([...read.askedOn], [[PIMA, "2026-10-14"]], "each government's newest stumped day; older days are never read");
  assert.equal(read.changedAt.get(PIMA), NOW);
  days.length = 0;
  const none = await readPacketSignals(repos, NOW, null, async () => { throw new Error("no wait, no change read"); });
  assert.deepEqual([none.changedAt.size, none.askedOn.size, days.length], [0, 0, 0]);
});
