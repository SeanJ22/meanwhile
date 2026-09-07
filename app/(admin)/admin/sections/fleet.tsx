/**
 * **THE FLEET, STREAMED — AND AUDITING ITS OWN NUMBERS.** (ADM-38, §9A.12.)
 *
 * Measured against the production build on 2026-09-06, reading the live
 * control plane:
 *
 * ```
 *   readSnapshot            515 ms    107 KB
 *   readHeartbeat           239 ms      1 KB
 *   readDigests             237 ms    243 KB
 *   readDecisions            93 ms      5 KB
 *   readCacheObservation     86 ms      0 KB
 *   readFleetSafety         631 ms   1.27 MB
 *   readFleetInputs       1,225 ms   6.62 MB   <- every Attempt, WorkItem and
 *                                                 RouteTask on record
 * ```
 *
 * The fleet read is five times the size of everything else put together, and
 * the console used to hold pilot health, the runner, the obligations and the
 * decision queue behind it. The owner has reported the wait three times.
 *
 * So the fleet is its own async component behind a Suspense boundary: the rest
 * of the page renders as soon as its own cheap reads land, and the fleet fills
 * in when it is ready. The fallback says what it is waiting for; §9A.12's line
 * is that a shell must not be an excuse to make the owner wait for content that
 * could have been there, and everything that could be there already is.
 *
 * ## Why this section audits its own numbers
 *
 * The console refuses to render if any number it emits lacks a denominator and
 * an interpretation contract. That check ran once, over the whole page, before
 * anything was drawn — which is only possible while every read blocks every
 * render. A streamed section therefore audits ITSELF and refuses ITSELF, which
 * is the same guarantee at a finer grain: a fleet number that cannot be trusted
 * blanks the fleet, not pilot health.
 */
import {
  openControlPlane,
  readFleetInputs,
} from "@/lib/control-plane/admin-data.ts";
import { buildFleetView, fleetRenderedNumbers, type FleetGroupView } from "@/lib/control-plane/fleet-view.ts";
import { auditRenderedNumbers, type RenderedNumber } from "@/lib/control-plane/owner-surface.ts";
import { count, plainCode } from "@/lib/control-plane/plain-words.ts";

import { DayBars } from "../../charts.tsx";
import { Name, Said, agoText } from "../../console-ui.tsx";
import { NeedsYouLine } from "../../status-ui.tsx";

/** One fleet group, in one name and one sentence (ADM-43's class). */
function FleetGroupCard({
  group,
  nowIso,
  candidateNames,
}: {
  readonly group: FleetGroupView;
  readonly nowIso: string;
  readonly candidateNames?: Readonly<Record<string, string>>;
}) {
  return (
    <section className="fleet-card card" aria-labelledby={`fleet-${group.key}`}>
      <h3 id={`fleet-${group.key}`}>
        {group.name}
        <span className="fleet-does">{group.what}</span>
      </h3>
      <NeedsYouLine needs={{ needed: false }} />
      <div className="fleet-nums">
        <span>
          <strong>{count(group.working.value)}</strong> working now
        </span>
        <span>
          <strong>{count(group.queued.value)}</strong> waiting of {count(group.queued.denominator)}
        </span>
        <span>
          <strong>{count(group.completed.value)}</strong> finished of {count(group.completed.denominator)}
        </span>
      </div>
      <p className="fleet-says">
        <Said text={group.doing} />
      </p>
      {group.deployedAt.length > 0 && (
        <p className="fleet-where">
          {group.deployedAt.map((w) => (
            <span key={w.label} className="where-wrap">
              <Name raw={w.label} candidateNames={candidateNames} pill short />
              <span className="where-count">{count(w.attempts)}</span>
            </span>
          ))}
        </p>
      )}
      <ul className="fleet-latest">
        {group.latest.map((a) => (
          <li key={`${a.at}:${a.subject}`}>
            {agoText(a.at, nowIso)} · {plainCode(a.role)} · <Name raw={a.subject} candidateNames={candidateNames} /> — {plainCode(a.outcome)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Attempts started per Eastern day over the trailing fortnight. */
function attemptsByDay(attempts: readonly { readonly startedAt: string }[], nowIso: string): { label: string; day: string; value: number }[] {
  const days: { label: string; day: string; value: number }[] = [];
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
  const now = Date.parse(nowIso);
  for (let i = 13; i >= 0; i -= 1) {
    const at = new Date(now - i * 86_400_000);
    days.push({ label: fmt.format(at), day: iso.format(at), value: 0 });
  }
  const index = new Map(days.map((d, i) => [d.day, i]));
  for (const a of attempts) {
    const key = iso.format(new Date(a.startedAt));
    const at = index.get(key);
    if (at !== undefined) days[at].value += 1;
  }
  return days;
}

/** The fallback, while the six and a half megabytes are on their way. */
export function FleetLoading() {
  return (
    <div className="fleet-loading">
      <p className="plain">Counting what the workers have done…</p>
      <p className="note">
        This is every attempt, work item and route task on record — the biggest read on the console. Everything else on this page is already current.
      </p>
    </div>
  );
}

export async function FleetSection({ candidateNames }: { readonly candidateNames?: Readonly<Record<string, string>> }) {
  const opened = await openControlPlane();
  if (!opened.ok) {
    return (
      <p className="refusal">
        <strong>The fleet could not be read.</strong> {opened.detail}
      </p>
    );
  }
  const fleetOut = await readFleetInputs(opened.repos);
  if (fleetOut.kind !== "HELD") {
    return (
      <p className="refusal">
        <strong>The fleet could not be read.</strong> {fleetOut.detail}
      </p>
    );
  }

  const nowIso = new Date().toISOString();
  const fleet = buildFleetView({ nowIso, ...fleetOut.value });
  const perDay = attemptsByDay(fleetOut.value.attempts, nowIso);

  /*
   * This section's own numbers, audited before it draws any of them. The page
   * cannot do it for a section it did not wait for, so the section does it —
   * and a fleet number without a denominator blanks the fleet rather than the
   * whole console.
   */
  const numbers: RenderedNumber[] = fleetRenderedNumbers(fleet).map((m) => ({
    label: "fleet",
    value: m.value,
    denominator: m.denominator,
    contract: m.contract,
  }));
  for (const d of perDay) {
    numbers.push({
      label: `attempts on ${d.day}`,
      value: d.value,
      denominator: fleet.totalAttempts,
      contract: "Attempts started on this Eastern day, of every Attempt on record",
    });
  }
  const audit = auditRenderedNumbers(numbers);
  if (!audit.ok) {
    return (
      <p className="refusal">
        <strong>The fleet refused to render its own numbers.</strong> {audit.detail}
      </p>
    );
  }
  if (fleet.groups.length !== 5) {
    return (
      <p className="refusal">
        <strong>The fleet refused to render.</strong> Five groups were expected and {fleet.groups.length} were built, so the headline and the cards
        beneath it would not agree.
      </p>
    );
  }

  return (
    <>
      <p className="plain">
        {fleet.workingNow === 0 ? "Nothing is working right now." : `${count(fleet.workingNow)} job${fleet.workingNow === 1 ? " is" : "s are"} open right now.`}{" "}
        {count(fleet.totalAttempts)} attempt{fleet.totalAttempts === 1 ? "" : "s"} on record across every role
        {fleet.unassignedAttempts > 0 ? `, ${count(fleet.unassignedAttempts)} under a role none of the five groups names` : ""}.
      </p>
      <DayBars
        days={perDay.map((d) => ({ label: d.label, value: d.value }))}
        caption={`Attempts started per day, last 14 days (${perDay.reduce((n, d) => n + d.value, 0)} of ${fleet.totalAttempts} on record)`}
      />
      <div className="fleet">
        {fleet.groups.map((g) => (
          <FleetGroupCard key={g.key} group={g} nowIso={nowIso} candidateNames={candidateNames} />
        ))}
      </div>
      <p className="note">
        {numbers.length} number{numbers.length === 1 ? "" : "s"} in this section checked; each carries a denominator and an interpretation contract.
      </p>
    </>
  );
}
