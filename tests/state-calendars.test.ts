import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { calendarReadOrder, groupCalendarReadsByState, meetingPartitionState, stateCalendarEnvironment, stateCalendarMemberResults, stateCalendarsCovers, stateCalendarsId,
  type StateCalendarGroup } from "../lib/civic-data/state-calendars.ts";
import type { BoundedChildResult } from "../lib/civic-data/bounded-child-pass.ts";
import { SOURCE_CHECK_AFTER_ENV } from "../lib/sources/source-check-request.ts";

const boards = (state: string) => MEETING_PARTITION_CONTRACTS.filter((partition) => partition.derivedFamily === null && meetingPartitionState(partition) === state);
const run = (partition: (typeof MEETING_PARTITION_CONTRACTS)[number]) =>
  ({ kind: "MEETING_PARTITION", id: partition.id, task: { acquisitionFailureDomain: partition.acquisitionFailureDomain } });

test("due board reads become one program per state, where the state's first read stood; families and other tasks keep their own", () => {
  const [az1, az2] = boards("AZ"), [nh1] = boards("NH");
  const family = MEETING_PARTITION_CONTRACTS.find((partition) => partition.derivedFamily === "US-AZ")!;
  const other = { kind: "SINGLE", id: "openstates-votes:AZ", task: { acquisitionFailureDomain: "routine-source:openstates" } };
  const units = groupCalendarReadsByState([other, run(az1!), run(nh1!), run(family), run(az2!)]);
  assert.deepEqual(units.map((unit) => unit.id), ["openstates-votes:AZ", stateCalendarsId("AZ"), stateCalendarsId("NH"), family.id]);
  const az = units[1] as StateCalendarGroup<ReturnType<typeof run>>;
  assert.deepEqual(az.members.map((member) => member.id), calendarReadOrder([az1!, az2!]).map((partition) => partition.id));
  assert.deepEqual(az.command, ["scripts/ingest.ts", "composite", "--promote", ...az.members.map((member) => `--only-partition=${member.id}`)]);
});

test("boards of one upstream are spread through the state's list", () => {
  const reads = [["a", "x"], ["b", "x"], ["c", "y"], ["d", "x"], ["e", "z"]].map(([id, acquisitionFailureDomain]) => ({ id, acquisitionFailureDomain }));
  assert.deepEqual(calendarReadOrder(reads).map((read) => read.id), ["a", "c", "e", "b", "d"]);
});

test("a grouped state's read-now requests retain the newest source check and no unrelated environment values", () => {
  const early = "2026-10-22T20:00:00.000Z", latest = "2026-10-22T21:00:00.000Z";
  assert.deepEqual(stateCalendarEnvironment([{}, { env: { UNRELATED: "not-forwarded" } }]), {});
  assert.deepEqual(stateCalendarEnvironment([
    { env: { [SOURCE_CHECK_AFTER_ENV]: latest, UNRELATED: "not-forwarded" } }, {},
    { env: { [SOURCE_CHECK_AFTER_ENV]: early } },
  ]), { [SOURCE_CHECK_AFTER_ENV]: latest });
  assert.throws(() => stateCalendarEnvironment([{ env: { [SOURCE_CHECK_AFTER_ENV]: "not-a-time" } }]), /STATE_CALENDAR_SOURCE_CHECK_INVALID/);
});

test("calendar states take turns at the front without moving unrelated work or losing a state's boards", () => {
  const [az1, az2] = boards("AZ"), [nh] = boards("NH"), [nj] = boards("NJ");
  assert.ok(az1 && az2 && nh && nj);
  const other = { kind: "SINGLE", id: "unrelated", task: { acquisitionFailureDomain: "unrelated" } };
  const input = [run(az1), other, run(nh), run(nj), run(az2)];
  const heads = [];
  for (let seed = 0; seed < 3; seed++) {
    const units = groupCalendarReadsByState(input, seed);
    heads.push(units[0]!.id);
    assert.equal(units[1], other);
    assert.deepEqual(units.filter(unit => unit.kind === "STATE_CALENDARS")
      .flatMap(unit => (unit as StateCalendarGroup<ReturnType<typeof run>>).members.map(member => member.id)).sort(), [az1.id, az2.id, nh.id, nj.id].sort());
  }
  assert.deepEqual(heads, [stateCalendarsId("AZ"), stateCalendarsId("NH"), stateCalendarsId("NJ")]);
});

test("a state program's authority covers its own state's boards and nothing else", () => {
  const [az] = boards("AZ"), [nh] = boards("NH");
  assert.equal(stateCalendarsCovers(stateCalendarsId("AZ"), az!.id), true);
  assert.equal(stateCalendarsCovers(stateCalendarsId("AZ"), nh!.id), false);
  assert.equal(stateCalendarsCovers(null, az!.id), false);
  assert.equal(stateCalendarsCovers(stateCalendarsId("AZ"), "meetings:legistar:not-registered"), false);
});

const ended = (over: Partial<BoundedChildResult>): BoundedChildResult => ({ id: stateCalendarsId("AZ"), status: 0, signal: null, stdout: "", stderr: "",
  termination: "EXITED", errorMessage: null, ...over });
const receipt = (id: string) => `RCD_MEETING_PARTITION_RECEIPT=${JSON.stringify({ source: id, partitionId: id })}`;

test("each board settles from its own lines: a receipt, the error that stopped its read, or still owed", () => {
  const stdout = [receipt("a"), "noise", `RCD_MEETING_PARTITION_UNREAD=${JSON.stringify({ partitionId: "b", detail: "Error: boom" })}`,
    `RCD_MEETING_PARTITION_DEFERRED=${JSON.stringify({ partitionId: "c" })}`].join("\n");
  const [a, b, c] = stateCalendarMemberResults(ended({ stdout }), ["a", "b", "c"], true);
  assert.ok("run" in a! && a.run.status === 0 && a.run.id === "a" && a.run.stdout === receipt("a"));
  assert.ok("run" in b! && b.run.status === 1 && b.run.stderr === "Error: boom" && !b.run.stdout.includes("RCD_MEETING_PARTITION_RECEIPT"));
  assert.deepEqual(c, { id: "c", owed: "not started before the pass deadline" });
});

test("a program never started, or cut at the pass deadline, leaves its unread boards owed; any other ending lands on the board being read", () => {
  assert.deepEqual(stateCalendarMemberResults(ended({ termination: "SPAWN_FAILED", status: null, errorMessage: "WORKER_MEMORY_DEADLINE: memory wait deferred" }), ["a"], false),
    [{ id: "a", owed: "WORKER_MEMORY_DEADLINE: memory wait deferred" }]);
  const cut = stateCalendarMemberResults(ended({ stdout: receipt("a"), termination: "TIMED_OUT", status: null, signal: "SIGTERM",
    errorMessage: "PASS_TIME_BUDGET: the pass reached its deadline" }), ["a", "b"], true);
  assert.ok("run" in cut[0]! && cut[0].run.status === 0 && cut[0].run.termination === "EXITED", "a board read before the cut keeps its receipt");
  assert.deepEqual(cut[1], { id: "b", owed: "PASS_TIME_BUDGET: the pass reached its deadline" });
  const crash = stateCalendarMemberResults(ended({ stdout: `${receipt("a")}\nfatal`, status: null, signal: "SIGKILL" }), ["a", "b", "c"], true);
  assert.ok("run" in crash[1]! && crash[1].run.signal === "SIGKILL" && crash[1].run.id === "b" && !crash[1].run.stdout.includes(receipt("a")));
  assert.deepEqual(crash[2], { id: "c", owed: "the state's calendar program ended while reading b" });
});

test("the runner launches one program per state and the program reads its boards in turn, loading the state once", () => {
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(runner, /const units = groupCongressReads\(groupCalendarReadsByState\(runs, routineFailureDomainRotationSeed\(RUN_STARTED_AT\)\)\)/);
  assert.match(runner, /capability: "STATE_CALENDARS", contract: unit\.id/);
  const ingest = readFileSync("scripts/ingest.ts", "utf8");
  assert.match(ingest, /async function readStateCalendars/);
  assert.match(ingest, /agendaDocumentStore\.clear\(\);/);
  assert.equal((ingest.match(/await preloadCanonicalMeetingDependencies\(\{ sourceName: "composite", state \}\)/g) ?? []).length, 1, "the state's data loads once per program");
});
