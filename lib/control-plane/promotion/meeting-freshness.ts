import { meetingPartitionForRow, type MeetingPartitionContract } from "../../civic-data/meeting-partitions.ts";
import { readMeetingFreshnessRows } from "../../civic-data/meeting-freshness-store.ts";
import { projectRoutineDataObservability, type CurrentReaderBuildIdentity, type RoutineObservabilityRows } from "../../civic-data/observability.ts";
import { factFreshnessFromPermanentMeetings, type PermanentMeetingsReceipt } from "./fact-freshness.ts";
import { PUBLIC_SITE_ORIGIN } from "../../ops/origins.ts";

export async function readDeployedReaderBuild(): Promise<CurrentReaderBuildIdentity> {
  const response = await fetch(`${PUBLIC_SITE_ORIGIN}/api/build`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error("MEETING_FRESHNESS_READER_BUILD_UNAVAILABLE");
  const body = await response.json();
  return { codeSha: typeof body.commit === "string" ? body.commit : null,
    branch: typeof body.branch === "string" ? body.branch : null,
    context: typeof body.context === "string" ? body.context : null };
}

/** One lazy cache per worker pass. No source fetch, writes or legacy clock. */
export function createPermanentMeetingFreshness(input: {
  connection: string | undefined;
  now?: () => string;
  readBuild?: () => Promise<CurrentReaderBuildIdentity>;
  readRows?: (connection: string, contract: MeetingPartitionContract) => Promise<RoutineObservabilityRows>;
  onUnavailable?: (detail: string) => void;
}) {
  const receipts = new Map<string, Promise<PermanentMeetingsReceipt>>();
  let build: Promise<CurrentReaderBuildIdentity> | undefined;
  return async (fact: Parameters<typeof factFreshnessFromPermanentMeetings>[1]) => {
    let partition: MeetingPartitionContract;
    try { partition = meetingPartitionForRow(fact.meetingSource ?? "", fact.subjectId); }
    catch { return factFreshnessFromPermanentMeetings({ kind: "UNAVAILABLE", detail: "immutable fact has no exact registered source/body partition" }, fact); }
    let pending = receipts.get(partition.id);
    if (!pending) {
      pending = (async (): Promise<PermanentMeetingsReceipt> => {
        try {
          if (!input.connection?.trim()) throw new Error("MEETING_FRESHNESS_NOT_CONNECTED");
          build ??= (input.readBuild ?? readDeployedReaderBuild)();
          const reader = await build;
          const rows = await (input.readRows ?? readMeetingFreshnessRows)(input.connection, partition);
          const view = projectRoutineDataObservability(rows, (input.now ?? (() => new Date().toISOString()))(), [partition], reader);
          return { kind: "HELD", value: view.contracts };
        } catch (error) {
          // Never serialize connection/query error messages, which may contain credentials.
          const code = error instanceof Error && /^MEETING_FRESHNESS_[A-Z_]+$/.test(error.message) ? error.message : "MEETING_FRESHNESS_READ_OR_PROOF_FAILED";
          const detail = `${partition.id}: ${code}; recover the bounded canonical proof read; publication remains held`;
          input.onUnavailable?.(detail);
          return { kind: "UNAVAILABLE", detail };
        }
      })();
      receipts.set(partition.id, pending);
    }
    return factFreshnessFromPermanentMeetings(await pending, fact);
  };
}
