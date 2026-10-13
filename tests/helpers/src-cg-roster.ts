import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { RoutineDataStore } from "../../lib/civic-data/store.ts";
import { processRegisteredManualCandidate } from "../../lib/civic-data/promotion.ts";
import { normalizeCongressDirectory } from "../../lib/officials/congress-normalize.ts";
import { federalDirectoryCandidate } from "../../lib/officials/federal-directory-data-plane.ts";
import { readLdaRosterVersion } from "../../lib/sources/congress/lda-roster.ts";
import type { FederalCapture } from "../../lib/sources/congress/types.ts";

export const SRC_CG_NOW = "2026-10-13T04:20:00.000Z";
export const SRC_CG_ROSTER_SHA = "d5af3d2d2490f8c6532c9490b1f47a76cacca699";
export async function seedSrcCgRoster(store: RoutineDataStore) {
  const body = readFileSync(new URL("../fixtures/src-cg/federal-roster.yaml", import.meta.url), "utf8");
  const url = `https://raw.githubusercontent.com/unitedstates/congress-legislators/${SRC_CG_ROSTER_SHA}/legislators-current.yaml`;
  const projection = normalizeCongressDirectory({ "legislators-current": parse(body) }, SRC_CG_ROSTER_SHA, SRC_CG_NOW);
  const candidate = federalDirectoryCandidate({ acquisitions: [{ requestedUrl: url, finalUrl: url, httpStatus: 200, body }], retrievedAt: SRC_CG_NOW, projection });
  const outcome = await processRegisteredManualCandidate(store, "congress-bulk-roster", candidate, SRC_CG_NOW);
  assert.ok(outcome.promoted, outcome.candidate.failureDetail ?? "The real roster did not promote.");
  const roster = await readLdaRosterVersion(store, candidate.id);
  assert.ok(roster); assert.ok(roster.members.length > 500);
  return roster;
}
export function ldaHonoreeCaptures(): FederalCapture[] {
  const fixture = JSON.parse(readFileSync(new URL("../fixtures/src-cg/lda-honorees.json", import.meta.url), "utf8")) as {
    samples: { requestedUrl: string; retrievedAt: string; filing: unknown }[];
  };
  return fixture.samples.map(sample => ({ source: "senate-lda", kind: "contributions", url: sample.requestedUrl,
    body: JSON.stringify({ results: [sample.filing] }), retrievedAt: sample.retrievedAt }));
}
