"use client";

/**
 * **Target Operating Model** — the interactive architecture explainer, reproduced
 * as a native Admin component from the approved design canvas.
 *
 * This is an ILLUSTRATIVE map of how the system should behave at full
 * effectiveness. It reads NOTHING from a repository, scheduler or served reader and
 * authorises no backend change — every word is static content from
 * `lib/admin/system-map-model.ts`. Live status, queue depth, freshness, spending and
 * blockers belong to the Fleet operations overlay, where an unavailable measurement
 * stays unavailable. Target capabilities and code-name labels describe intended
 * behaviour; they do not imply the current contracts establish them.
 *
 * Interactions reproduced: select any node for its detail (purpose / inputs /
 * outputs / dependencies / when-it-fails / next action / connected-to links);
 * focus one of four layers; highlight any of five feedback rings (stations numbered
 * in travel order); step through two illustrative journeys or architecture-only;
 * and toggle code-name visibility. All controls are real buttons — keyboard
 * focusable, Enter/Space activated, with aria-pressed state — and the layout
 * collapses to a single column on narrow viewports.
 */

import { useCallback, useId, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import {
  RING_MARK_COLOR,
  SYSTEM_BANDS,
  SYSTEM_BAND_ORDER,
  SYSTEM_HEADER,
  SYSTEM_JOURNEYS,
  SYSTEM_NODES,
  SYSTEM_NOT_SHOWN,
  SYSTEM_RINGS,
  nodeById,
  type BandId,
} from "@/lib/admin/system-map-model";

// journey === false ⇒ architecture-only (no journey); null ⇒ the default journey.
type JourneyState = string | null | false;
interface MapState {
  readonly sel: string;
  readonly band: BandId | null;
  readonly ring: string | null;
  readonly journey: JourneyState;
  readonly showCode: boolean;
}

const DEFAULT_JOURNEY = SYSTEM_JOURNEYS[0]?.id ?? null;

function chipStyle(active: boolean): CSSProperties {
  return {
    appearance: "none",
    cursor: "pointer",
    whiteSpace: "nowrap",
    font: "inherit",
    fontSize: 13,
    padding: "8px 14px",
    borderRadius: 999,
    border: 0,
    background: active ? "#272B36" : "#1A1D24",
    boxShadow: active ? "inset 0 0 0 1px rgba(255,255,255,0.20)" : "inset 0 0 0 1px rgba(255,255,255,0.07)",
    color: "var(--text, #E8E9ED)",
    transition: "background 200ms ease",
  };
}

export function SystemMap() {
  const [state, setState] = useState<MapState>({
    sel: "scheduler",
    band: null,
    ring: null,
    journey: null,
    showCode: true,
  });
  const headingId = useId();

  const journeyId = useMemo<string | null>(() => {
    if (state.journey === false) return null;
    if (state.journey !== null) return state.journey;
    return DEFAULT_JOURNEY;
  }, [state.journey]);

  const activeJourney = useMemo(
    () => SYSTEM_JOURNEYS.find((j) => j.id === journeyId) ?? null,
    [journeyId],
  );
  const activeRing = useMemo(
    () => (state.ring ? SYSTEM_RINGS.find((r) => r.id === state.ring) ?? null : null),
    [state.ring],
  );

  // Numbers on cards: ring stations (purple, travel order) win over journey steps
  // (coloured by their concurrent branch). Nothing is numbered in architecture-only.
  const marks = useMemo(() => {
    const out: Record<string, { n: string; color: string }> = {};
    if (activeRing) {
      activeRing.hops.forEach(([id], i) => {
        if (!out[id]) out[id] = { n: String(i + 1).padStart(2, "0"), color: RING_MARK_COLOR };
      });
      return out;
    }
    if (activeJourney) {
      for (const track of activeJourney.tracks) {
        track.steps.forEach((step, i) => {
          if (!out[step.nodeId]) out[step.nodeId] = { n: String(i + 1).padStart(2, "0"), color: track.color };
        });
      }
    }
    return out;
  }, [activeRing, activeJourney]);

  const anyMarks = Object.keys(marks).length > 0;
  const selected = nodeById(state.sel) ?? SYSTEM_NODES[0];

  const select = useCallback((id: string) => setState((s) => ({ ...s, sel: id })), []);
  const toggleBand = useCallback(
    (b: BandId) => setState((s) => ({ ...s, band: s.band === b ? null : b })),
    [],
  );
  const setJourney = useCallback(
    (j: JourneyState) => setState((s) => ({ ...s, journey: j, ring: null })),
    [],
  );
  const toggleRing = useCallback(
    (id: string) => setState((s) => ({ ...s, ring: s.ring === id ? null : id })),
    [],
  );

  const controlNote = state.ring
    ? "A ring is highlighted. Its stations are numbered on the map in travel order; everything else is dimmed."
    : state.band
      ? "One layer is in focus. Click the lit chip again to bring the rest back."
      : "Journeys are illustrations of intended behaviour, not recorded runs. Numbers on a card are that journey's step order, coloured by which concurrent branch it belongs to.";

  return (
    <section aria-labelledby={headingId} data-system-map style={{ display: "grid", gap: 20 }}>
      <style>{SYSTEM_MAP_CSS}</style>

      <header style={{ display: "grid", gap: 10 }}>
        <p className="note" style={{ letterSpacing: "0.14em", textTransform: "uppercase", margin: 0 }}>
          {SYSTEM_HEADER.eyebrow}
        </p>
        <h1 id={headingId} style={{ margin: 0, fontSize: "clamp(1.6rem, 3.4vw, 2.6rem)", lineHeight: 1.1, textWrap: "balance" }}>
          {SYSTEM_HEADER.headline}
        </h1>
        <p className="note" style={{ maxWidth: "62ch", margin: 0 }}>{SYSTEM_HEADER.intro}</p>
      </header>

      {/* The honesty banner: this is target architecture, not live status. */}
      <aside
        role="note"
        style={{
          borderRadius: 14,
          padding: "16px 20px",
          background: "color-mix(in srgb, var(--accent, #d97757) 8%, transparent)",
          boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent, #d97757) 40%, transparent)",
          display: "grid",
          gap: 6,
        }}
      >
        <strong style={{ color: "var(--accent, #d97757)", letterSpacing: "0.08em", fontSize: 12, textTransform: "uppercase" }}>
          {SYSTEM_HEADER.bannerTitle}
        </strong>
        <span className="note" style={{ margin: 0 }}>{SYSTEM_HEADER.bannerBody}</span>
      </aside>

      {/* Controls */}
      <div className="sm-controls">
        <fieldset className="sm-fieldset">
          <legend className="sm-legend">Focus a layer</legend>
          <div className="sm-chiprow">
            {SYSTEM_BAND_ORDER.map((k) => {
              const b = SYSTEM_BANDS[k];
              const active = state.band === k;
              return (
                <button key={k} type="button" aria-pressed={active} onClick={() => toggleBand(k)} style={chipStyle(active)}>
                  <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: b.color, marginInlineEnd: 8, verticalAlign: "middle" }} />
                  {b.kind}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="sm-fieldset">
          <legend className="sm-legend">Illustrative journey</legend>
          <div className="sm-chiprow">
            {SYSTEM_JOURNEYS.map((j) => {
              const active = journeyId === j.id && !state.ring;
              return (
                <button key={j.id} type="button" aria-pressed={active} onClick={() => setJourney(j.id)} style={chipStyle(active)}>
                  {j.label}
                </button>
              );
            })}
            <button type="button" aria-pressed={journeyId === null && !state.ring} onClick={() => setJourney(false)} style={chipStyle(journeyId === null && !state.ring)}>
              Architecture only
            </button>
          </div>
        </fieldset>

        <label className="sm-codetoggle">
          <input
            type="checkbox"
            checked={state.showCode}
            onChange={(e) => setState((s) => ({ ...s, showCode: e.target.checked }))}
          />
          Show code-name labels
        </label>

        <p className="note sm-controlnote" role="status" aria-live="polite">{controlNote}</p>
      </div>

      {/* Journey narration (only when a journey is active and no ring is highlighted). */}
      {activeJourney && !state.ring && (
        <JourneyPanel journeyId={activeJourney.id} selectedId={state.sel} onSelect={select} />
      )}

      {/* The map + detail panel */}
      <div className="sm-layout">
        <div className="sm-map">
          {SYSTEM_BAND_ORDER.map((k, i) => (
            <BandSection
              key={k}
              band={k}
              selectedId={state.sel}
              focusBand={state.band}
              marks={marks}
              anyMarks={anyMarks}
              showCode={state.showCode}
              onSelect={select}
              railBelow={i < SYSTEM_BAND_ORDER.length ? SYSTEM_BANDS[k] : undefined}
            />
          ))}
        </div>

        <DetailPanel node={selected} showCode={state.showCode} onSelect={select} />
      </div>

      {/* Feedback rings */}
      <section aria-label="How feedback returns" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>How feedback returns · five rings</h2>
          <p className="note" style={{ margin: 0 }}>
            A ring is a closed loop, not a one-way arrow. Highlight one and its stations are numbered on the map in travel order.
          </p>
        </div>
        <div className="sm-ringgrid">
          {SYSTEM_RINGS.map((r) => (
            <RingCard key={r.id} ringId={r.id} active={state.ring === r.id} onToggle={toggleRing} onSelect={select} showCode={state.showCode} />
          ))}
        </div>
      </section>

      {/* What this map does not show — it belongs to the measured Fleet overlay. */}
      <section aria-label="Not shown here" style={{ display: "grid", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Not shown here — it belongs to the Fleet operations overlay</h2>
        <div className="sm-notshown">
          {SYSTEM_NOT_SHOWN.map((n) => (
            <div key={n.title} className="card" style={{ display: "grid", gap: 4 }}>
              <strong style={{ fontSize: 13 }}>{n.title}</strong>
              <span className="note" style={{ margin: 0 }}>{n.note}</span>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function BandSection(props: {
  band: BandId;
  selectedId: string;
  focusBand: BandId | null;
  marks: Record<string, { n: string; color: string }>;
  anyMarks: boolean;
  showCode: boolean;
  onSelect: (id: string) => void;
  railBelow?: { railLabel: string; railNote: string; railColor: string };
}) {
  const b = SYSTEM_BANDS[props.band];
  const nodes = SYSTEM_NODES.filter((n) => n.band === props.band);
  return (
    <section aria-label={`${b.kind}: ${b.title}`} style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <span aria-hidden style={{ font: "inherit", fontSize: 12, color: b.color, fontVariantNumeric: "tabular-nums" }}>{b.num}</span>
        <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{b.title}</h2>
        <span className="note" style={{ margin: 0, flex: "1 1 16ch" }}>{b.note}</span>
      </div>
      <div className="sm-cardgrid">
        {nodes.map((n) => (
          <NodeCard
            key={n.id}
            id={n.id}
            selected={props.selectedId === n.id}
            mark={props.marks[n.id]}
            dim={
              props.focusBand && props.focusBand !== n.band
                ? 0.24
                : props.anyMarks && !props.marks[n.id]
                  ? 0.4
                  : 1
            }
            showCode={props.showCode}
            onSelect={props.onSelect}
          />
        ))}
      </div>
      {props.railBelow && (
        <p className="sm-rail" style={{ borderColor: `color-mix(in srgb, ${props.railBelow.railColor} 40%, transparent)` }}>
          <span style={{ color: props.railBelow.railColor, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 11 }}>{props.railBelow.railLabel}</span>{" "}
          <span className="note">{props.railBelow.railNote}</span>
        </p>
      )}
    </section>
  );
}

function NodeCard(props: {
  id: string;
  selected: boolean;
  mark?: { n: string; color: string };
  dim: number;
  showCode: boolean;
  onSelect: (id: string) => void;
}) {
  const n = nodeById(props.id);
  if (!n) return null;
  const b = SYSTEM_BANDS[n.band];
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={() => props.onSelect(n.id)}
      className="sm-card"
      style={{
        opacity: props.dim,
        background: props.selected ? "#252832" : "#181A20",
        boxShadow: props.selected
          ? `inset 0 0 0 1px ${b.color}, 0 0 18px ${b.color}44`
          : props.mark
            ? `inset 0 0 0 1px ${props.mark.color}88`
            : "inset 0 0 0 1px rgba(255,255,255,0.10)",
      }}
    >
      <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <span aria-hidden style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: b.color }}>{b.kind}</span>
        {props.mark && (
          <span
            aria-hidden
            style={{
              display: "inline-grid",
              placeItems: "center",
              width: 22,
              height: 22,
              borderRadius: 999,
              fontSize: 11,
              fontVariantNumeric: "tabular-nums",
              color: props.mark.color,
              boxShadow: `inset 0 0 0 1px ${props.mark.color}`,
            }}
          >
            {props.mark.n}
          </span>
        )}
      </span>
      <span style={{ display: "block", fontSize: 15, color: props.selected ? "#FFFFFF" : "var(--text, #E8E9ED)" }}>{n.title}</span>
      {props.showCode && n.code && (
        <span style={{ display: "block", fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 11.5, color: "var(--text-dim, #a8abb7)" }}>{n.code}</span>
      )}
    </button>
  );
}

const FIELD_LABELS: { key: "purpose" | "inputs" | "outputs" | "depends" | "failure" | "next"; label: string }[] = [
  { key: "purpose", label: "Purpose" },
  { key: "inputs", label: "Inputs" },
  { key: "outputs", label: "Outputs" },
  { key: "depends", label: "Dependencies" },
  { key: "failure", label: "When it fails" },
  { key: "next", label: "Next action" },
];

function DetailPanel(props: { node: ReturnType<typeof nodeById>; showCode: boolean; onSelect: (id: string) => void }) {
  const n = props.node;
  if (!n) return null;
  const b = SYSTEM_BANDS[n.band];
  return (
    <aside className="sm-detail card" aria-live="polite" aria-label={`Detail: ${n.title}`}>
      <div style={{ display: "grid", gap: 4, marginBottom: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: b.color }}>{b.kind}</span>
        <strong style={{ fontSize: 16 }}>{n.title}</strong>
        {props.showCode && n.code && (
          <span style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 11.5, color: "var(--text-dim, #a8abb7)" }}>{n.code}</span>
        )}
      </div>
      <dl style={{ display: "grid", gap: 10, margin: 0 }}>
        {FIELD_LABELS.map(({ key, label }) => (
          <div key={key} style={{ display: "grid", gap: 2 }}>
            <dt style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-dim, #a8abb7)" }}>{label}</dt>
            <dd style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{n[key]}</dd>
          </div>
        ))}
      </dl>
      {n.related.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-dim, #a8abb7)", margin: "0 0 6px" }}>Connected to</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {n.related.map((rid) => {
              const rn = nodeById(rid);
              if (!rn) return null;
              return (
                <button
                  key={rid}
                  type="button"
                  onClick={() => props.onSelect(rid)}
                  style={{ ...chipStyle(false), fontSize: 12, padding: "5px 10px" }}
                >
                  {rn.title}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}

function JourneyPanel(props: { journeyId: string; selectedId: string; onSelect: (id: string) => void }) {
  const j = SYSTEM_JOURNEYS.find((x) => x.id === props.journeyId);
  if (!j) return null;
  return (
    <section className="card" aria-label={`Journey: ${j.title}`} style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{j.title}</h2>
        <span className="op-badge" data-op="stale">Illustrative — not a recorded run</span>
      </div>
      <p className="note" style={{ margin: 0, maxWidth: "70ch" }}>{j.blurb}</p>
      <div className="sm-tracks">
        {j.tracks.map((t) => (
          <div key={t.name} style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: t.color, display: "inline-block" }} />
              <strong style={{ fontSize: 13 }}>{t.name}</strong>
              <span className="note" style={{ margin: 0 }}>{t.status}</span>
            </div>
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
              {t.steps.map((s, i) => {
                const sel = props.selectedId === s.nodeId;
                return (
                  <li key={`${s.nodeId}-${i}`}>
                    <button
                      type="button"
                      onClick={() => props.onSelect(s.nodeId)}
                      className="sm-step"
                      style={{ background: sel ? "rgba(255,255,255,0.05)" : "transparent" }}
                    >
                      <span aria-hidden style={{ color: t.color, fontVariantNumeric: "tabular-nums", fontSize: 12, marginInlineEnd: 8 }}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span style={{ color: sel ? "#FFFFFF" : "var(--text, #E8E9ED)", fontSize: 13 }}>{s.title}</span>
                      <span className="note" style={{ display: "block", margin: "2px 0 0 28px" }}>{s.detail}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}

function RingCard(props: { ringId: string; active: boolean; onToggle: (id: string) => void; onSelect: (id: string) => void; showCode: boolean }) {
  const r = SYSTEM_RINGS.find((x) => x.id === props.ringId);
  if (!r) return null;
  return (
    <div className="card" style={{ display: "grid", gap: 8, boxShadow: props.active ? `inset 0 0 0 1px ${RING_MARK_COLOR}` : undefined }}>
      <div style={{ display: "grid", gap: 2 }}>
        <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: RING_MARK_COLOR }}>{r.eyebrow}</span>
        <strong style={{ fontSize: 14 }}>{r.title}</strong>
      </div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
        {r.hops.map(([id, desc], i) => {
          const hn = nodeById(id);
          return (
            <li key={`${id}-${i}`} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span aria-hidden style={{ color: RING_MARK_COLOR, fontVariantNumeric: "tabular-nums", fontSize: 12 }}>{String(i + 1).padStart(2, "0")}</span>
              <span style={{ fontSize: 12.5 }}>
                <button type="button" className="sm-ringlink" onClick={() => props.onSelect(id)}>{hn?.title ?? id}</button>{" "}
                <span className="note">— {desc}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="note" style={{ margin: 0 }}>{r.closes}</p>
      <button
        type="button"
        aria-pressed={props.active}
        onClick={() => props.onToggle(r.id)}
        style={{ ...chipStyle(props.active), justifySelf: "start", fontSize: 12 }}
      >
        {props.active ? "Clear this ring" : "Highlight this ring on the map"}
      </button>
    </div>
  );
}

const SYSTEM_MAP_CSS = `
[data-system-map] .sm-controls { display: grid; gap: 12px; padding: 16px; border-radius: 14px; background: var(--panel, #181a20); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06); }
[data-system-map] .sm-fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 8px; }
[data-system-map] .sm-legend { padding: 0; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim, #a8abb7); }
[data-system-map] .sm-chiprow { display: flex; flex-wrap: wrap; gap: 8px; }
[data-system-map] .sm-codetoggle { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-dim, #a8abb7); cursor: pointer; }
[data-system-map] .sm-controlnote { margin: 0; max-width: 74ch; }
[data-system-map] .sm-layout { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr) minmax(280px, 340px); align-items: start; }
[data-system-map] .sm-map { display: grid; gap: 20px; min-width: 0; }
[data-system-map] .sm-detail { position: sticky; top: 12px; align-self: start; }
[data-system-map] .sm-cardgrid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
[data-system-map] .sm-card { text-align: left; cursor: pointer; border: 0; border-radius: 12px; padding: 12px 14px; display: grid; gap: 6px; transition: opacity 200ms ease, box-shadow 200ms ease, background 200ms ease; }
[data-system-map] .sm-rail { margin: 2px 0 0; padding: 8px 0 0; border-top: 1px solid; }
[data-system-map] .sm-ringgrid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
[data-system-map] .sm-notshown { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
[data-system-map] .sm-tracks { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
[data-system-map] .sm-step { display: block; width: 100%; text-align: left; border: 0; background: transparent; cursor: pointer; border-radius: 8px; padding: 6px 8px; color: inherit; }
[data-system-map] .sm-ringlink, [data-system-map] .sm-step { font: inherit; }
[data-system-map] .sm-ringlink { border: 0; background: transparent; padding: 0; cursor: pointer; color: var(--text, #E8E9ED); text-decoration: underline; text-underline-offset: 2px; }
[data-system-map] .sm-card:focus-visible, [data-system-map] .sm-step:focus-visible, [data-system-map] .sm-ringlink:focus-visible, [data-system-map] button:focus-visible { outline: 2px solid var(--link, #4fc9e8); outline-offset: 2px; }
@media (max-width: 860px) {
  [data-system-map] .sm-layout { grid-template-columns: minmax(0, 1fr); }
  [data-system-map] .sm-detail { position: static; }
}
`;
