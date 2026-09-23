import "server-only";

/**
 * **WHAT COUNTS AS DONE — the standard every reading is measured against.**
 * (Admin redesign, 2026-09-23; Readiness · What counts as done.)
 *
 * The design shows a versioned checklist with its adoption history. Today the
 * standard is the readiness instrument's own definition — capabilities, each
 * through five gates, under the derivation contract every published snapshot
 * carries — and it is code, not versioned data (MW-063). So this screen shows
 * the standard that is actually in force, measured from the published
 * snapshots, and says plainly which of the design's slots have no record yet.
 */
import { familyRows, gridCounts } from "@/lib/control-plane/admin-view/readiness-view.ts";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";
import { auditRenderedNumbers, checkStatedEqualsRendered, type CountClaim, type RenderedNumber } from "@/lib/control-plane/owner-surface.ts";
import { GATE_DEFINITION, GATE_LABEL, GATE_ORDER } from "@/lib/control-plane/readiness/gates.ts";
import { READINESS_DERIVATION_CONTRACT, type ReadinessStateSnapshot } from "@/lib/control-plane/readiness/model.ts";
import { readReadinessSnapshot } from "@/lib/control-plane/readiness/read.ts";

import { AuditFooter, EmptyScope, NotAsked } from "../blocks.tsx";
import { loadWatchedBodies } from "../data/load-bodies.ts";
import { REGISTERED_STATE_CODES, stateName } from "../load-shell.ts";
import { openPage, type SearchParams } from "../page-base.ts";
import { MwShell } from "../shell.tsx";
import { Dash, Pill, Refusal, Section, mw as s } from "../ui.tsx";

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
    standard: READINESS_DERIVATION_CONTRACT,
  };
  if (!base.shell.registered) {
    const name = base.scope.kind === "all" ? "Everywhere" : stateName(base.scope.state);
    return (
      <MwShell {...shellProps}>
        <EmptyScope name={name} scope={base.scope} />
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

  const states = base.scope.kind === "all" ? REGISTERED_STATE_CODES : [base.scope.state];
  const [bodiesRead, ...reads] = await Promise.all([loadWatchedBodies(base.nowIso), ...states.map(async (code) => ({ code, read: await readReadinessSnapshot(code) }))]);
  const held: ReadinessStateSnapshot[] = reads.flatMap((r) => (r.read.kind === "HELD" ? [r.read.snapshot] : []));
  const unread = reads.filter((r) => r.read.kind !== "HELD").map((r) => stateName(r.code));

  const perState = held.map((snap) => ({ code: snap.state, capabilities: snap.capabilities.length, grid: gridCounts(snap.capabilities), publishedAt: snap.publishedAt }));
  const sizes = [...new Set(perState.map((p) => p.capabilities))];
  const families = familyRows(held);

  // Public delivery, from the routine readback: each body's current version read back through the reader's own projection.
  const inScope = bodiesRead.kind === "HELD" ? bodiesRead.views.filter((b) => b.stateCode !== null && states.includes(b.stateCode)) : [];
  const published = inScope.filter((b) => b.records !== null);
  const readBack = published.filter((b) => b.readerVisible !== null);

  const numbers: RenderedNumber[] = [];
  const claims: CountClaim[] = [{ label: "requirement families", stated: families.length, rendered: families.length }];
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
            What counts as done
          </h2>
          <span className={s.monoSmall}>
            {READINESS_DERIVATION_CONTRACT}
            {newest ? ` · published ${formatEastern(newest)}` : ""}
          </span>
        </div>
        <p className={s.lede}>
          The standard is a version, not an opinion: results measured against one version stay true against it. Today the version is the readiness instrument&rsquo;s
          own definition — every capability, each through five gates — and it is code rather than a versioned list, so raising the bar is an engineering change and
          a deployment (MW-063).
        </p>
        <div className={s.grid3}>
          <div className={`${s.insetTile} ${s.stack8}`}>
            <span className={s.titleStrong14}>Requirements in force</span>
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
            <span className={s.titleStrong14}>Added in this version</span>
            <Dash large>NOT VERSIONED YET</Dash>
            <span className={s.note}>The standard lives in code, so what changed between versions is in the code history, not recorded against the standard. Progress cannot yet be reported against an old bar and a new one.</span>
          </div>
          <div className={`${s.insetTile} ${s.stack8}`}>
            <span className={s.titleStrong14}>Proposed, not adopted</span>
            <Dash large>NOT RECORDED</Dash>
            <span className={s.note}>Open questions about the standard — how to score it, what the priority labels mean, the freshness defaults — wait on you and are not recorded as proposals against it.</span>
          </div>
        </div>
      </section>

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
