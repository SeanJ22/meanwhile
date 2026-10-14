import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { describe, it } from "node:test";
import { stampMeetingDoor } from "../lib/civic-data/fact-door.ts";
import { withPageDoor } from "../lib/civic-data/worker-page-doors.ts";
import { doorIdOfPage, pageAddress, pageDoorId, pageDoorDraft } from "../lib/doors/page-doors.ts";
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
  it("names a published page's door with the id its door record gets", async () => {
    const repos = createMemoryRepositories();
    const url = "https://example.gov/clerk/roster/?utm_source=x";
    assert.equal(doorIdOfPage("ROSTER", url), pageDoorId(pageAddress(url)!));
    const page = { evidence: { canonicalUrl: url, text: readFileSync("tests/fixtures/voting-sources/vt-arlington-clerk-original.html", "utf8") } } as never;
    assert.equal((await withPageDoor(repos, { status: "PUBLISHED" }, page, "ROSTER")).doorId, doorIdOfPage("ROSTER", url));
    assert.deepEqual(await withPageDoor(repos, { status: "HELD" }, page, "ROSTER"), { status: "HELD" });
    assert.equal(doorIdOfPage("ROSTER", "not a url"), null);
    const draft = pageDoorDraft({ url, recordClass: "ROSTER", retrievedAt: "2026-10-13T18:00:00Z", foundBy: "SCOUT" })!;
    const { upsertDerivedDoor } = await import("../lib/doors/registry.ts");
    await upsertDerivedDoor(repos.doors, { ...draft, doorId: "held-page-id" }, "2026-10-13T18:00:00Z", "2026-10-13T18:00:00Z");
    assert.equal((await withPageDoor(repos, { status: "PUBLISHED" }, page, "ROSTER")).doorId, "held-page-id");
    const notice = { evidence: { canonicalUrl: "https://www.benningtonvt.org/_T8_R868.php", artifactId: "held-notice",
      text: readFileSync("tests/fixtures/voting-sources/vt-bennington-nov3-original.html", "utf8") }, observedAt: "2026-10-13T18:00:00Z" } as never;
    const fact = await withPageDoor(repos, { status: "PUBLISHED" }, notice, "VOTING_SITE");
    assert.equal(fact.doorId, undefined);
    assert.equal(fact.sourceArtifactId, "held-notice");
  });
});
