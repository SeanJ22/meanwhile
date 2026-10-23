import assert from "node:assert/strict";
import test from "./helpers/playbooks.ts";
import { localDate } from "../lib/ask/meeting-time.ts";
import { canonicalBodyIdentity } from "../lib/ask/body-identity.ts";
import type { AskAnswerPayload } from "../lib/ask/answer.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
import { recordedMeetingsSnapshot } from "./helpers/reader-fixtures.ts";
import { publishRecordedEdge } from "./helpers/reader-edge-meetings.ts";

await installRegistryAuthority();
delete process.env.DATABASE_URL;
const installed = recordedMeetingsSnapshot();
const held = installed.meetings;
await publishRecordedEdge(held, installed.agendaDocuments);

test("an explicit held local date retrieves that sitting rather than the next or latest one", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { POST } = await import("../app/api/ask/grounded/route.ts");
  const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");
  const bodyId = "ocd-division/country:us/state:az/school_district:tucson_unified_district#board";
  const rows = held.filter((meeting) => meeting.bodyId === bodyId).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  assert.ok(rows.length > 2);
  const selected = rows[1];
  const date = localDate(selected);
  resetGroundedState();
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test" },
    body: JSON.stringify({ question: `What was on this body's agenda on ${date}?`, surface: "MAP", ocdIds: ["ocd-division/country:us/state:az", selected.ocdId], activeSubjects: [{ id: bodyId, name: canonicalBodyIdentity(bodyId)!.name, kind: "BODY", focused: true }] }),
  }));
  const payload = await response.json() as AskAnswerPayload;
  assert.equal(response.status, 200);
  assert.equal(payload.subject?.id, bodyId);
  assert.ok(payload.records.some((record) => record.kind === "MEETING" && record.id === selected.id), JSON.stringify({ expected: selected.id, returned: payload.records.filter((record) => record.kind === "MEETING").map((record) => record.id) }));
  const expectedIds = rows.filter((row) => localDate(row) === date).map((row) => row.id).sort();
  assert.deepEqual(payload.records.filter((record) => record.kind === "MEETING").map((record) => record.id).sort(), expectedIds);
  assert.equal(payload.answer, null);
});
