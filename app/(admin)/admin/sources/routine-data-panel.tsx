import type { ReactNode } from "react";

import {
  drilldownCountText,
  observationNeedsEvidence,
  observationText,
  type DrilldownCount,
  type ExactChangedRecord,
  type ExactHeldRecord,
  type ExactOutcomeEvent,
  type ExactRefusedRecord,
  type Observation,
  type PreparedSnapshotLagMember,
  type PreparedSnapshotObservation,
  type RoutineContractMember,
  type RoutineContractObservation,
  type RoutineHistoryWindow,
  type RoutineObservabilityRead,
} from "@/lib/civic-data/observability.ts";
import type { ReaderEdgeObservation } from "@/lib/meetings/edge-observability.ts";
import { Band, When } from "../../console-ui.tsx";
import { Code, NeedsYouLine, StatusBlock } from "../../status-ui.tsx";

function exactJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return "[record could not be rendered]";
  }
}

function Evidence<T>({
  value,
  children,
}: {
  readonly value: Observation<T>;
  readonly children: (held: T) => ReactNode;
}) {
  if (value.kind === "MEASURED") return <>{children(value.value)}</>;
  return (
    <span className="src-gap" title={value.detail}>
      {observationText(value)} <span className="src-note">{value.detail}</span>
    </span>
  );
}

function TimeEvidence({ value }: { readonly value: Observation<string> }) {
  return <Evidence value={value}>{(iso) => <When iso={iso} year />}</Evidence>;
}

function ContractMemberLine({ member }: { readonly member: RoutineContractMember }) {
  return (
    <>
      <a href={`#routine-source-${member.contractId}`}><strong>{member.contractId}</strong></a> — <code>{member.sourceId}</code> · <code>{member.recordClass}</code> ·{" "}
      <code>{member.scope}</code> · {member.operationalState} · canonical freshness {member.freshness}
    </>
  );
}

function CountDisclosure<T>({
  label,
  count,
  member,
}: {
  readonly label: string;
  readonly count: DrilldownCount<T>;
  readonly member: (value: T, index: number) => ReactNode;
}) {
  return (
    <details className="rq-tile defined-tile src-detail">
      <summary>
        <strong>{drilldownCountText(count)}</strong> {label}
      </summary>
      {count.kind !== "MEASURED" && <p className="src-gap">{count.detail}</p>}
      {count.members.length === 0 ? (
        <p className="note">
          {count.kind === "MEASURED"
            ? "The complete canonical query returned no members for this count. This is a measured zero."
            : "No exact members are available for this unmeasured count."}
        </p>
      ) : (
        <ol className="src-evidence">
          {count.members.map((value, index) => <li key={index}>{member(value, index)}</li>)}
        </ol>
      )}
    </details>
  );
}

function ChangedRecordLine({ item }: { readonly item: ExactChangedRecord }) {
  return (
    <details>
      <summary>
        <code>{item.key}</code> — {item.kind.toLowerCase()} by <code>{item.candidateId}</code>
      </summary>
      <pre>{exactJson({ before: item.before, after: item.after })}</pre>
    </details>
  );
}

function HeldRecordLine({ item }: { readonly item: ExactHeldRecord }) {
  return (
    <details>
      <summary>
        <code>{item.code}</code>{item.key !== null ? <> · <code>{item.key}</code></> : null} — {item.detail}
      </summary>
      <p>Proved by {item.provenBy === "CANDIDATE_CHANGE_SET" ? "the candidate change set" : "the validation receipt"}.</p>
      {item.record !== undefined && <pre>{exactJson(item.record)}</pre>}
    </details>
  );
}

function RefusedRecordLine({ item }: { readonly item: ExactRefusedRecord }) {
  return (
    <details>
      <summary>
        <code>{item.code}</code>{item.check ? <> · <code>{item.check}</code></> : null} — {item.detail}
      </summary>
      <p>
        Candidate <code>{item.candidateId}</code>; verdict {item.verdict ?? "terminal failure"}; proved by{" "}
        {item.provenBy === "VALIDATION_RECEIPT" ? "the validation receipt" : "the candidate terminal state"}.
      </p>
    </details>
  );
}

function EventLine({ event }: { readonly event: ExactOutcomeEvent }) {
  return (
    <details>
      <summary>
        <TimeEvidence value={{ kind: "MEASURED", value: event.at }} /> · {event.domain === "READER_READBACK" ? "Reader readback" : "source state"} · candidate <code>{event.candidateId}</code> ·{" "}
        <Evidence value={event.state}>{(state) => <Code raw={state} />}</Evidence>
      </summary>
      <p>{event.detail}</p>
      <p className="note">Event {event.id}, sequence {event.sequence}.</p>
    </details>
  );
}

function AttemptLine({ attempt }: { readonly attempt: RoutineHistoryWindow["attempts"][number] }) {
  return (
    <details>
      <summary>
        <code>{attempt.candidateId}</code> · <TimeEvidence value={attempt.attemptedAt} /> ·{" "}
        <Evidence value={attempt.state}>{(state) => <Code raw={state} />}</Evidence> ·{" "}
        {attempt.authorityOrigin === "TRUSTED_LKG_IMPORT"
          ? "trusted LKG import (not source-authenticated)"
          : <Evidence value={attempt.acquisitionSucceeded}>{(succeeded) => <>source acquisition {succeeded ? "succeeded" : "failed"}</>}</Evidence>}
      </summary>
      <p>Canonical outcome: <Evidence value={attempt.canonicalOutcome}>{(outcome) => <Code raw={outcome} />}</Evidence>.</p>
      <h5>Validation receipt</h5>
      <Evidence value={attempt.validation}>{(receipt) => <pre>{exactJson(receipt)}</pre>}</Evidence>
    </details>
  );
}

function CanonicalOutcomeLine({ outcome }: { readonly outcome: RoutineHistoryWindow["counts"]["changedOutcomes"]["members"][number] }) {
  return (
    <>
      <code>{outcome.candidateId}</code> · promoted <When iso={outcome.promotedAt} year /> ·{" "}
      <Code raw={outcome.outcome} /> · event <code>{outcome.eventId}</code>
    </>
  );
}

function History({ history }: { readonly history: RoutineHistoryWindow }) {
  return (
    <details className="status-detail">
      <summary>{history.id} outcome history</summary>
      <p className="note">
        Complete canonical window from <When iso={history.since} year /> through <When iso={history.through} year />.
      </p>
      <div className="src-summary" aria-label={`${history.id} canonical outcome counts`}>
        <CountDisclosure label="attempts" count={history.counts.attempts} member={(item) => <AttemptLine attempt={item} />} />
        <CountDisclosure label="source-authenticated successful acquisitions" count={history.counts.successfulAcquisitions} member={(item) => <AttemptLine attempt={item} />} />
        <CountDisclosure label="promotions" count={history.counts.promotions} member={(item) => <EventLine event={item} />} />
        <CountDisclosure label="changed outcomes" count={history.counts.changedOutcomes} member={(item) => <CanonicalOutcomeLine outcome={item} />} />
        <CountDisclosure label="validated no-change outcomes" count={history.counts.unchangedOutcomes} member={(item) => <CanonicalOutcomeLine outcome={item} />} />
        <CountDisclosure label="records added" count={history.counts.added} member={(item) => <ChangedRecordLine item={item} />} />
        <CountDisclosure label="records changed" count={history.counts.changed} member={(item) => <ChangedRecordLine item={item} />} />
        <CountDisclosure label="records removed" count={history.counts.removed} member={(item) => <ChangedRecordLine item={item} />} />
        <CountDisclosure label="records held" count={history.counts.held} member={(item) => <HeldRecordLine item={item} />} />
        <CountDisclosure label="refusals" count={history.counts.refused} member={(item) => <RefusedRecordLine item={item} />} />
      </div>
      <details className="src-detail">
        <summary>{history.events.length} exact source-state / Reader evidence event{history.events.length === 1 ? "" : "s"}</summary>
        {history.events.length === 0 ? <p className="note">The complete window contains no source-state or Reader evidence events.</p> : (
          <ol className="src-evidence">
            {history.events.map((event) => <li key={event.id}><EventLine event={event} /></li>)}
          </ol>
        )}
      </details>
    </details>
  );
}

function Changes({ row }: { readonly row: RoutineContractObservation }) {
  return (
    <details className="status-detail">
      <summary>Exact latest candidate changes, holds, and refusals</summary>
      <p className="note">These are candidate deltas. They changed production only when the canonical outcome above is CHANGED and the pointer proof names this candidate.</p>
      <h4>Added, changed, and removed</h4>
      <Evidence value={row.latestChanges}>{(changes) => (
        <>
          <p>Persisted outcome: <Code raw={changes.outcome} />.</p>
          <CountDisclosure label="records added" count={{ kind: "MEASURED", value: changes.added.length, members: changes.added }} member={(item) => <ChangedRecordLine item={item} />} />
          <CountDisclosure label="records changed" count={{ kind: "MEASURED", value: changes.changed.length, members: changes.changed }} member={(item) => <ChangedRecordLine item={item} />} />
          <CountDisclosure label="records removed" count={{ kind: "MEASURED", value: changes.removed.length, members: changes.removed }} member={(item) => <ChangedRecordLine item={item} />} />
        </>
      )}</Evidence>
      <h4>Held records</h4>
      <Evidence value={row.latestHeld}>{(items) => (
        <CountDisclosure label="held records" count={{ kind: "MEASURED", value: items.length, members: items }} member={(item) => <HeldRecordLine item={item} />} />
      )}</Evidence>
      <h4>Refused records or candidate checks</h4>
      <Evidence value={row.latestRefused}>{(items) => (
        <CountDisclosure label="refusals" count={{ kind: "MEASURED", value: items.length, members: items }} member={(item) => <RefusedRecordLine item={item} />} />
      )}</Evidence>
    </details>
  );
}

function Contract({ row }: { readonly row: RoutineContractObservation }) {
  const level = row.cadence.operationalState === "HEALTHY"
    ? "GREEN"
    : row.cadence.operationalState === "DUE" || row.cadence.operationalState === "RETRYING" || row.cadence.operationalState === "IN_PROGRESS"
      ? "AMBER"
      : row.cadence.operationalState === "HELD" || row.cadence.operationalState === "STALE"
        ? "RED"
        : "UNKNOWN";
  const needsAction = row.cadence.operationalState === "HELD" || row.cadence.operationalState === "STALE"
    ? "inspect this contract's source evidence and standing runner"
    : row.cadence.operationalState === "UNKNOWN" &&
        row.canonicalPromotion.kind === "MEASURED" &&
        observationNeedsEvidence(row.readerVisible)
      ? "inspect the typed Reader readback and repair; do not reclassify or rerun the source"
      : "inspect this contract's canonical evidence and standing runner";
  return (
    <article className="status-block" id={`routine-source-${row.contractId}`}>
      <h3>{row.contractId}</h3>
      <p className="plain">
        <code>{row.sourceId}</code> · <code>{row.recordClass}</code> · <code>{row.scope}</code> · <code>{row.classification}</code>
      </p>
      <p>
        <strong>Current state:</strong>{" "}
        <Evidence value={row.currentState}>{(state) => <Code raw={state} withMeaning />}</Evidence>{" "}
        <Band level={level}>{row.cadence.operationalState}</Band>
      </p>
      <p className="note">{row.cadence.operationalDetail}</p>
      <NeedsYouLine needs={{ needed: row.cadence.operationalState === "HELD" || row.cadence.operationalState === "STALE" || row.cadence.operationalState === "UNKNOWN", action: needsAction }} />
      <dl>
        <dt>Canonical freshness</dt><dd><Code raw={row.cadence.freshness} /> — {row.cadence.freshnessDetail}</dd>
        <dt>Last source acquisition attempt</dt><dd><TimeEvidence value={row.lastAttemptedAcquisition} /></dd>
        <dt>Last source-authenticated acquisition</dt><dd><TimeEvidence value={row.lastSuccessfulAcquisition} /></dd>
        <dt>Last validation</dt><dd><TimeEvidence value={row.lastValidation} /></dd>
        <dt>Last promotion</dt><dd><TimeEvidence value={row.lastPromotion} /></dd>
        <dt>Canonical source-through / as-of</dt><dd><Evidence value={row.sourceThrough}>{(value) => <code>{value}</code>}</Evidence></dd>
        <dt>Execution clock</dt><dd><Code raw={row.cadence.clock} /> — {row.cadence.description}{row.cadence.clock === "STANDING" ? ` (${row.cadence.activeEveryMs / 3_600_000} active hours)` : ""}; retry {row.cadence.retryDescription}.</dd>
        <dt>Next due</dt><dd><TimeEvidence value={row.cadence.nextDue} /></dd>
        <dt>Latest canonical outcome</dt><dd><Evidence value={row.latestCanonicalOutcome}>{(outcome) => <Code raw={outcome} withMeaning />}</Evidence></dd>
        <dt>LKG</dt><dd><Evidence value={row.lkg}>{(lkg) => <><code>{lkg.versionId}</code> — {lkg.state === "TRUSTED_LKG_IMPORT" ? "serving from an explicit frozen-LKG import" : lkg.state === "SERVING_AFTER_LATER_ATTEMPT" ? "serving after a later attempt" : "the current promotion"}. {lkg.detail}</>}</Evidence></dd>
      </dl>
      <details className="status-detail">
        <summary>Canonical version, receipt, and typed Reader proof</summary>
        <h4>Canonical promoted version / receipt</h4>
        <Evidence value={row.canonicalPromotion}>{(promotion) => (
          <>
            <p><code>{promotion.versionId}</code>, promoted <When iso={promotion.promotedAt} year />. Authority origin: <Code raw={promotion.authorityOrigin} />.</p>
            <pre>{exactJson(promotion.receipt)}</pre>
            <ul>{promotion.pointerProof.map((proof) => <li key={proof}><code>{proof}</code></li>)}</ul>
          </>
        )}</Evidence>
        <h4>Typed Reader read-model proof</h4>
        <Evidence value={row.readerVisible}>{(reader) => (
          <>
            <p><code>{reader.versionId}</code> read by <code>{reader.verifierId}</code> through <code>{reader.projectionId}</code> <When iso={reader.observedAt} year />.</p>
            <p>{reader.detail} This is durable typed read-model evidence; deployed HTTP/app delivery is certified separately.</p>
            <ul>{reader.proof.map((proof) => <li key={proof}><code>{proof}</code></li>)}</ul>
          </>
        )}</Evidence>
      </details>
      <Changes row={row} />
      <History history={row.histories["24h"]} />
      <History history={row.histories["7d"]} />
      <History history={row.histories["30d"]} />
    </article>
  );
}

function PreparedSnapshotLagLine({ item }: { readonly item: PreparedSnapshotLagMember }) {
  return (
    <>
      <strong>{item.contractId}</strong> · <code>{item.scope}</code> — promoted <code>{item.promotedVersionId}</code>; serving{" "}
      {item.servedVersionId ? <code>{item.servedVersionId}</code> : "not in the serving copy"}
    </>
  );
}

function PreparedSnapshot({ snapshot }: { readonly snapshot: PreparedSnapshotObservation }) {
  const lagCount = snapshot.lag.kind === "MEASURED" ? snapshot.lag.value : null;
  const level = !snapshot.present
    ? "UNKNOWN"
    : lagCount === 0
      ? "GREEN"
      : lagCount !== null && lagCount > 0
        ? "AMBER"
        : "UNKNOWN";
  const state = !snapshot.present ? "FIRST SEED" : lagCount === 0 ? "CURRENT" : lagCount !== null && lagCount > 0 ? "BEHIND" : "PRESENT";
  return (
    <article className="status-block" id="routine-prepared-meeting-snapshot">
      <h3>Prepared reader snapshot — meetings</h3>
      <p className="plain">
        The one composed serving copy the reader reads per request (<code>{snapshot.recordClass}</code> · <code>{snapshot.scope}</code>).
        The promoted meeting partitions remain the authoritative civic truth; this is the runner-published projection of them, and its
        lag below is promoted data that has not yet reached the reader.
      </p>
      <p>
        <strong>State:</strong> <Band level={level}>{state}</Band>
      </p>
      <p className="note">{snapshot.detail}</p>
      <dl>
        <dt>Serving sequence</dt><dd><Evidence value={snapshot.sequence}>{(value) => <code>{value}</code>}</Evidence></dd>
        <dt>Composed at</dt><dd><TimeEvidence value={snapshot.composedAt} /></dd>
        <dt>Data generated at</dt><dd><TimeEvidence value={snapshot.generatedAt} /></dd>
        <dt>Promoted through</dt><dd><TimeEvidence value={snapshot.promotedThrough} /></dd>
        <dt>Composed from partitions</dt><dd><Evidence value={snapshot.composedPartitions}>{(value) => <>{value}</>}</Evidence></dd>
        <dt>Currently promoted partitions</dt><dd><Evidence value={snapshot.promotedPartitions}>{(value) => <>{value}</>}</Evidence></dd>
      </dl>
      <CountDisclosure
        label="promoted partitions not yet in the serving copy (publication lag)"
        count={snapshot.lag}
        member={(item) => <PreparedSnapshotLagLine item={item} />}
      />
    </article>
  );
}

function EdgeServing({
  edge,
  preparedGeneratedAt,
}: {
  readonly edge: ReaderEdgeObservation;
  readonly preparedGeneratedAt: string | null;
}) {
  const behind =
    edge.kind === "PUBLISHED" && preparedGeneratedAt !== null &&
    Number.isFinite(Date.parse(preparedGeneratedAt)) && Number.isFinite(Date.parse(edge.generatedAt)) &&
    Date.parse(preparedGeneratedAt) > Date.parse(edge.generatedAt);
  const level =
    edge.kind === "PUBLISHED" ? (behind ? "AMBER" : "GREEN")
    : edge.kind === "ABSENT" || edge.kind === "NOT_CONFIGURED" ? "UNKNOWN"
    : "RED";
  const state =
    edge.kind === "PUBLISHED" ? (behind ? "BEHIND" : "CURRENT")
    : edge.kind === "ABSENT" ? "NOT PUBLISHED"
    : edge.kind === "NOT_CONFIGURED" ? "NOT CONFIGURED"
    : "UNREACHABLE";
  return (
    <article className="status-block" id="routine-reader-edge">
      <h3>Reader edge serving (CDN artifacts)</h3>
      <p className="plain">
        The geographic serving artifacts the reader reads from the CDN edge — no database wake, no per-visit composition.
        The promoted partitions stay authoritative; this is their published serving copy, updated without a rebuild.
      </p>
      <p><strong>State:</strong> <Band level={level}>{state}</Band></p>
      <p className="note">{edge.kind === "PUBLISHED"
        ? behind
          ? `The edge manifest (sequence ${edge.sequence}) is OLDER than the DB prepared snapshot — a publish is lagging; the last valid edge artifacts keep serving.`
          : `The edge manifest (sequence ${edge.sequence}) is current with the prepared snapshot.`
        : edge.detail}</p>
      {edge.kind === "PUBLISHED" && (
        <dl>
          <dt>Store</dt><dd><Code raw={edge.storeKind} /></dd>
          <dt>Manifest sequence</dt><dd><code>{edge.sequence}</code></dd>
          <dt>Generated at</dt><dd><When iso={edge.generatedAt} year /> {edge.ageMinutes !== null ? `(${edge.ageMinutes} min old)` : ""}</dd>
          <dt>Promoted through</dt><dd>{edge.promotedThrough ? <When iso={edge.promotedThrough} year /> : <span className="src-gap">not recorded</span>}</dd>
          <dt>Scopes / total meetings</dt><dd>{edge.scopes.length} scope(s) · {edge.totalMeetings} meetings</dd>
          <dt>Authority artifacts</dt><dd>{edge.authorityArtifacts.length > 0
            ? <ul className="src-evidence">{edge.authorityArtifacts.map((a) => <li key={a.family}><code>{a.family}</code> — <code>{a.version}</code></li>)}</ul>
            : <span className="src-gap">none published to the edge (reader uses the DB for them)</span>}</dd>
        </dl>
      )}
      {edge.kind === "PUBLISHED" && (
        <details className="status-detail">
          <summary>{edge.scopes.length} geographic scope artifact{edge.scopes.length === 1 ? "" : "s"}</summary>
          <ol className="src-evidence">
            {edge.scopes.map((s) => (
              <li key={s.scope}>
                <code>{s.scope}</code> — {s.meetingCount} meeting{s.meetingCount === 1 ? "" : "s"} · <When iso={s.generatedAt} year />
              </li>
            ))}
          </ol>
        </details>
      )}
      <NeedsYouLine needs={{
        needed: edge.kind === "STORE_UNREACHABLE" || behind,
        action: edge.kind === "STORE_UNREACHABLE"
          ? "restore the reader edge store connection"
          : "inspect the standing runner's edge publish; the CDN is serving older data than the DB holds",
      }} />
    </article>
  );
}

export function RoutineDataPanel({
  outcome,
  edge,
}: {
  readonly outcome: RoutineObservabilityRead;
  readonly edge?: ReaderEdgeObservation;
}) {
  if (outcome.kind === "NOT_CONNECTED") {
    return (
      <section aria-labelledby="routine-data-heading">
        <h2 id="routine-data-heading">Canonical routine-data operations</h2>
        <StatusBlock
          what={<><Code raw={outcome.kind} /> — Admin is not connected to the canonical routine civic-data store.</>}
          happened={outcome.detail}
          next="Connect this Admin runtime to the production civic-data store; then this same section will read its durable candidates, events, and promotions."
          needsYou={{ needed: true, action: "connect Admin to the production routine-data store" }}
        />
      </section>
    );
  }
  if (outcome.kind === "STORE_UNREACHABLE" && outcome.cause === "READ_TIMED_OUT") {
    return (
      <section aria-labelledby="routine-data-heading">
        <h2 id="routine-data-heading">Canonical routine-data operations</h2>
        <StatusBlock
          what={<><Code raw="READ_TIMED_OUT" /> — the full proof-based routine read is too large to finish inside a page request.</>}
          happened={outcome.detail}
          next="Bounding this read is Admin engineering work. Nothing is wrong with the store connection, and no source or store failure is inferred."
          needsYou={{ needed: false }}
        />
      </section>
    );
  }
  if (outcome.kind === "STORE_UNREACHABLE") {
    return (
      <section aria-labelledby="routine-data-heading">
        <h2 id="routine-data-heading">Canonical routine-data operations</h2>
        <StatusBlock
          what={<><Code raw={outcome.kind} /> — the canonical routine civic-data store could not be read.</>}
          happened={outcome.detail}
          next="Restore the store connection and reload. No missing or zero outcome is inferred from this failure."
          needsYou={{ needed: true, action: "restore the production routine-data store connection" }}
        />
      </section>
    );
  }
  if (outcome.kind === "PROJECTION_FAILED") {
    return (
      <section aria-labelledby="routine-data-heading">
        <h2 id="routine-data-heading">Canonical routine-data operations</h2>
        <StatusBlock
          what={<><Code raw={outcome.kind} /> — Admin could not construct the canonical evidence projection.</>}
          happened={outcome.detail}
          next="Repair the named Admin clock, read-adapter, or evidence-projection defect and reload. The data plane was not classified as failed, empty, or healthy."
          needsYou={{ needed: true, action: "repair the Admin routine-data evidence projection" }}
        />
      </section>
    );
  }
  const view = outcome.value;
  return (
    <section aria-labelledby="routine-data-heading">
      <h2 id="routine-data-heading">Canonical routine-data operations</h2>
      <p className="plain">
        This is the production outcome view: one registered contract per row, read directly from the canonical candidates,
        append-only events, and atomic promotion pointers. It makes no public-source calls and keeps no second ledger.
      </p>
      <p className="note">Read <When iso={view.asOf} year /> from <code>{view.source}</code>.</p>
      <div className="src-summary" aria-label="Canonical routine-data summary with exact drilldowns">
        <CountDisclosure label="registered contracts" count={view.summary.contracts} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="healthy contracts" count={view.summary.healthy} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="held contracts" count={view.summary.held} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="contracts in automatic retry/backoff" count={view.summary.retrying} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="contracts with an attempt in progress" count={view.summary.inProgress} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="operationally due contracts" count={view.summary.operationalDue} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="operationally stale contracts" count={view.summary.operationalStale} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="contracts whose operational state cannot be proven" count={view.summary.operationalUnknown} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="fresh contracts" count={view.summary.fresh} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="contracts with due canonical freshness" count={view.summary.due} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="contracts with stale canonical freshness" count={view.summary.stale} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="contracts with unknown canonical freshness" count={view.summary.unknown} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="manual contracts with no cadence freshness clock" count={view.summary.manual} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="contracts serving fallback or imported LKG" count={view.summary.lkgServing} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="contracts with current deployed-code typed Reader proof" count={view.summary.readerVisible} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="contracts whose Reader proof is not recorded" count={view.summary.readerNotRecorded} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="contracts whose Reader delivery cannot be proven" count={view.summary.readerUnknown} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="contracts with no Reader projection" count={view.summary.readerNotApplicable} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="latest attempts that changed canonical data" count={view.summary.latestChanged} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="latest validated no-change outcomes" count={view.summary.latestUnchanged} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="latest canonical outcomes not recorded" count={view.summary.latestOutcomeNotRecorded} member={(item) => <ContractMemberLine member={item} />} />
        <CountDisclosure label="latest canonical outcomes that cannot be proven" count={view.summary.latestOutcomeUnknown} member={(item) => <ContractMemberLine member={item} />} />
      </div>
      <PreparedSnapshot snapshot={view.preparedMeetingSnapshot} />
      {edge && (
        <EdgeServing
          edge={edge}
          preparedGeneratedAt={
            view.preparedMeetingSnapshot.generatedAt.kind === "MEASURED"
              ? view.preparedMeetingSnapshot.generatedAt.value
              : null
          }
        />
      )}
      {view.contracts.map((row) => <Contract key={row.contractId} row={row} />)}
    </section>
  );
}
