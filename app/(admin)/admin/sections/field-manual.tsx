/**
 * **THE FIELD MANUAL, IN PLAIN ENGLISH.** (Owner directive 2026-09-19.)
 *
 * The one number that says whether the fleet is getting smarter or starting
 * over — RULING 63's inherited-versus-newly-built — read straight off the live
 * plane so a person can see it without querying a database. A self-auditing
 * server section: it reads the store, states every denominator, renders "not
 * measured" where a value is absent, and refuses its own numbers if any headline
 * lacks a denominator (same contract as the rest of the console).
 */
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { auditRenderedNumbers, type RenderedNumber } from "@/lib/control-plane/owner-surface.ts";
import { compoundingPair, knownRouteIds } from "@/lib/control-plane/scheduler/field-manual-scout.ts";
import { count } from "@/lib/control-plane/plain-words.ts";
import type { ScoutResult } from "@/lib/control-plane/scheduler/scout-result.ts";
import { When } from "../../console-ui.tsx";
import { NeedsYouLine, NEEDS_NOTHING } from "../../status-ui.tsx";

const RECENT_WALKS = 25;

function newestFirst(a: ScoutResult, b: ScoutResult): number {
  return a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0;
}

export async function FieldManualSection() {
  const opened = await openControlPlane();
  if (!opened.ok) {
    return (
      <section className="card">
        <h2 id="field-manual">Field manual — what the fleet has learned</h2>
        <p className="refusal"><strong>The field manual could not be read.</strong> {opened.detail}</p>
      </section>
    );
  }

  const fmRow = await opened.repos.fieldManual.read("live");
  const scouts = [...(await opened.repos.scoutResults.readAll())].sort(newestFirst).slice(0, RECENT_WALKS);

  const store = fmRow?.value ?? null;
  const entries = store?.entries ?? [];
  const known = store ? knownRouteIds(store) : new Set<string>();

  // The store, broken down by whose knowledge it is — entries carry a role today.
  const byRole = new Map<string, number>();
  for (const e of entries) byRole.set(e.role, (byRole.get(e.role) ?? 0) + 1);
  const roleRows = [...byRole.entries()].sort((a, b) => b[1] - a[1]);

  // The most recently learned doors, newest first.
  const recent = [...entries]
    .filter((e) => e.observedAt)
    .sort((a, b) => (a.observedAt! < b.observedAt! ? 1 : -1))
    .slice(0, 6);

  // The compounding pair, over the recent scout walks. inheritedFieldManual is
  // OPTIONAL — a walk that predates the field manual recorded none, and that is
  // "not measured", never a zero.
  let walksWithField = 0;
  let reused = 0;
  let built = 0;
  let rebuilt = 0;
  for (const r of scouts) {
    built += r.candidates.length;
    if (r.inheritedFieldManual === undefined) continue;
    walksWithField += 1;
    const pair = compoundingPair(r.inheritedFieldManual, r, known);
    reused += pair.inheritedCount;
    rebuilt += pair.rebuiltExisting.length;
  }

  const numbers: RenderedNumber[] = [
    { label: "field manual entries", value: entries.length, denominator: entries.length, contract: "learned entries the cp_field_manual/live aggregate holds" },
    { label: "walks that recorded inheritance", value: walksWithField, denominator: scouts.length, contract: "recent scout walks that recorded how much they inherited, of the recent walks read" },
  ];
  const audit = auditRenderedNumbers(numbers);
  if (!audit.ok) {
    return (
      <section className="card">
        <h2 id="field-manual">Field manual — what the fleet has learned</h2>
        <p className="refusal"><strong>The field manual refused its own numbers.</strong> {audit.detail}</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2 id="field-manual">Field manual — what the fleet has learned</h2>
      <NeedsYouLine needs={NEEDS_NOTHING} />

      {store === null ? (
        <p className="plain">Not measured — the field manual has never been written. Once the seed runs and a scout walks, the numbers appear here.</p>
      ) : (
        <>
          <p className="plain">
            The field manual holds {count(entries.length)} learned {entries.length === 1 ? "entry" : "entries"} — the doors, source shapes and dead ends every prior worker recorded, in one place.{" "}
            {store.updatedOn ? <>Last added to <When iso={store.updatedOn} />.</> : "Not measured — no write recorded yet."}
          </p>

          {walksWithField === 0 ? (
            <p className="plain">
              <strong>Whether the method is compounding: not measured yet.</strong> None of the last {count(scouts.length)} recorded scout walks noted how many routes they inherited — that begins the first cycle after this ships.
            </p>
          ) : (
            <p className="plain">
              <strong>Scouts reused {count(reused)} known route{reused === 1 ? "" : "s"} and built {count(built)} new one{built === 1 ? "" : "s"}</strong> across the last {count(walksWithField)} of {count(scouts.length)} recorded walks.{" "}
              {rebuilt === 0
                ? "None rebuilt a door the manual already held — no wasted ground."
                : `${count(rebuilt)} of the new ones rebuilt a door the manual already held (a rebuild, not new ground — RULING 63 counts that as a defect).`}{" "}
              {reused > built
                ? "More reused than built means the fleet is standing on what it already knew — the method is compounding."
                : reused === 0
                  ? "Nothing reused yet — every walk is still starting fresh."
                  : "Reuse is starting; the ratio rising over cycles is the evidence it compounds."}
            </p>
          )}

          <p className="plain">Whose knowledge it is: {roleRows.length === 0 ? "not measured" : roleRows.map(([role, n]) => `${count(n)} ${role.toLowerCase()}`).join(", ")}.</p>

          {recent.length > 0 && (
            <>
              <p className="plain">Most recently learned:</p>
              <ul className="plain">
                {recent.map((e) => (
                  <li key={e.id}>
                    {e.title}
                    {e.states.length > 0 ? ` (${e.states.join("/").toUpperCase()})` : " (portable)"}
                    {e.observedAt ? <> — <When iso={e.observedAt} /></> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="note">The compounding ratio is measured for scouts, the one role that records it today. Other roles read &quot;not measured&quot; until they record the same pair.</p>
        </>
      )}
    </section>
  );
}
