import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { applyManualEdit, checkDoorDraft, type DoorDraft, type DoorRecord } from "../lib/doors/registry.ts";
import { recordDoorEvidence } from "../lib/doors/shut.ts";
import { parseShutDoorId, readShutDoors, shutDoorObligationId, shutDoorsProvider } from "../lib/control-plane/scheduler/providers/shut-doors.ts";

const CTX = { root: ".", nowIso: "2026-10-04T13:00:00.000Z" };

function door(draft: DoorDraft): DoorRecord {
  const checked = checkDoorDraft(draft);
  assert.ok(checked.ok);
  return applyManualEdit(null, checked.value, "2026-10-04T12:00:00.000Z");
}

describe("DB-33: a shut door gets work at once", () => {
  const open = door({ doorId: "synthetic:open", kind: "official-page-events", hosts: ["a.example.invalid"], config: { pageUrl: "https://a.example.invalid/x" } });
  const shutOld = { ...door({ doorId: "synthetic:old", kind: "ical", hosts: ["b.example.invalid"], config: { icalUrl: "https://b.example.invalid/c.ics" } }), status: "SHUT" as const, shutSince: "2026-10-04T08:00:00.000Z", shutReason: "the address answers 404", lastSuccessAt: "2026-10-03T08:00:00.000Z" };
  const shutNew = { ...door({ doorId: "synthetic:new", kind: "diligent", hosts: ["c.example.invalid"] }), status: "SHUT" as const, shutSince: "2026-10-04T11:00:00.000Z", shutReason: "3 reads in a row could not reach it" };

  it("emits one obligation per shut door, longest shut first, and none for an open one", () => {
    const yielded = shutDoorsProvider({ doors: () => ({ doors: [open, shutNew, shutOld] }) }).enumerate(CTX);
    assert.deepEqual(yielded.obligations.map((o) => o.subjectId), ["synthetic:old", "synthetic:new"]);
    assert.equal(yielded.readFailure, null);
  });

  it("hands the detective the door's own evidence and a model-class route", () => {
    const [first] = shutDoorsProvider({ doors: () => ({ doors: [shutOld] }) }).enumerate(CTX).obligations;
    const route = first!.routes[0]!;
    assert.equal(route.executorClass, "BOUNDED_MODEL_WORKER");
    assert.match(route.executorReason, /404/);
    assert.match(route.executorReason, /2026-10-03T08:00:00/);
    assert.match(route.executorReason, /b\.example\.invalid/);
    assert.deepEqual(route.open, { kind: "HTTP_GET", url: "https://b.example.invalid/c.ics" });
    assert.equal(first!.readerImpactAt, shutOld.shutSince);
  });

  it("a registry that cannot be read is a named failure, never an empty list", () => {
    const yielded = shutDoorsProvider({ doors: () => ({ unreadable: "store down" }) }).enumerate(CTX);
    assert.equal(yielded.obligations.length, 0);
    assert.match(yielded.readFailure ?? "", /store down/);
    assert.equal(yielded.emptyReason, null);
  });

  it("an empty registry says why it is empty", () => {
    const yielded = shutDoorsProvider({ doors: () => ({ doors: [open] }) }).enumerate(CTX);
    assert.match(yielded.emptyReason ?? "", /no door/);
  });

  it("ids round-trip", () => {
    assert.equal(parseShutDoorId(shutDoorObligationId("meetings:x:y#z")), "meetings:x:y#z");
    assert.equal(parseShutDoorId("freshness:meetings:foo"), null);
  });

  it("the synthetic door that DB-32 shuts becomes work in the same pass", async () => {
    const repos = createMemoryRepositories();
    const draft = door({ doorId: "synthetic:never-served", kind: "official-page-events", hosts: ["d.example.invalid"] });
    await repos.doors.put(draft.doorId, draft, "2026-10-04T12:00:00.000Z");
    await recordDoorEvidence(repos.doors, draft.doorId, { kind: "HTTP", httpStatus: 410 }, "2026-10-04T12:05:00.000Z");
    const reading = await readShutDoors(repos.doors);
    const yielded = shutDoorsProvider({ doors: () => reading }).enumerate(CTX);
    assert.deepEqual(yielded.obligations.map((o) => o.subjectId), ["synthetic:never-served"]);
  });
});
