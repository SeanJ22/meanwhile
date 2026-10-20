import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DOOR_DERIVE_CONTRACT_IDS, routineDueRequestFor } from "../lib/civic-data/routine-due-request.ts";
import { applyManualEdit, checkDoorDraft } from "../lib/doors/registry.ts";
import { editDeriveDueRequests } from "../lib/doors/edit-derive.ts";

const at = (m: number) => new Date(Date.parse("2026-10-05T12:00:00.000Z") + m * 60_000).toISOString();
const known = new Set<string>(DOOR_DERIVE_CONTRACT_IDS);
function door(id: string, editedMinute: number, status: "OPEN" | "SUSPENDED" = "OPEN") {
  const checked = checkDoorDraft({ doorId: id, kind: "official-page-events", ocdId: "ocd-division/country:us/state:az/county:pima", hosts: ["a.example.invalid"], holds: ["meetings"], status });
  assert.ok(checked.ok);
  return applyManualEdit(null, checked.value, at(editedMinute));
}

describe("DB-36: a door edit is applied at once, not on a six-hour clock", () => {
  it("a freshly edited door makes both derive steps due from the edit", () => {
    const requests = editDeriveDueRequests([door("d:one", 0)], known, at(5));
    assert.deepEqual(requests.map((r) => r.contractId).sort(), ["meeting-body-crosswalk-derived:AZ", "meeting-source-wiring:AZ"]);
    assert.ok(requests.every((r) => r.dueAt === at(0) && r.id.startsWith("door-edit-derive:d:one:")));
  });
  it("an old edit, a set-aside door and a derive step the pass does not know ask for nothing", () => {
    assert.equal(editDeriveDueRequests([door("d:old", 0)], known, at(3 * 60)).length, 0);
    assert.equal(editDeriveDueRequests([door("d:aside", 0, "SUSPENDED")], known, at(5)).length, 0);
    assert.equal(editDeriveDueRequests([door("d:one", 0)], new Set(), at(5)).length, 0);
  });
  it("the runner's due check honours the request for a derive task, and still ignores other non-meeting tasks", () => {
    const request = editDeriveDueRequests([door("d:one", 0)], known, at(5)).find((r) => r.contractId === "meeting-source-wiring:AZ");
    const derive = { id: "meeting-source-wiring:AZ", recordClass: "CURATED_READER_RECORD", contract: {} };
    assert.equal(routineDueRequestFor(derive, undefined, Date.parse(at(5)), [request!]), request);
    const other = { id: "census-geography-overlaps", recordClass: "CURATED_READER_RECORD", contract: {} };
    assert.equal(routineDueRequestFor(other, undefined, Date.parse(at(5)), [{ ...request!, contractId: other.id }]), null);
  });
});
