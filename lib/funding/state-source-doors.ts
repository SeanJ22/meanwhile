import { feedDoorId, upsertDerivedDoor, type DoorRepository } from "../doors/registry.ts";
import { recordDoorEvidence, type DoorEvidence } from "../doors/shut.ts";
import { campaignFinanceSourceId } from "./state-sources.ts";

export async function recordCampaignFinanceDoor(input: { readonly doors: DoorRepository; readonly state: string; readonly resource: string;
  readonly url: string; readonly at: string; readonly evidence: DoorEvidence; readonly reason: string | null }) {
  const sourceId = campaignFinanceSourceId(input.state), doorId = feedDoorId(`${sourceId}:${input.resource}`);
  await upsertDerivedDoor(input.doors, { doorId, kind: "source-feed", hosts: [new URL(input.url).hostname], holds: ["campaign-finance"],
    config: { contractId: sourceId, sourceId, state: input.state, resource: input.resource }, checkEveryMinutes: 1440,
    notes: `${input.state} official state or local campaign-finance publication.` }, input.at, input.at);
  await recordDoorEvidence(input.doors, doorId, input.evidence, input.at);
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await input.doors.mustRead(doorId);
    if (await input.doors.compareAndSet(doorId, row.revision, { ...row.value, lastFailureReason: input.reason }, input.at)) return;
  }
  throw new Error("The campaign-finance door result changed while it was being retained.");
}
