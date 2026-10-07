import assert from "node:assert/strict";
import test from "node:test";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
import { rosterGapForBody, rosterForBody } from "../lib/registry/body-rosters.ts";
import type { AskAnswerPayload } from "../lib/ask/answer.ts";

await installRegistryAuthority();

test("an incomplete sourced roster keeps four verified people and the same exact gap on body and linked-person Ask", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const bodyId = "ocd-division/country:us/state:nj/county:morris/place:pequannock_township#governing";
  const gap = rosterGapForBody(bodyId)!;
  const roster = rosterForBody(bodyId)!;
  assert.equal(roster.members.length, 4);
  const { POST } = await import("../app/api/ask/grounded/route.ts");
  const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");
  const subjects = [{ id: bodyId, kind: "BODY", name: roster.bodyName }, ...roster.members.map((member) => ({ id: member.id, kind: "PERSON", name: member.name })), { id: "ocd-division/country:us/state:az/county:pima#governing", kind: "BODY", name: "Pima County Board of Supervisors" }];
  for (const subject of subjects) {
    resetGroundedState();
    const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test" }, body: JSON.stringify({ question: subject.kind === "BODY" ? "Who sits on this body?" : "What office does this person hold?", surface: "MAP", ocdIds: [], activeSubjects: [{ ...subject, focused: true }] }) }));
    const payload = await response.json() as AskAnswerPayload;
    const records = payload.records.filter((record) => record.kind === "ROSTER_IDENTITY_GAP");
    if (subject.id.includes("pima#")) {
      assert.equal(records.length, 0);
      assert.ok(payload.gaps.every((row) => row.statement !== gap.statement));
      continue;
    }
    assert.equal(response.status, 200);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0].rosterGap, gap);
    assert.equal(records[0].sourceUrl, gap.sourceUrl);
    assert.ok(payload.gaps.some((row) => row.whose === "OURS" && row.statement === gap.statement));
    assert.equal(payload.denominators.rosterExpectedMembers, 5);
    assert.equal(payload.denominators.rosterVerifiedMembers, 4);
    assert.equal(payload.denominators.rosterUnresolvedIdentities, 1);
    if (subject.kind === "BODY") assert.deepEqual(new Set(payload.contacts.map((contact) => contact.id)), new Set(roster.members.map((member) => member.id)));
  }
});
