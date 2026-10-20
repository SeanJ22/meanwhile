import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { RoutineDataStore } from "../../lib/civic-data/store.ts";
import type { EvidenceStore } from "../../lib/control-plane/evidence/store.ts";
import { processRegisteredManualCandidate } from "../../lib/civic-data/promotion.ts";
import { normalizeCongressDirectory } from "../../lib/officials/congress-normalize.ts";
import { FEDERAL_DIRECTORY_STATES, federalDirectoryCandidate, federalDirectoryContractId, federalDirectoryForState } from "../../lib/officials/federal-directory-data-plane.ts";
import { federalCaptureHonorees, readHeldCongressRoster } from "../../lib/sources/congress/lda-roster.ts";
import type { FederalCapture } from "../../lib/sources/congress/types.ts";

export const SRC_CG_NOW = "2026-10-13T04:20:00.000Z";
export const SRC_CG_ROSTER_SHA = "d5af3d2d2490f8c6532c9490b1f47a76cacca699";
export async function seedSrcCgRoster(store: RoutineDataStore, vault: EvidenceStore) {
  const body = readFileSync(new URL("../fixtures/src-cg/federal-roster.yaml", import.meta.url), "utf8");
  const url = `https://raw.githubusercontent.com/unitedstates/congress-legislators/${SRC_CG_ROSTER_SHA}/legislators-current.yaml`;
  const national = normalizeCongressDirectory({ "legislators-current": parse(body) }, SRC_CG_ROSTER_SHA, SRC_CG_NOW);
  for (const state of FEDERAL_DIRECTORY_STATES) {
    const candidate = await federalDirectoryCandidate({ state, acquisitions: [{ requestedUrl: url, finalUrl: url, httpStatus: 200, body }], vault, retrievedAt: SRC_CG_NOW,
      projection: federalDirectoryForState(national, state) });
    const outcome = await processRegisteredManualCandidate(store, federalDirectoryContractId(state), candidate, SRC_CG_NOW);
    assert.ok(outcome.promoted, outcome.candidate.failureDetail ?? `The real ${state} roster did not promote.`);
  }
  const roster = await readHeldCongressRoster(store, vault, SRC_CG_NOW, { honoreeNames: [...ldaHonoreeCaptures().flatMap(federalCaptureHonorees), "Sen. John Cornyn", 'Sen. Bernard "Bernie" Sanders'] });
  assert.ok(roster); assert.ok(roster.members.length > 0 && roster.members.length < national.roster.officeholders.length);
  return roster;
}
export function ldaHonoreeCaptures(): FederalCapture[] {
  const fixture = JSON.parse(readFileSync(new URL("../fixtures/src-cg/lda-honorees.json", import.meta.url), "utf8")) as {
    samples: { requestedUrl: string; retrievedAt: string; filing: unknown }[];
  };
  return fixture.samples.map(sample => ({ source: "senate-lda", kind: "contributions", url: sample.requestedUrl,
    body: JSON.stringify({ results: [sample.filing] }), retrievedAt: sample.retrievedAt }));
}
