import { BallotContestMerge } from "../../lib/civic-data/worker-ballot-contests.ts";
import type { ManualProjectionPackage, ManualProjectionPrior } from "../../lib/civic-data/manual-projections.ts";
import type { GenericBallotProjection } from "../../lib/ballot/generic-projection.ts";

export function mergeBallotFixture(input: ManualProjectionPackage, prior: ManualProjectionPrior | null): ManualProjectionPackage {
  const merge = new BallotContestMerge(input, prior);
  for (const [key, ballot] of Object.entries((input.payload as GenericBallotProjection).ballots)) {
    for (const row of ballot.contests) merge.add(key, "contests", row);
    for (const row of ballot.heldContests ?? []) merge.add(key, "heldContests", row);
    for (const [field, value] of Object.entries(ballot)) {
      if (field === "contests" || field === "heldContests") continue;
      if (Array.isArray(value)) for (const row of value) merge.add(key, field, row);
      else if (["generalLineup", "measureAnalyses", "lineupReconciliation"].includes(field) && value) {
        for (const [name, rows] of Object.entries(value)) if (Array.isArray(rows)) for (const row of rows) merge.add(key, `${field}.${name}`, row);
      }
    }
  }
  return merge.finish();
}
