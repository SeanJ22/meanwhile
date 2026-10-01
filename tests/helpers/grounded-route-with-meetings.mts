/**
 * Child-process harness: run the REAL grounded Ask route over an exact meetings
 * snapshot, and print each response.
 *
 *   node --experimental-test-module-mocks --experimental-strip-types \
 *     --import ./scripts/register-test-loader.mjs \
 *     tests/helpers/grounded-route-with-meetings.mts <cases.json>
 *
 * `<cases.json>` is `{ snapshot, requests: [{ question, today, ocdIds? }] }`.
 *
 * The committed first-seed fixture cannot hold every production shape, and
 * the route reads meetings through exactly one import,
 * `readMeetingsProjection`. This process replaces that one export with the
 * supplied snapshot (validated by the real `validateSnapshot`) using node:test
 * module mocking, and changes nothing else: the registry, binder, sitting
 * selector, publication reading, evidence pack and payload are all real.
 * No model is called and nothing is written.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mock } from "node:test";
import { pathToFileURL } from "node:url";

import type { MeetingsSnapshot } from "../../lib/meetings/snapshot.ts";

const casesPath = process.argv[2];
if (!casesPath) throw new Error("usage: grounded-route-with-meetings.mts <cases.json>");
for (const key of ["ANTHROPIC_API_KEY", "DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL"]) delete process.env[key];

const root = process.cwd();
const moduleUrl = (path: string) => pathToFileURL(join(root, path)).href;
const cases = JSON.parse(readFileSync(casesPath, "utf8")) as {
  snapshot: MeetingsSnapshot;
  requests: { question: string; today: string; ocdIds?: string[] }[];
};

const snapshotModule: typeof import("../../lib/meetings/snapshot.ts") = await import(moduleUrl("lib/meetings/snapshot.ts"));
snapshotModule.validateSnapshot(cases.snapshot);
mock.module(moduleUrl("lib/meetings/snapshot.ts"), {
  namedExports: {
    ...snapshotModule,
    readMeetingsProjection: async () => ({
      kind: "BOOTSTRAP" as const,
      value: cases.snapshot,
      metadata: {
        recordClass: snapshotModule.MEETINGS_RECORD_CLASS,
        scope: snapshotModule.MEETINGS_SCOPE,
        sourceId: snapshotModule.MEETINGS_SOURCE_ID,
        version: cases.snapshot.generatedAt,
        versionId: `bootstrap:${snapshotModule.MEETINGS_RECORD_CLASS}:${snapshotModule.MEETINGS_SCOPE}:${cases.snapshot.generatedAt}`,
        lastKnownGoodVersionId: null,
        sourceThrough: null,
        retrievedAt: cases.snapshot.generatedAt,
        promotedAt: null,
        stale: "UNKNOWN" as const,
        staleAt: null,
      },
      detail: "Exact test snapshot supplied to the grounded route harness.",
    }),
  },
});

const { installRegistryRuntimeFirstSeeds } = await import(moduleUrl("tests/helpers/registry-runtime-first-seed.ts")) as typeof import("./registry-runtime-first-seed.ts");
await installRegistryRuntimeFirstSeeds();
const { POST } = await import(moduleUrl("app/api/ask/grounded/route.ts")) as typeof import("../../app/api/ask/grounded/route.ts");
const { resetGroundedState } = await import(moduleUrl("lib/ask/grounded-state.ts")) as typeof import("../../lib/ask/grounded-state.ts");

const results = [];
for (const request of cases.requests) {
  resetGroundedState();
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://wtp.test",
      host: "wtp.test",
      "x-wtp-synthetic-run": "grounded-route-with-meetings",
    },
    body: JSON.stringify({ question: request.question, today: request.today, ocdIds: request.ocdIds ?? [] }),
  }));
  results.push({ status: response.status, payload: await response.json() as unknown });
}
process.stdout.write(`\nGROUNDED_ROUTE_RESULTS=${JSON.stringify(results)}\n`);
