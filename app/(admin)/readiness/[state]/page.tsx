/**
 * **THE STATE READINESS CONTROL PANEL.** (State Readiness, 2026-09-03.)
 *
 * Reachable only on `ADMIN_ORIGIN`, only with a valid session — both enforced
 * upstream in `middleware.ts`, which returns 404 for `/readiness/*` on the public
 * host (it is declared in ADMIN_PATH_PREFIXES) and redirects an unauthenticated
 * request to the login page before this component is invoked.
 *
 * It answers one question per state: what do we actually have, how do we know, and
 * what is stopping the rest. It renders a published `ReadinessStateSnapshot` and
 * nothing else — a pure read, derived never authored — and before it shows a
 * single number it audits its own numbers and its own stated Ns against the rows
 * that exist (R-D, R-K). A control centre that renders a wrong number confidently
 * is worse than one that renders nothing, because the operator acts on it.
 */
import {
  auditRenderedNumbers,
  checkStatedEqualsRendered,
  type CountClaim,
  type RenderedNumber,
} from "@/lib/control-plane/owner-surface.ts";
import { readinessCountClaims } from "@/lib/control-plane/readiness/model.ts";
import {
  readReadinessSnapshot,
  readinessStates,
  unwalkedStateSnapshot,
} from "@/lib/control-plane/readiness/read.ts";
import type { ReadinessStateSnapshot } from "@/lib/control-plane/readiness/model.ts";

import { ConsoleNav } from "../../console-nav.tsx";
import { ReadinessPanel } from "./readiness-panel.tsx";
import { READINESS_STYLES } from "./styles.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Collect every Measured the snapshot will render, for the R-D audit. */
function renderedNumbers(snapshot: ReadinessStateSnapshot): RenderedNumber[] {
  const numbers: RenderedNumber[] = [];
  const push = (label: string, m: { value: number; denominator: number; contract: string }) =>
    numbers.push({ label, value: m.value, denominator: m.denominator, contract: m.contract });

  for (const row of snapshot.capabilities) {
    if (row.coverage.held) push(`coverage ${row.capabilityId}`, row.coverage.value);
  }
  if (snapshot.summary.readerVisibleJurisdictions.held) {
    push("reader-visible jurisdictions", snapshot.summary.readerVisibleJurisdictions.value);
  }
  if (snapshot.summary.populationInCompleteZip.held) {
    push("population in a complete zip", snapshot.summary.populationInCompleteZip.value);
  }
  for (const z of snapshot.zips) push(`zip completeness ${z.zip}`, z.completeness);
  return numbers;
}

export default async function ReadinessStatePage({
  params,
}: {
  params: Promise<{ state: string }>;
}) {
  const { state } = await params;
  const outcome = await readReadinessSnapshot(state);
  const stateCode = state.trim().toLowerCase();
  const nav = <ConsoleNav view="readiness" currentState={stateCode} states={readinessStates()} />;

  if (outcome.kind === "UNAVAILABLE") {
    return (
      <main className="admin readiness">
        <style dangerouslySetInnerHTML={{ __html: READINESS_STYLES }} />
        {nav}
        <h1>State readiness</h1>
        <p className="refusal">
          <strong>We could not ask.</strong> {outcome.detail}
        </p>
        <p className="note">
          Nothing below is missing — nothing below has been checked. Those are different facts and
          this panel will not print one as the other.
        </p>
      </main>
    );
  }

  // CC-F6: a snapshot produced under a retired derivation contract is quarantined.
  // Its old cells are NEVER rendered and NEVER audited-as-trusted; this is neither
  // NOT_WALKED (we did look) nor missing (a record exists) — it is stale-by-contract.
  if (outcome.kind === "REQUIRES_REPUBLISH") {
    return (
      <main className="admin readiness">
        <style dangerouslySetInnerHTML={{ __html: READINESS_STYLES }} />
        {nav}
        <h1>State readiness</h1>
        <p className="refusal">
          <strong>READINESS SNAPSHOT REQUIRES REPUBLISH.</strong> {outcome.detail}
        </p>
        <p className="note">
          A record exists but was produced by a retired publisher, so its cells are not shown — a
          snapshot under a superseded derivation contract cannot be trusted as current. This is not
          &ldquo;not walked&rdquo; and not &ldquo;no snapshot&rdquo;; it clears on the next
          instrument-derived publish. Source: {outcome.source}.
        </p>
      </main>
    );
  }

  const snapshot: ReadinessStateSnapshot =
    outcome.kind === "HELD" ? outcome.snapshot : unwalkedStateSnapshot(state, new Date().toISOString());
  const notice = outcome.kind === "NOT_RECORDED" ? outcome.detail : null;

  // The panel's audit of itself, from the values about to be rendered (R-D, R-K).
  const numberAudit = auditRenderedNumbers(renderedNumbers(snapshot));
  const claims: CountClaim[] = [...readinessCountClaims(snapshot)];
  const countAudit = checkStatedEqualsRendered(claims);

  if (!numberAudit.ok || !countAudit.ok) {
    return (
      <main className="admin readiness">
        <style dangerouslySetInnerHTML={{ __html: READINESS_STYLES }} />
        {nav}
        <h1>State readiness — {snapshot.stateName}</h1>
        <p className="refusal">
          <strong>This panel refused to render its own numbers.</strong>
        </p>
        {!numberAudit.ok && <p className="note">{numberAudit.detail}</p>}
        {!countAudit.ok && <p className="note">{countAudit.detail}</p>}
        <p className="note">
          A number without a denominator, or a headline that disagrees with the rows beneath it, is
          worse than a blank page: you would act on it.
        </p>
      </main>
    );
  }

  return (
    <main className="admin readiness">
      <style dangerouslySetInnerHTML={{ __html: READINESS_STYLES }} />
      {nav}
      <ReadinessPanel
        snapshot={snapshot}
        notice={notice}
        published={outcome.kind === "HELD"}
        source={outcome.kind === "HELD" ? outcome.source : "not published — rendered NOT_WALKED at read time"}
      />
      <hr />
      <p className="note">
        {numberAudit.detail} {countAudit.detail}
      </p>
    </main>
  );
}
