import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stampMeetingDoor } from "../lib/civic-data/fact-door.ts";
import { withPageDoor } from "../lib/civic-data/worker-page-doors.ts";
import { doorIdOfPage, pageAddress, pageDoorId } from "../lib/doors/page-doors.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";

const row = (id: string, doorId?: string) => ({ id, bodyId: "b", provenance: { sourceUrl: null, sourceOrg: "o", collectedAt: "t", verifiedAt: null, ...(doorId ? { doorId } : {}) } });
const snap = (...meetings: ReturnType<typeof row>[]) => ({ meetings } as unknown as MeetingsSnapshot);

describe("DB-28: every live fact knows its door", () => {
  it("stamps a hand-wired partition's rows with its id and keeps a door a row already names", () => {
    const out = stampMeetingDoor({ id: "meetings:legistar:b", derivedFamily: null }, snap(row("1"), row("2", "other")));
    assert.deepEqual(out.meetings.map((m) => m.provenance.doorId), ["meetings:legistar:b", "other"]);
  });
  it("leaves a derived family's rows alone", () => {
    const value = snap(row("1"));
    assert.equal(stampMeetingDoor({ id: "meetings:family", derivedFamily: {} }, value), value);
  });
  it("names a published page's door with the id its door record gets", () => {
    const url = "https://example.gov/clerk/roster/?utm_source=x";
    assert.equal(doorIdOfPage("ROSTER", url), pageDoorId("ROSTER", pageAddress(url)!));
    const page = { evidence: { canonicalUrl: url } } as never;
    assert.equal(withPageDoor({ status: "PUBLISHED" }, page, "ROSTER").doorId, doorIdOfPage("ROSTER", url));
    assert.deepEqual(withPageDoor({ status: "HELD" }, page, "ROSTER"), { status: "HELD" });
    assert.equal(doorIdOfPage("ROSTER", "not a url"), null);
  });
});
