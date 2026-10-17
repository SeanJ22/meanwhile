import { publishReaderEdgePiece, readerEdgePieceResultLine } from "../lib/civic-data/reader-edge-publication.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { resolveReaderArtifactWriteStore } from "../lib/meetings/edge-store.ts";
import { assertRuntimeAuthority } from "../lib/civic-data/runtime-authority.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";
import { assignment, requiredAssignment } from "./cli-args.mts";

try {
  const argv = process.argv.slice(2);
  assertRuntimeAuthority({ capabilities: ["ROUTINE_SUPERVISOR"], immediateParentPid: process.ppid });
  const artifacts = resolveReaderArtifactWriteStore();
  if (!artifacts || artifacts.kind === "local-file" && process.env.WTP_READER_EDGE_LOCAL_OK !== "1") throw new Error("READER_EDGE_STORE_UNAVAILABLE");
  const now = requiredAssignment(argv, "observed-at", "READER_EDGE_PIECE_TIME_REQUIRED");
  if (!Number.isFinite(Date.parse(now))) throw new Error("READER_EDGE_PIECE_TIME_INVALID");
  const piece = { family: requiredAssignment(argv, "family", "READER_EDGE_PIECE_FAMILY_REQUIRED"), place: assignment(argv, "place") };
  console.log(readerEdgePieceResultLine(await publishReaderEdgePiece(new PostgresRoutineDataStore(), now, piece, artifacts)));
} catch (error) {
  console.error(sanitizedErrorDiagnostic(error));
  process.exitCode = 1;
}
