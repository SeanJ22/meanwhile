/**
 * **THE THREE NUMBERS, WITH THEIR MEANINGS — AND THIRTY INCIDENTS AS FOUR
 * GROUPS.** (ADM-28, ADM-29, ADM-30; §9A.3.)
 *
 * The owner read `277 units carrying freshness debt of 2991 registered` and
 * asked, twice in one breath, *"What does that even mean? What does it even
 * mean?"* The spreadsheet's note is the diagnosis: **"obligation" is the
 * load-bearing word of the whole dashboard and it is never defined on the
 * page.** So each tile carries its definition and its `Needs you` line, and the
 * word is defined once, in `incident-groups.ts`, for every surface that uses it.
 *
 * The thirty incident lines are grouped by what they MEAN to him rather than by
 * error code, each group with a count, an age, and an action where there is one.
 */
import {
  FRESHNESS_DEBT_MEANS,
  INCIDENT_MEANS,
  OBLIGATION_MEANS,
  OTHER_STATE_MEANS,
  groupIncidents,
  incidentLine,
  type IncidentRow,
} from "@/lib/control-plane/incident-groups.ts";
import { ageWords, count } from "@/lib/control-plane/plain-words.ts";
import type { Held, Measured, OwnerSnapshot } from "@/lib/control-plane/owner-surface.ts";

import { Name, QueueButton } from "../../console-ui.tsx";
import { Bar, DefinedTile } from "../../status-ui.tsx";

export interface ObligationsSectionProps {
  readonly freshnessDebtRows: Held<Measured>;
  readonly incidents: readonly IncidentRow[];
  readonly obligationsByState: OwnerSnapshot["obligationsByState"];
  readonly obligationsByProvider: OwnerSnapshot["obligationsByProvider"];
  readonly candidateNames?: Readonly<Record<string, string>>;
}

export function ObligationsSection(props: ObligationsSectionProps) {
  const groups = groupIncidents(props.incidents);
  const needsYouGroup = groups.find((g) => g.key === "NEEDS_YOU") ?? null;
  const standing = props.obligationsByState.reduce((n, r) => n + r.count.value, 0);
  const debt = props.freshnessDebtRows;

  return (
    <>
      <div className="rq-summary">
        <DefinedTile
          figure={debt.held ? count(debt.value.value) : "—"}
          label={debt.held ? `overdue, of ${count(debt.value.denominator)} scheduled` : "freshness debt"}
          means={FRESHNESS_DEBT_MEANS}
          needsYou={{ needed: false }}
        >
          {debt.held && <Bar value={debt.value.value} of={debt.value.denominator} tone="warn" />}
          {!debt.held && (
            <>
              <span className="tile-gap">{debt.gap.says}</span>
              <QueueButton where="Runner · freshness debt" says={debt.gap.says} compact />
            </>
          )}
        </DefinedTile>
        <DefinedTile
          figure={count(props.incidents.length)}
          label="reasons work is held up"
          means={INCIDENT_MEANS}
          needsYou={
            needsYouGroup
              ? { needed: true, action: `${count(needsYouGroup.incidents.length)} of them have been stuck long enough to need you` }
              : { needed: false }
          }
        />
        <DefinedTile
          figure={count(standing)}
          label="records the system is keeping current"
          means={OBLIGATION_MEANS}
          needsYou={{ needed: false }}
        />
      </div>

      {props.obligationsByState.length > 0 && (
        <>
          <h3>Where that work is</h3>
          <p className="fleet-where">
            {props.obligationsByState.map((r) => (
              <span
                key={r.state}
                className="where-wrap"
                title={r.state === "other" ? OTHER_STATE_MEANS : r.count.contract}
              >
                {r.state === "other" ? <span className="where">No single state</span> : <Name raw={r.state} pill short />}
                <span className="where-count">
                  {count(r.count.value)} of {count(r.count.denominator)}
                </span>
              </span>
            ))}
          </p>
          {props.obligationsByState.some((r) => r.state === "other") && (
            <p className="note">
              <strong>No single state</strong> — {OTHER_STATE_MEANS}
            </p>
          )}
        </>
      )}

      {props.obligationsByProvider.length > 0 && (
        <>
          <h3>What kind of work it is</h3>
          <p className="fleet-where">
            {props.obligationsByProvider.map((r) => (
              <span key={r.provider} className="where-wrap" title={r.count.contract}>
                <span className="where">{r.provider.replace(/-/g, " ")}</span>
                <span className="where-count">
                  {count(r.count.value)} of {count(r.count.denominator)}
                </span>
              </span>
            ))}
          </p>
        </>
      )}

      {props.incidents.length > 0 && (
        <>
          <h3 id="incidents">Why some of it is held up</h3>
          <p className="note">{INCIDENT_MEANS}</p>
          {groups.map((group) => (
            <details key={group.key} className={`incident-group ig-${group.key.toLowerCase().replace(/_/g, "-")}`}>
              <summary>
                <strong>{group.title}</strong> <span className="ig-count">{count(group.incidents.length)}</span>
                <span className="ig-says">{group.says}</span>
              </summary>
              <p className="note">{group.means}</p>
              {group.action && (
                <p className="needs-you needs-yes">
                  <strong>Needs you:</strong> Yes — {group.action}.
                </p>
              )}
              <ul className="incident-list">
                {group.incidents.map((incident) => {
                  const line = incidentLine(incident);
                  return (
                    <li key={`${incident.cause}:${incident.target}`}>
                      <Name raw={incident.target} candidateNames={props.candidateNames} />
                      <span className="incident-says"> {line.says}</span>
                      {group.action && (
                        <QueueButton
                          where={`Source · ${incident.target}`}
                          says={`${line.cause}: ${incident.obligationsAffected} record(s) behind it, oldest ${incident.oldestHours === null ? "unknown" : ageWords(incident.oldestHours)}`}
                          compact
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </>
      )}
    </>
  );
}
