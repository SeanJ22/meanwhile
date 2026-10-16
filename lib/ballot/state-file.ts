import { readJsonFile } from "../ops/json-file.ts";
import type { GenericBallotProjection } from "./generic-projection.ts";
import type { ManualSourceSetReceipt } from "../civic-data/types.ts";

interface BallotStateFile {
  readonly ballots: GenericBallotProjection["ballots"];
  readonly sourceReceipt: ManualSourceSetReceipt;
}

type BallotFileRow = (path: readonly string[], row: unknown) => void;

export async function readBallotStateFile(file: string, onRow?: BallotFileRow): Promise<BallotStateFile> {
  const value = await readJsonFile(file, {
    streamArray: path => path[0] === "ballots" && (path.length === 3 || path.length === 4 &&
      ["generalLineup", "measureAnalyses", "lineupReconciliation"].includes(path[2])),
    onRow,
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyntaxError("Invalid ballot state JSON.");
  return value as BallotStateFile;
}
