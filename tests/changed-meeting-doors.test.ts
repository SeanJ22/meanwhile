import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { changedMeetingDoors } from "../lib/doors/changed-meeting-doors.ts";
import { applyDerivedRow, checkDoorDraft } from "../lib/doors/registry.ts";
import { meetingDoorsCandidate } from "../lib/doors/meeting-doors.ts";

test("retained meeting doors pick up edits and removals across processes while leaving unrelated page bodies on the server", async () => {
  const pg = new PGlite();
  const root = mkdtempSync(join(tmpdir(), "meeting-door-changes-"));
  const connection = "postgresql://readonly@example.test/fixture";
  let bytes = 0;
  const query = async (sql: string, params: readonly unknown[]) => {
    const rows = (await pg.query<Record<string, unknown>>(sql, [...params])).rows;
    bytes += Buffer.byteLength(JSON.stringify(rows));
    return rows;
  };
  await pg.exec("CREATE TABLE cp_doors(id text PRIMARY KEY,revision int,value jsonb,updated_at timestamptz,changed_at timestamptz DEFAULT now())");
  const draft = checkDoorDraft({ doorId: "meeting:one", kind: "legistar", ocdId: "ocd-division/country:us/state:il/place:example",
    bodyIds: ["example#governing"], hosts: ["webapi.legistar.com"], config: { slug: "example" }, holds: ["meetings"],
    meeting: { agendaSourceType: "LEGISTAR", jurisdiction: "Example", publishingOrg: "Example", timeZone: "America/Chicago", verifiedAt: "2026-10-20T00:00:00Z", family: null }, status: "OPEN" });
  assert.ok(draft.ok);
  const at = "2026-10-20T00:00:00Z";
  const door = applyDerivedRow(null, draft.value, at, at);
  assert.ok(door);
  await pg.query("INSERT INTO cp_doors VALUES ($1,1,$2::jsonb,now(),now())", [door.doorId, JSON.stringify(door)]);
  await pg.query("INSERT INTO cp_doors VALUES ('unrelated',1,$1::jsonb,now(),now())", [JSON.stringify({ kind: "page", meeting: null, text: "x".repeat(1_000_000) })]);
  try {
    const cold = await changedMeetingDoors({ connection, root, query });
    const coldBytes = bytes;
    assert.equal(cold.length, 1);
    assert.ok(coldBytes < 10_000, `the unrelated page is never downloaded (${coldBytes} bytes)`);
    bytes = 0;
    const warm = await changedMeetingDoors({ connection, root, query });
    assert.deepEqual(meetingDoorsCandidate(warm, at).readModel, meetingDoorsCandidate(cold, at).readModel);
    assert.ok(bytes < coldBytes / 2, `${bytes} warm bytes versus ${coldBytes} cold bytes`);
    await pg.query("UPDATE cp_doors SET revision=2,value=jsonb_set(value,'{status}','\"SHUT\"'),changed_at=now(),updated_at=now() WHERE id=$1", [door.doorId]);
    assert.equal((await changedMeetingDoors({ connection, root, query }))[0].value.status, "SHUT");
    await pg.query("UPDATE cp_doors SET revision=3,value=jsonb_set(value,'{meeting}','null'),changed_at=now(),updated_at=now() WHERE id=$1", [door.doorId]);
    assert.equal((await changedMeetingDoors({ connection, root, query })).length, 0);
    await assert.rejects(changedMeetingDoors({ connection, root, query: async () => { throw new Error("database offline"); } }), /database offline/);
  } finally { await pg.close(); }
});
