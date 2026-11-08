import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { GET as meetingsGET } from "../app/api/meetings/route.ts";
import { GET as stateGET } from "../app/api/reader/state/route.ts";
import { installRegistryAuthority, installFederalDirectory, syntheticFederalDirectory } from "./helpers/promoted-fixtures.ts";
import { recordedMeetingsSnapshot } from "./helpers/reader-fixtures.ts";
import { publishRecordedEdge } from "./helpers/reader-edge-meetings.ts";
import { azDistricts } from "./helpers/ballot-district-fixtures.ts";

await installRegistryAuthority();
{
  const recorded = recordedMeetingsSnapshot();
  await publishRecordedEdge(recorded.meetings, recorded.agendaDocuments, recorded.generatedAt, {
    "census-districts": { value: azDistricts, versionId: azDistricts.versionId },
  });
  await installFederalDirectory(syntheticFederalDirectory());
}

/**
 * The answers the two reader routes gave for two fixture ZIPs before the composition moved out of their I/O
 * (a browser composes the same answer from prepared files). A digest per body: any byte that differs fails.
 */
const ANSWERS: Record<string, string> = {
  "meetings:85701": "7576c43221ea8d5055ec04fe03f774a9988e6988c9ead577e71771f6a5372a59",
  "state:85701": "d2571da9f1643c58d8046b20def7c34d4ba1f115e726fe10ed7d7b2787baa31c",
  "meetings:85641": "06bf3962d11db523e24c8c8f5737dc119ffe7858160a3b6c59ce5f7f637f73db",
  "state:85641": "a8db22e2f4f329d052060f4d077ae4b62a46c089d7a633a8d4e2166bce881dbe",
};

const digest = (text: string) => createHash("sha256").update(text).digest("hex");

test("/api/meetings and /api/reader/state answer the bytes they answered before composition moved", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-24T12:00:00Z") });
  const seen: Record<string, string> = {};
  for (const zip of ["85701", "85641"]) {
    for (const [name, route] of [["meetings", meetingsGET], ["state", stateGET]] as const) {
      const path = name === "meetings" ? "api/meetings" : "api/reader/state";
      const response = await route(new Request(`https://example.test/${path}?zip=${zip}`));
      assert.equal(response.status, 200, `${path}?zip=${zip}`);
      const body = new TextDecoder().decode(await response.arrayBuffer());
      assert.ok(body.length > 1000, `${path}?zip=${zip} answers with a real body`);
      seen[`${name}:${zip}`] = digest(body);
    }
  }
  assert.deepEqual(seen, ANSWERS);
});
