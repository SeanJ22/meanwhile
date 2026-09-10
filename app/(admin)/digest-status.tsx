import type { OwnerDigestRecord } from "@/lib/control-plane/owner-surface.ts";
import { ownerDigestAttention } from "@/lib/control-plane/owner-surface.ts";
import { plainText } from "@/lib/control-plane/plain-words.ts";

import { Band, When } from "./console-ui.tsx";
import { NeedsYouLine } from "./status-ui.tsx";

/** Latest canonical runner outcome, classified on the face before technical detail. */
export function LatestDigestStatus({ digest }: { readonly digest: OwnerDigestRecord }) {
  const attention = ownerDigestAttention(digest);
  const routine = digest.runtimeOutcome?.kind === "ROUTINE_CIVIC_DATA_SUPERVISOR"
    ? digest.runtimeOutcome
    : null;
  const intake = digest.runtimeOutcome?.kind === "INTAKE_RUNTIME_OBSERVATION"
    ? digest.runtimeOutcome
    : null;
  return (
    <section aria-label="Latest canonical runner outcome">
      <p className="plain">
        <Band level={attention.level}>{attention.headline}</Band> — {attention.happened} Recorded <When iso={digest.writtenAt} />.
      </p>
      <NeedsYouLine needs={{ needed: attention.needsYou, action: attention.action ?? undefined }} />
      <details className="status-detail">
        <summary>Technical details — the report the runner wrote</summary>
        <pre className="digest">{digest.lines.map((line) => plainText(line)).join("\n")}</pre>
      </details>
      {routine !== null && (
        <details className="status-detail">
          <summary>{routine.taskReceipts.length} exact routine task/candidate receipt reference{routine.taskReceipts.length === 1 ? "" : "s"}</summary>
          <pre className="digest">{JSON.stringify({
            cycleId: routine.cycleId,
            state: routine.state,
            taskReceiptEvidence: routine.taskReceiptEvidence,
            attemptedTasks: routine.attemptedTasks,
            verifiedSourceSuccesses: routine.verifiedSourceSuccesses,
            verifiedSourceFailures: routine.verifiedSourceFailures,
            taskReceipts: routine.taskReceipts,
            readerReadbackEvidence: routine.readerReadbackEvidence,
            readerReadbackDenominator: routine.readerReadbackDenominator,
            readerReadbacksRecordedPass: routine.readerReadbacksRecordedPass,
            readerReadbacksRecordedFail: routine.readerReadbacksRecordedFail,
            readerReadbacksCurrentFail: routine.readerReadbacksCurrentFail,
            readerReadbackNoops: routine.readerReadbackNoops,
            readerReadbackRepairFailures: routine.readerReadbackRepairFailures,
            readerReadbacks: routine.readerReadbacks,
            supervisorFailures: routine.failures,
          }, null, 2)}</pre>
        </details>
      )}
      {intake !== null && (
        <details className="status-detail">
          <summary>Exact append-only intake-runtime observation</summary>
          <pre className="digest">{JSON.stringify(intake, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}
