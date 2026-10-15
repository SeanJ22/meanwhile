import type { BallotSet } from "../ballot/types.ts";
import { validateBallotMeasureEvidence } from "../ballot/measure-evidence.ts";
import { netlifyEvidenceStoreFromEnv } from "../control-plane/evidence/netlify-store.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { RoutineCandidate } from "./types.ts";

type BallotPayload = { kind: "ballot-contests" | "ballot-measures"; ballots: Record<string, BallotSet> };

export async function ballotEvidencePublicationCheck(candidate: RoutineCandidate, prior: RoutineCandidate | null,
  injectedVault?: EvidenceStore): Promise<RoutineCandidate["dependentChecks"][number] | null> {
  const payload = candidate.readModel as BallotPayload | null;
  if (candidate.recordClass !== "BALLOT_CANDIDACY" || !payload || !["ballot-contests", "ballot-measures"].includes(payload.kind)) return null;
  const consumer = "ballot source evidence";
  try {
    if (!payload.ballots || typeof payload.ballots !== "object" || Array.isArray(payload.ballots)) throw new Error("Ballot source records are missing.");
    if (!Object.values(payload.ballots).some(ballot => ballot.sourceCorpus || ballot.sourceAuthorities?.length ||
      ballot.measures?.some(measure => measure.officialText || measure.voterGuide))) return null;
    const vault = injectedVault ?? netlifyEvidenceStoreFromEnv();
    if (!vault) throw new Error("The configured Netlify evidence vault is required to verify ballot sources.");
    const before = prior?.readModel as BallotPayload | undefined;
    for (const [key, ballot] of Object.entries(payload.ballots)) {
      await validateBallotMeasureEvidence(ballot, vault, before?.kind === payload.kind ? before.ballots[key] : undefined);
    }
    return { consumer, passed: true, detail: "Official source bytes and excerpts match their immutable vault references." };
  } catch (error) {
    return { consumer, passed: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
