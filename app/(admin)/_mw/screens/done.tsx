import "server-only";

/**
 * **WHAT COUNTS AS DONE — the standard every reading is measured against.**
 * (Admin redesign, 2026-09-23; Readiness · What counts as done. Versioned,
 * MW-063, 2026-09-25.)
 *
 * The standard is versioned data (`lib/control-plane/readiness/standard.json`):
 * each version has an id — the derivation contract a published snapshot
 * stamps — an adoption date, and the gates and capabilities it asks. This
 * screen lists the versions, shows the one in force, and reports each state's
 * result against the version it was measured under. A slot the design shows
 * that has no record yet (proposals) says so.
 */
import { familyRows, gridCounts } from "@/lib/control-plane/admin-view/readiness-view.ts";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";
import { auditRenderedNumbers, checkStatedEqualsRendered, type CountClaim, type RenderedNumber } from "@/lib/control-plane/owner-surface.ts";
import { GATE_DEFINITION, GATE_LABEL, GATE_ORDER } from "@/lib/control-plane/readiness/gates.ts";
import { READINESS_DERIVATION_CONTRACT } from "@/lib/control-plane/readiness/model.ts";
import { readReadinessGrid, type ReadinessGrid } from "@/lib/control-plane/readiness/read.ts";
import { standardHistory, standardVersion } from "@/lib/control-plane/readiness/standard.ts";
import { CHECKLIST_PROFILE } from "@/lib/control-plane/readiness/checklist-score.ts";
import { checklistConnections } from "@/lib/control-plane/readiness/checklist-connections.ts";
import { readChecklistCensuses } from "@/lib/control-plane/readiness/checklist-read.ts";
import { readRoutinePublicationStatus } from "@/lib/civic-data/observability-server.ts";

import { AuditFooter, EmptyScope, NotAsked } from "../blocks.tsx";
import { ChecklistFieldEvidence } from "../checklist-field-evidence.tsx";
import { loadWatchedBodies } from "../data/load-bodies.ts";
import { lateWords, sharedRead } from "../data/shared-read.ts";
import { TRACKED_STATE_CODES, stateName } from "../load-shell.ts";
import { openPage, param, type SearchParams } from "../page-base.ts";
import { scopeParam, withScope } from "../scope.ts";
import { MwShell } from "../shell.tsx";
import { Dash, Pill, Refusal, Section, mw as s } from "../ui.tsx";

const checklistCensusRead = sharedRead<Awaited<ReturnType<typeof readChecklistCensuses>>>({
  freshMs: 60_000, staleMs: 30 * 60_000, deadlineMs: 1_500,
  keep: result => result.kind === "HELD",
  late: ms => ({ kind: "UNREAD", detail: lateWords("The exact checklist census", ms) }),
});

function durationWords(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "not measured";
  if (ms < 60_000) return "under 1 minute";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

function timingDate(value: string | null): string {
  return value && Number.isFinite(Date.parse(value)) ? formatEastern(value, { year: true }) : "not recorded";
}

export async function DoneScreen(props: { readonly searchParams: Promise<SearchParams> }) {
  const sp = await props.searchParams;
  const base = await openPage("/readiness/done", sp);
  const shellProps = {
    area: "readiness" as const,
    tab: "done" as const,
    scope: base.scope,
    scopeLabel: base.shell.label,
    scopeGroups: base.shell.groups,
    here: base.here,
    observedAt: base.nowIso,
    standard: base.standard,
  };
  // A saved instruction can have a checklist census before its state has an
  // older readiness grid. The missing grid must not hide that exact census.
  if (!base.shell.tracked && base.shell.decision === null) {
    const name = base.scope.kind === "all" ? "Everywhere" : stateName(base.scope.state);
    return (
      <MwShell {...shellProps}>
        <EmptyScope name={name} scope={base.scope} standing={base.shell.standing} />
      </MwShell>
    );
  }
  if (base.repos === null) {
    return (
      <MwShell {...shellProps}>
        <NotAsked detail={base.controlPlaneGap} />
      </MwShell>
    );
  }

  const states = base.scope.kind === "all" ? TRACKED_STATE_CODES : [base.scope.state];
  const publicationPromise = readRoutinePublicationStatus();
  const censusPromise = checklistCensusRead.read(() => readChecklistCensuses(base.repos));
  const [bodiesRead, ...reads] = await Promise.all([loadWatchedBodies(base.nowIso), ...states.map(async (code) => ({ code, read: await readReadinessGrid(code) }))]);
  const [publication, censusRead] = await Promise.all([publicationPromise, censusPromise]);
  const selectedInstruction = base.scope.kind === "geo" ? base.shell.decision : null;
  const scopedCensus = selectedInstruction && censusRead.kind === "HELD"
    ? censusRead.rows.find(row => row.scopeId === selectedInstruction.key && row.instructionReceipt === selectedInstruction.receiptId) ?? null : null;
  const connections = checklistConnections({ publication, assessment: scopedCensus });
  const censusGap = base.scope.kind !== "geo"
    ? "Choose one saved geography instruction to see its exact checklist census. The definitions and family paths below remain global."
    : selectedInstruction === null
      ? "This geography is not a saved instruction, so no exact checklist census is attributed to it."
      : censusRead.kind === "UNREAD" ? censusRead.detail
        : scopedCensus === null ? "The installed runner has not published a census for this exact instruction and receipt yet."
          : null;
  // Each state's grid, without the ZIP rows this screen never draws (see readReadinessGrid).
  const held: ReadinessGrid[] = reads.flatMap((r) => (r.read.kind === "HELD" ? [r.read.snapshot] : []));
  const unread = reads.filter((r) => r.read.kind !== "HELD").map((r) => stateName(r.code));
  /* Each state's result, against the version it was measured under — a superseded one is named, never re-graded under the new bar. */
  const measuredUnder = reads.map((r) => {
    const contract = r.read.kind === "HELD" ? r.read.snapshot.derivationContract : r.read.kind === "REQUIRES_REPUBLISH" ? r.read.snapshotContract : null;
    const version = standardVersion(contract);
    return {
      code: r.code,
      says:
        r.read.kind === "HELD"
          ? `measured under ${contract}${version ? `, adopted ${version.adoptedOn}` : ""}`
          : r.read.kind === "REQUIRES_REPUBLISH"
            ? `measured under ${contract ?? "no version marker"}${version?.supersededOn ? `, superseded ${version.supersededOn}` : ""} — not shown until it is measured again under ${READINESS_DERIVATION_CONTRACT}`
            : "no result read",
    };
  });
  const history = standardHistory();
  const query = (param(sp, "q") ?? "").trim().slice(0, 100);
  const allDefinitions = connections.definitions;
  const matchingDefinitions = query ? allDefinitions.filter(definition =>
    `${definition.id} ${definition.group} ${definition.requirement} ${definition.familyIds.join(" ")}`.toLowerCase().includes(query.toLowerCase())) : allDefinitions;
  const showAllDefinitions = param(sp, "all") === "1" || query.length > 0;
  const shownDefinitions = showAllDefinitions ? matchingDefinitions : matchingDefinitions.slice(0, 25);
  const assessment = connections.assessment;
  const matchingInstances = assessment?.results.filter(row => !query || `${row.obligationKey} ${row.definitionIds.join(" ")} ${row.disposition} ${row.reasons.join(" ")} ${row.nextAction}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const instancePage = Math.max(1, Number.isSafeInteger(Number(param(sp, "itemPage") ?? "1")) ? Number(param(sp, "itemPage") ?? "1") : 1);
  const timingRows = scopedCensus?.deliveryTimings ?? null;
  const unfinishedTimingRows = timingRows?.filter(row => row.waitingFor !== "NONE") ?? [];
  const timingPage = Math.max(1, Number.isSafeInteger(Number(param(sp, "timingPage") ?? "1")) ? Number(param(sp, "timingPage") ?? "1") : 1);
  const timingPageSize = 25;
  const shownTimingRows = timingRows?.slice((timingPage - 1) * timingPageSize, timingPage * timingPageSize) ?? [];
  const shownInstances = matchingInstances.slice((instancePage - 1) * 50, instancePage * 50);
  const inForceVersion = standardVersion(READINESS_DERIVATION_CONTRACT);

  const perState = held.map((snap) => ({ code: snap.state, capabilities: snap.capabilities.length, grid: gridCounts(snap.capabilities), publishedAt: snap.publishedAt }));
  const sizes = [...new Set(perState.map((p) => p.capabilities))];
  const families = familyRows(held);

  // Public delivery, from the routine readback: each body's current version read back through the reader's own projection.
  const inScope = bodiesRead.kind === "HELD" ? bodiesRead.views.filter((b) => b.stateCode !== null && states.includes(b.stateCode)) : [];
  const published = inScope.filter((b) => b.records !== null);
  const readBack = published.filter((b) => b.readerVisible !== null);

  const numbers: RenderedNumber[] = [];
  const claims: CountClaim[] = [
    { label: "requirement families", stated: families.length, rendered: families.length },
    { label: "versions of the standard", stated: history.length, rendered: history.length },
  ];
  for (const p of perState) {
    numbers.push({ label: `${p.code} checks satisfied`, value: p.grid.byState.CURRENT, denominator: p.grid.cells, contract: "capability gates CURRENT, of every capability gate in the state's published grid" });
  }
  if (bodiesRead.kind === "HELD" && published.length > 0) {
    numbers.push({ label: "bodies read back", value: readBack.length, denominator: published.length, contract: "watched bodies whose current version was read back through the reader's projection, of every watched body with a published version" });
  }
  const audit = auditRenderedNumbers(numbers);
  const stated = checkStatedEqualsRendered(claims);
  if (!audit.ok || !stated.ok) {
    return (
      <MwShell {...shellProps}>
        <Refusal title="This page refused to draw its own numbers.">
          {!audit.ok && <p>{audit.detail}</p>}
          {!stated.ok && <p>{stated.detail}</p>}
        </Refusal>
      </MwShell>
    );
  }

  const newest = perState.map((p) => p.publishedAt).sort().slice(-1)[0] ?? null;
  const inForce =
    held.length === 0
      ? null
      : sizes.length === 1
        ? `${(sizes[0] * GATE_ORDER.length).toLocaleString("en-US")}`
        : perState.map((p) => `${p.code.toUpperCase()} ${p.capabilities * GATE_ORDER.length}`).join(" · ");

  return (
    <MwShell {...shellProps}>
      <section className={`${s.card} ${s.gap32}`} aria-labelledby="done">
        <div className={s.row10}>
          <h2 id="done" className={s.h2Inline}>
            What the older grid measures
          </h2>
          <span className={s.monoSmall}>
            {READINESS_DERIVATION_CONTRACT}
            {newest ? ` · published ${formatEastern(newest)}` : ""}
          </span>
        </div>
        <p className={s.lede}>
          This grid measures earlier capability checks under its recorded version. Sean&apos;s full 325-definition checklist below is the current target.
          A current grid cell cannot certify a checklist item without the required source, verification, publication and public-view evidence.
        </p>
        <div className={s.grid3}>
          <div className={`${s.insetTile} ${s.stack8}`}>
            <span className={s.titleStrong14}>Older grid cells</span>
            {inForce === null ? <Dash large>NOT READ</Dash> : <span className={s.fig}>{inForce}</span>}
            <span className={s.note}>
              {held.length === 0
                ? "No state's published grid could be read."
                : sizes.length === 1
                  ? `Per state: ${sizes[0]} capabilities, each through ${GATE_ORDER.length} gates.`
                  : "Per state, capabilities times five gates."}
              {unread.length > 0 ? ` Not read: ${unread.join(", ")}.` : ""}
            </span>
          </div>
          <div className={`${s.insetTile} ${s.stack8}`}>
            <span className={s.titleStrong14}>Grid revision</span>
            {inForceVersion === null ? <Dash large>NOT IN THE LIST</Dash> : <span className={s.monoSmall}>adopted {inForceVersion.adoptedOn}</span>}
            <span className={s.note}>{inForceVersion === null ? `The version in force, ${READINESS_DERIVATION_CONTRACT}, is not on the versioned list.` : inForceVersion.summary}</span>
          </div>
          <div className={`${s.insetTile} ${s.stack8}`}>
            <span className={s.titleStrong14}>Grid proposals</span>
            <Dash large>NOT RECORDED</Dash>
            <span className={s.note}>Open questions about the standard — how to score it, what the priority labels mean, the freshness defaults — wait on you and are not recorded as proposals against it.</span>
          </div>
        </div>
      </section>

      <Section title="Sean's full checklist" lede={`${CHECKLIST_PROFILE.version} · ${allDefinitions.length} original definitions. This is the adopted target, not a claim that those items are delivered. The older state grid below measures a different capability standard.`} />
      <p className={s.goldNote}>{censusGap ? censusGap : connections.assessmentGap ? connections.assessmentGap : assessment ? "The exact scoped instruction census is shown below." : "No exact scoped instruction census was available for this read."} The related family and contract readings are global supporting paths, not a claim that every record belongs to this selected state or ZIP.</p>
      <div className={`${s.card} ${s.cardList} ${s.gap32}`}>
        <form action="/readiness/done" method="get" className={s.row10} role="search">
          {scopeParam(base.scope) && <input type="hidden" name="scope" value={scopeParam(base.scope)!} />}
          <label htmlFor="checklist-search" className={s.titleStrong14}>Find a checklist item</label>
          <input id="checklist-search" name="q" type="search" defaultValue={query} placeholder="ID, subject or required result" maxLength={100} className={s.input} />
          <button type="submit" className={s.btnLink}>Search all {allDefinitions.length}</button>
        </form>
        <p className={s.note}>{matchingDefinitions.length} of {allDefinitions.length} definitions match. {shownDefinitions.length} shown. A definition without a current witness remains unscored; the older grid cannot certify it.</p>
        <div className={s.stack10}>
          {shownDefinitions.map(definition => <div key={definition.id} className={s.insetRow} id={`checklist-${definition.id}`}>
            <span className={s.monoId}>{definition.id}</span>
            <span className={s.text14}>{definition.requirement}</span>
            <span className={s.note}>{definition.group} · {definition.dimension.replaceAll("_", " ")}{definition.familyIds.length ? <> · Related: {definition.familyIds.map((id, index) => <span key={id}>{index > 0 ? ", " : ""}<a href={`#checklist-family-${id}`} className={s.btnLink}>{id}</a></span>)}</> : " · no dataset family relationship declared"}</span>
          </div>)}
          {shownDefinitions.length === 0 && <p className={s.note}>No definition matches this search.</p>}
          {!showAllDefinitions && <a className={s.btnLink} href={withScope("/readiness/done", base.scope, { all: "1" })}>Show all {allDefinitions.length} definitions</a>}
        </div>
      </div>

      {assessment && <>
        <Section title="Checklist results with exact evidence" lede={`${assessment.profile} · observed ${formatEastern(assessment.observedAt, { year: true })} · ${assessment.provisional ? "assessment incomplete" : assessment.complete ? "all assessed requirements delivered" : "requirements still owed"}. These are object, jurisdiction and period obligations; one definition can create many instances.`} />
        {assessment.issues.length > 0 && <p className={s.goldNote}>{assessment.issues.join(" ")}</p>}
        <div className={`${s.card} ${s.cardList} ${s.gap20}`}>
          <div className={s.grid3}>{Object.entries(assessment.dimensions).map(([dimension, count]) => <div key={dimension} className={`${s.insetTile} ${s.stack6}`}>
            <span className={s.titleStrong14}>{dimension.replaceAll("_", " ")}</span>
            <span className={s.fig}>{count.percent === null ? "Not measured" : `${count.percent}%`}</span>
            <span className={s.note}>{count.label}</span>
          </div>)}</div>
          <p className={s.note}>Public delivery: {assessment.publicDelivery.label} ({assessment.publicDelivery.unit}). Freshness: {assessment.freshness.label}. Required gates: {assessment.gates.state.toLowerCase()}.</p>
          <p className={s.note}>{assessment.uninstantiated.length} original definitions have no established instance yet. They remain unresolved, not passed or exempt.</p>
          <p className={s.note}>{matchingInstances.length.toLocaleString("en-US")} instance{matchingInstances.length === 1 ? "" : "s"} match this search; showing {shownInstances.length} on page {instancePage}. Every passed item requires exact source, verification, publication and public-view witnesses.</p>
          <div className={s.stack8}>{shownInstances.map(row => <details key={row.obligationKey} className={s.insetRow}>
            <summary className={s.text14}>{row.definitionIds.join(", ")} · {row.disposition.replaceAll("_", " ").toLowerCase()} · {row.obligationKey}</summary>
            <p className={s.note}>Owner: {row.owner}. Next: {row.nextAction}</p>
            <p className={s.note}>Due: {row.due ? "yes" : "not established as due"}. Fresh: {row.fresh ? "yes" : "no or unmeasured"}. Accepted version: {row.accepted ? "yes" : "no"}. Publicly checked: {row.visible ? "yes" : "no"}.</p>
            {row.reasons.map(reason => <p key={reason} className={s.goldNote}>{reason}</p>)}
            {row.witnessId && <p className={s.monoSmall}>Evidence witness {row.witnessId}</p>}
          </details>)}</div>
          <div className={s.row10}>
            {instancePage > 1 && <a className={s.btnLink} href={withScope("/readiness/done", base.scope, { q: query || null, itemPage: String(instancePage - 1) })}>Previous 50</a>}
            {instancePage * 50 < matchingInstances.length && <a className={s.btnLink} href={withScope("/readiness/done", base.scope, { q: query || null, itemPage: String(instancePage + 1) })}>Next 50</a>}
          </div>
        </div>
      </>}

      {scopedCensus && <>
        <Section title="Time from work registration to public check" lede="These are process clocks for this exact saved instruction and receipt. They explain delays; they do not award checklist credit or prove when a source first published a fact." />
        <div className={`${s.card} ${s.cardList} ${s.gap20}`}>
          <p className={s.note}>{timingRows === null ? "The runner has not published per-work timing records for this census." : `${timingRows.length} tracked work item${timingRows.length === 1 ? "" : "s"}; ${unfinishedTimingRows.length} unfinished. Oldest unfinished work appears first. Showing ${shownTimingRows.length} on page ${timingPage} of ${Math.max(1, Math.ceil(timingRows.length / timingPageSize))}.`} Ready-to-start time and source publication time are not recorded.</p>
          {shownTimingRows.map(row => <details key={row.workItemId} className={s.insetRow}>
            <summary className={s.text14}>{row.subjectId} · {row.recordClass.replaceAll("_", " ").toLowerCase()} · {row.waitingFor === "NONE" ? "public readback observed" : `waiting for ${row.waitingFor.replaceAll("_", " ").toLowerCase()}`}{row.unfinishedAgeMs !== null ? ` · stage age ${durationWords(row.unfinishedAgeMs)}` : ""}</summary>
            <div className={s.stack8}>
              <p className={s.monoSmall}>Work {row.workItemId}</p>
              <p className={s.note}>Registered {timingDate(row.registeredAt)}; first attempt started {timingDate(row.firstStartedAt)}; first evidence saved {timingDate(row.firstSavedAt)}.</p>
              <p className={s.note}>Parsed {timingDate(row.parsedAt)}; verified {timingDate(row.verifiedAt)}; accepted {timingDate(row.acceptedAt)}; public readback observed {timingDate(row.visibleAt)}.</p>
              <p className={s.note}>Registration to first start: {durationWords(row.registeredToStartMs)}. This begins at work registration, not when the work became ready. Verification to observed public readback: {durationWords(row.verifiedToReadbackMs)}. That interval ends at the check and is not a claim about first visibility.</p>
              <p className={s.note}>Current stage began {timingDate(row.waitingSince)}; unfinished stage age {durationWords(row.unfinishedAgeMs)}; total unfinished work age {durationWords(row.workAgeMs)}. Ready time: unknown. Source publication time: unknown.{row.timingIssue ? " One or more timing values were invalid or out of order; affected intervals are not measured." : ""}</p>
            </div>
          </details>)}
          {timingRows?.length === 0 && <p className={s.note}>No process timing row is recorded for this exact instruction. That is not evidence that no work exists.</p>}
          <div className={s.row10}>
            {timingPage > 1 && <a className={s.btnLink} href={withScope("/readiness/done", base.scope, { q: query || null, timingPage: String(timingPage - 1) })}>Previous 25</a>}
            {timingRows && timingPage * timingPageSize < timingRows.length && <a className={s.btnLink} href={withScope("/readiness/done", base.scope, { q: query || null, timingPage: String(timingPage + 1) })}>Next 25</a>}
          </div>
        </div>
      </>}

      {selectedInstruction && <ChecklistFieldEvidence rows={scopedCensus?.fieldEvidence ?? null}
        query={query} requestedPage={Number(param(sp, "fieldPage") ?? "1")}
        pageHref={page => `${withScope("/readiness/done", base.scope, { q: query || null, fieldPage: String(page) })}#official-field-evidence`}
        predicateHref={id => `${withScope("/readiness/done", base.scope, { q: id })}#checklist-${encodeURIComponent(id)}`}
        workHref={id => `${withScope("/admin/work", base.scope, { instruction: selectedInstruction.key, open: id })}#a-${encodeURIComponent(id)}`} />}

      <Section title="Where each family connects" lede={`${connections.families.length} declared data families and ${connections.manualContracts.length} production contracts. These links explain where evidence could reach a reader; they do not score a checklist item.`} />
      {connections.readFailure && <p className={s.goldNote}>Publication receipts could not be read: {connections.readFailure}</p>}
      {connections.asOf && <p className={s.note}>Publication status checked {formatEastern(connections.asOf, { year: true })}. The check reads current pointers, latest attempts and exact-version reader receipts; it does not re-read every saved document.</p>}
      <div className={s.stack10}>{connections.families.map(family => <details key={family.id} className={`${s.card} ${s.cardList}`} id={`checklist-family-${family.id}`}>
        <summary className={s.titleStrong14}>{family.id} · {family.classification === null ? "lifecycle not classified" : (typeof family.classification === "string" ? family.classification : family.classification.join(", ")).replaceAll("_", " ")} · {family.observation.replaceAll("_", " ").toLowerCase()}</summary>
        <p className={s.note}>{family.relationship}</p>
        <p className={s.note}>Reader surfaces: {family.surfaces.length ? family.surfaces.join(", ") : "no reader surface declared for this family"}. Related checklist groups: {family.groups.length ? family.groups.join(", ") : "no checklist group relationship declared"}.</p>
        {family.contracts.length === 0 ? <p className={s.goldNote}>No matching runtime publication contract was read for this family. This does not prove no records exist.</p> : <div className={s.stack8}>{family.contracts.map(contract => <div key={contract.contractId} className={s.insetRow}>
          <span className={s.monoId}>{contract.contractId}</span>
          <span className={`${s.text14} ${s.grow}`}>{contract.says} {contract.latestAttempt?.failureCode ? `Latest attempt ${formatEastern(contract.latestAttempt.attemptedAt)} failed: ${contract.latestAttempt.failureCode}.` : ""}</span>
          <span className={s.note}>{contract.readback ? `Reader check ${contract.readback.status} ${formatEastern(contract.readback.at)}` : "No exact-version reader check"}</span>
        </div>)}</div>}
      </details>)}</div>

      <Section
        title="Older grid versions"
        lede="Every grid version, newest first. These versions do not replace the full checklist above; a state result retains the grid version it was measured under."
      />
      <div className={`${s.card} ${s.cardList} ${s.gap32}`}>
        <div className={s.stack10}>
          {history.map((v) => (
            <div key={v.id} className={s.insetRow}>
              <span className={s.monoId}>{v.id}</span>
              <span className={s.note}>
                adopted {v.adoptedOn}
                {v.supersededOn ? `, superseded ${v.supersededOn}` : ", in force"}. {v.summary}
                {v.gates === null ? ` ${v.notRecorded ?? "Its gates and capabilities are not recorded in the list."}` : ` ${v.gates.length} gates, ${v.capabilities?.length ?? 0} capabilities.`}
              </span>
              <span className={s.pushRight}>
                <Pill tone={v.supersededOn ? "slate" : "teal"}>{v.supersededOn ? "SUPERSEDED" : "IN FORCE"}</Pill>
              </span>
            </div>
          ))}
          {measuredUnder.map((m) => (
            <p key={m.code} className={s.note}>
              {stateName(m.code)}: {m.says}.
            </p>
          ))}
        </div>
      </div>

      <Section
        title="Requirement families"
        lede={`${base.scope.kind === "all" ? "Across the registered states" : stateName(states[0])}, from each state's published grid. A family is worst-of its checks, never an average. The grid grades each capability by its own evidence walks, and it does not yet credit the routine meeting reads, so Meetings and agendas can read not started while Public delivery shows meetings read back.`}
      />
      <div className={`${s.card} ${s.cardList} ${s.gap32}`}>
        <div className={s.stack10}>
          {families.map((f) => (
            <div key={f.code} className={s.insetRow}>
              <span className={s.monoId}>{f.code}</span>
              <span className={s.titleStrong14}>{f.name}</span>
              <span className={s.note}>{f.counts}</span>
              <span className={s.pushRight}>
                <Pill tone={f.tone}>{f.pill}</Pill>
              </span>
            </div>
          ))}
          <div className={s.insetRow}>
            <span className={s.monoId}>PUB</span>
            <span className={s.titleStrong14}>Public delivery</span>
            <span className={s.note}>
              {bodiesRead.kind === "HELD"
                ? published.length === 0
                  ? "no watched body has a published version in this scope"
                  : `meetings: ${readBack.length} of ${published.length} watched bodies read back through the reader's projection; every other family is declared, not read back`
                : "not read"}
            </span>
            <span className={s.pushRight}>
              {bodiesRead.kind === "HELD" && published.length > 0 ? <Pill tone="cyan">MEETINGS ONLY</Pill> : <Dash>UNKNOWN</Dash>}
            </span>
          </div>
        </div>
      </div>

      <Section title="The five gates" lede="Every capability is measured through the same five gates, in order. A gate cannot be current while an earlier one is not." />
      <div className={`${s.card} ${s.cardList} ${s.gap32}`}>
        <div className={s.stack12}>
          {GATE_ORDER.map((g, i) => (
            <div key={g} style={{ display: "grid", gridTemplateColumns: "24px 150px minmax(0, 1fr)", gap: 10, alignItems: "baseline" }}>
              <span className={s.monoId}>{i + 1}</span>
              <span className={s.titleStrong14}>{GATE_LABEL[g]}</span>
              <span className={s.text14}>{GATE_DEFINITION[g]}</span>
            </div>
          ))}
        </div>
      </div>
      <AuditFooter numbers={numbers} claims={claims} readAt={formatEastern(base.nowIso, { year: true })} />
    </MwShell>
  );
}
