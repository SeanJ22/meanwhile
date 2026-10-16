import { feedDoorId, upsertDerivedDoor, type DoorRepository } from "../doors/registry.ts";
import { recordDoorEvidence } from "../doors/shut.ts";
import { FEDERAL_MONEY_CONFIG } from "./sources.ts";
import type { FederalMoneySource } from "./model.ts";

export async function recordFederalMoneyDoorRead(input: { readonly doors: DoorRepository; readonly source: FederalMoneySource;
  readonly state: string; readonly at: string; readonly rows: number; readonly reason: string | null }) {
  const config = FEDERAL_MONEY_CONFIG[input.source], doorId = feedDoorId(`${input.source}:${input.state}`);
  await upsertDerivedDoor(input.doors, { doorId, kind: "source-feed", hosts: [new URL(config.route).hostname],
    holds: ["federal-money"], config: { contractId: input.source, sourceId: input.source, state: input.state,
      ...(config.keyEnv ? { keyRef: config.keyEnv } : {}) },
    checkEveryMinutes: config.everyMs / 60_000, notes: `${config.publisher}: ${input.state} federal source records.` }, input.at, input.at);
  await recordDoorEvidence(input.doors, doorId, input.reason === null ? { kind: "GOOD", rows: input.rows } : { kind: "TRANSPORT_FAILURE" }, input.at);
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await input.doors.mustRead(doorId);
    if (await input.doors.compareAndSet(doorId, row.revision, { ...row.value, lastFailureReason: input.reason }, input.at)) return;
  }
  throw new Error("The federal source door's read reason could not be saved.");
}
