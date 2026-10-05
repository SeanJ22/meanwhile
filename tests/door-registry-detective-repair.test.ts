import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { applyManualEdit, checkDoorDraft } from "../lib/doors/registry.ts";
import { recordDoorEvidence } from "../lib/doors/shut.ts";
import { groundedCandidate, useDetectiveFind } from "../lib/doors/detective-repair.ts";

const T = (h: number) => `2026-10-05T${String(10 + h).padStart(2, "0")}:00:00.000Z`;
const ID = "synthetic:moved-page";
const candidate = (over: Record<string, unknown> = {}) => ({
  routeId: "r", title: "t", url: "https://new.example.invalid/meetings", procedure: "GET", relevance: "", permission: "ALLOWED",
  permissionReading: "", evidenceArtifactIds: ["a1"], observedOn: "2026-10-05", recordClass: "MEETING", deterministic: true, unverified: [], ...over,
}) as never;

async function shut() {
  const repos = createMemoryRepositories();
  const checked = checkDoorDraft({ doorId: ID, kind: "official-page-events", hosts: ["old.example.invalid"], config: { pageUrl: "https://old.example.invalid/meetings" }, holds: ["meetings"] });
  assert.ok(checked.ok);
  await repos.doors.put(ID, applyManualEdit(null, checked.value, T(0)), T(0));
  await recordDoorEvidence(repos.doors, ID, { kind: "HTTP", httpStatus: 404 }, T(1), repos);
  return repos;
}

describe("DP-12: a detective's door repair is used on the very next check", () => {
  it("only a replayable, allowed, https candidate with saved evidence is used", () => {
    assert.equal(groundedCandidate({ candidates: [candidate({ deterministic: false })] }), null);
    assert.equal(groundedCandidate({ candidates: [candidate({ evidenceArtifactIds: [] })] }), null);
    assert.equal(groundedCandidate({ candidates: [candidate({ permission: "DISALLOWED" })] }), null);
    assert.equal(groundedCandidate({ candidates: [candidate({ unverified: ["field"] })] }), null);
    assert.equal(groundedCandidate({ candidates: [candidate({ url: "http://x.example.invalid" })] }), null);
    assert.ok(groundedCandidate({ candidates: [candidate()] }));
  });
  it("writes the new address at once, labeled Testing, read now, and reopens only when a read works", async () => {
    const repos = await shut();
    const r = await useDetectiveFind(repos, ID, { candidates: [candidate()] }, T(2));
    assert.ok(r.ok);
    const door = (await repos.doors.read(ID))!.value;
    assert.deepEqual(door.hosts, ["new.example.invalid"]);
    assert.equal(door.config.pageUrl, "https://new.example.invalid/meetings");
    assert.match(door.notes, /^Testing:/);
    assert.equal(door.readNow, true);
    assert.equal(door.status, "SHUT");
    await recordDoorEvidence(repos.doors, ID, { kind: "GOOD", rows: 3 }, T(3), repos);
    assert.equal((await repos.doors.read(ID))!.value.status, "OPEN");
  });
  it("changes nothing without a grounded find, for an unknown door, or when the address is already read", async () => {
    const repos = await shut();
    const before = JSON.stringify((await repos.doors.read(ID))!.value);
    assert.equal((await useDetectiveFind(repos, ID, { candidates: [candidate({ deterministic: false })] }, T(2))).ok, false);
    assert.equal((await useDetectiveFind(repos, "nope", { candidates: [candidate()] }, T(2))).ok, false);
    assert.equal((await useDetectiveFind(repos, ID, { candidates: [candidate({ url: "https://old.example.invalid/meetings" })] }, T(2))).ok, false);
    assert.equal(JSON.stringify((await repos.doors.read(ID))!.value), before);
  });
});
