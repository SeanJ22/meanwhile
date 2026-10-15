import { sha256OfJson, type MeetingPublication } from "../../lib/meetings/edge-artifacts.ts";
import type { MeetingsSnapshot } from "../../lib/meetings/snapshot.ts";

export function meetingPublication(
  snapshot: MeetingsSnapshot,
  bodies?: readonly { readonly id: string; readonly ocdId: string | null; readonly alsoServesOcdIds?: readonly string[] }[],
): MeetingPublication {
  return {
    generatedAt: snapshot.generatedAt,
    sources: snapshot.sources,
    meetingCount: snapshot.meetings.length,
    chunks: (async function* () { yield { key: "", version: sha256OfJson({ snapshot, bodies }), read: async () => ({ snapshot, bodies }) }; })(),
  };
}
