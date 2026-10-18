import { publishReaderEdgePiece, publishReaderEdgePieces, readerEdgePieceResultLine, readerEdgePieces, type ReaderEdgePiece } from "../../lib/civic-data/reader-edge-publication.ts";
import { prepareStateArtifactChild, stateArtifactResultLine } from "../../lib/civic-data/state-artifact-dispatch.ts";
import type { BoundedChildLauncher } from "../../lib/civic-data/bounded-child-pass.ts";
import type { RoutineDataStore } from "../../lib/civic-data/store.ts";
import { ROUTINE_RECORD_CLASSES, type PromotedPointerIdentity } from "../../lib/civic-data/types.ts";
import { isStateAuthorityFamily } from "../../lib/meetings/edge-artifacts.ts";
import type { ReaderArtifactStore } from "../../lib/meetings/edge-store.ts";
import type { WorkerProcessSlots } from "../../lib/control-plane/workers/worker-slots.ts";

export const PIECE_ENV = { WTP_READER_EDGE_LOCAL_OK: "1", WTP_RUNTIME_AUTHORITY_REPO: process.cwd(), WTP_RUNTIME_AUTHORITY_SHA: "f".repeat(40) };
const FREE_SLOTS: WorkerProcessSlots = { acquire: async () => () => {} };

/** Every child a publication starts, run in this process: a piece through publishReaderEdgePiece, a state family's artifact through its own child entry. */
export function inProcessChildren(store: RoutineDataStore, artifactStore: ReaderArtifactStore): BoundedChildLauncher {
  return async command => {
    const arg = (name: string) => command.args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
    const done = (stdout: string) => ({ id: command.id, status: 0, signal: null, termination: "EXITED" as const, stderr: "", errorMessage: null, stdout });
    if (command.args.some(value => value.endsWith("publish-reader-edge-piece.mts")))
      return done(readerEdgePieceResultLine(await publishReaderEdgePiece(store, arg("observed-at")!, { family: arg("family")!, place: arg("place") }, artifactStore)));
    const state = arg("state")!, family = arg("family")!;
    if (!isStateAuthorityFamily(family)) throw new Error("TEST_STATE_ARTIFACT_INPUT_INVALID");
    return done(stateArtifactResultLine(state, family, await prepareStateArtifactChild(store, artifactStore, state, family, arg("version")!, arg("observed-at")!)));
  };
}

/** Pieces published in order as publish-now publishes them (by default every piece these pointers move), every child in this process. */
export async function publishPieces(store: RoutineDataStore, artifactStore: ReaderArtifactStore | null,
  selected: readonly Pick<PromotedPointerIdentity, "recordClass" | "scope">[],
  options: { readonly now?: string; readonly pieces?: readonly ReaderEdgePiece[]; readonly env?: Readonly<Record<string, string | undefined>> } = {}) {
  return (await publishReaderEdgePieces({ store, artifactStore, pieces: options.pieces ?? readerEdgePieces(selected), deadlineMs: Number.MAX_SAFE_INTEGER,
    env: options.env ?? PIECE_ENV, clock: options.now === undefined ? undefined : () => options.now!,
    children: { slots: FREE_SLOTS, launch: artifactStore ? inProcessChildren(store, artifactStore) : undefined } })).outcome;
}

/** Every promoted pointer, as the edge's first read from an empty cursor takes them. */
export const everyPromotion = async (store: RoutineDataStore) => [...await store.listPromotionScopes!(ROUTINE_RECORD_CLASSES)];
