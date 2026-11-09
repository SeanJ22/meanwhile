"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { feedbackHref } from "@/lib/feedback/shape";
import { COUNTY_SEARCH_MIN, countyLabel, matchCounties, type CountyChoice } from "@/lib/map/results-counties";
import { BADGE_INK, INK, PARTY_FILL } from "@/lib/map/results-style";
import type { ResultParty } from "@/lib/map/results";
import styles from "./results-map.module.css";

/** Democrats point left, Republicans right: a flip points toward the party it went to. */
const ARROW: Record<ResultParty, string> = { D: "M10 6H3M5.5 3l-3 3 3 3", R: "M2 6h7M6.5 3l3 3-3 3", O: "M2 6h7M6.5 3l3 3-3 3" };

export function Arrow({ party, size = 12, stroke = 1.6 }: { party: ResultParty; size?: number; stroke?: number }) {
  return <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true"><path d={ARROW[party]} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function PillButton({ children, onClick, arrow }: { children: ReactNode; onClick: () => void; arrow?: "left" | "right" }) {
  return <button type="button" className={styles.back} onClick={onClick}>
    {arrow === "left" && <Arrow party="D" />}{children}{arrow === "right" && <Arrow party="R" />}
  </button>;
}

export function Segmented<T extends string>({ label, items, value, onChange }: { label: string; items: readonly { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return <div className={styles.seg} role="group" aria-label={label}>
    {items.map(item => <button key={item.id} type="button" aria-pressed={item.id === value} onClick={() => onChange(item.id)}>{item.label}</button>)}
  </div>;
}

/** The county picker: a search box appears when a state has more than ten counties. */
export function CountyChip({ counties, selected, onPick }: { counties: readonly CountyChoice[]; selected: CountyChoice | null; onPick: (county: CountyChoice) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const searchable = counties.length > COUNTY_SEARCH_MIN;
  const shown = matchCounties(counties, query);
  useEffect(() => { if (open && searchable) input.current?.focus(); }, [open, searchable]);
  const pick = (county: CountyChoice) => { onPick(county); setOpen(false); };
  return <>
    <button type="button" aria-pressed={selected !== null} aria-expanded={open} aria-haspopup="listbox"
      onClick={() => { setQuery(""); setOpen(value => !value); }}>
      <span>{selected ? countyLabel(selected) : "County"}</span>
      <svg width="12" height="12" viewBox="0 0 18 18" aria-hidden="true"><path d="M4.5 7l4.5 4.5L13.5 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open && <div className={styles.countyBox} onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>
      {searchable && <input ref={input} className={styles.countySearch} type="search" placeholder="Search counties" autoComplete="off" aria-label="Search counties"
        value={query} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && shown[0]) pick(shown[0]); }} />}
      <div className={styles.countyList} role="listbox" aria-label="Counties">
        {shown.map(county => <button key={county.ocdId} type="button" role="option" aria-selected={selected?.ocdId === county.ocdId} onClick={() => pick(county)}>{county.name}</button>)}
        {shown.length === 0 && <div className={styles.countyNone}>{counties.length ? "No county by that name" : "Counties are still loading"}</div>}
      </div>
    </div>}
  </>;
}

export type LegendKey = "D" | "R" | "O" | "split" | "counting" | "none" | "flipD" | "flipR" | "yours";

function Swatch({ kind }: { kind: LegendKey }) {
  const ink = INK;
  if (kind === "D" || kind === "R" || kind === "O") return <span className={styles.sw} style={{ background: PARTY_FILL[kind] }} />;
  if (kind === "split") return <span className={styles.sw} style={{ background: `radial-gradient(circle,${PARTY_FILL.D} 1.6px,transparent 1.9px) 0 0/5px 5px, radial-gradient(circle,${PARTY_FILL.R} 1.6px,transparent 1.9px) 2.5px 2.5px/5px 5px, ${ink.base}` }} />;
  if (kind === "counting") return <span className={styles.sw} style={{ background: `repeating-linear-gradient(45deg,${ink.stripeA} 0 3px,${ink.stripeB} 3px 4.5px)` }} />;
  if (kind === "none") return <span className={styles.sw} style={{ background: ink.none, boxShadow: `inset 0 0 0 1px ${ink.stripeB}` }} />;
  // The reader's outline is white on the map's dark ground, so its swatch sits on that ground whatever the legend panel's theme.
  if (kind === "yours") return <span className={styles.sw} style={{ background: ink.ground, boxShadow: `inset 0 0 0 2px ${ink.you}` }} />;
  const party = kind === "flipD" ? "D" : "R";
  return <span className={styles.dot} style={{ background: PARTY_FILL[party], color: BADGE_INK }}><Arrow party={party} size={10} stroke={1.8} /></span>;
}

export function Legend({ rows, phone }: { rows: readonly { key: LegendKey; label: string }[]; phone: boolean }) {
  const [open, setOpen] = useState(!phone);
  return <>
    {phone && <button type="button" className={styles.legendBtn} aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "Hide legend" : "Legend"}</button>}
    {open && <div className={styles.legend} style={phone ? { flexDirection: "row", flexWrap: "wrap", gap: "6px 12px" } : undefined} role="list" aria-label="Map legend">
      {rows.map(row => <div key={row.key} className={styles.row} role="listitem"><Swatch kind={row.key} />{row.label}</div>)}
    </div>}
  </>;
}

/** "We're working on getting …" with the same "sooner" request every other blank carries. */
export function GettingBanner({ about }: { about: string }) {
  return <>We&apos;re working on getting {about}. <a href={feedbackHref({ about, zip: null, intent: "sooner" })}>Want us to get this sooner?</a></>;
}

export function Banner({ children, phone, below }: { children: ReactNode; phone: boolean; below: number }) {
  return <div className={styles.banner} role="status" style={phone ? { left: 10, right: 10, top: below + 8, maxWidth: "none" } : { right: 476 }}>{children}</div>;
}

export function MapCard({ title, meta, flip, onClose, children }: {
  title: string; meta: string; flip?: { party: ResultParty; label: string } | null; onClose: () => void; children?: ReactNode;
}) {
  return <section className={styles.card} aria-label={title}>
    <div className={styles.cardHead}><h4>{title}</h4><button type="button" className={styles.close} aria-label="Close" onClick={onClose}>×</button></div>
    <div className={styles.meta}>{meta}</div>
    {flip && <div><span className={`${styles.pill} ${flip.party === "D" ? styles.pillLeft : ""}`} style={{ background: PARTY_FILL[flip.party] }}>{flip.label}<Arrow party={flip.party} size={11} /></span></div>}
    {children}
  </section>;
}

const PARTY_WORD: Record<ResultParty, { word: string; color: string }> = {
  D: { word: "Democrat", color: "var(--party-democratic)" }, R: { word: "Republican", color: "var(--party-republican)" }, O: { word: "Other", color: "var(--text-dim)" },
};

export function WinnerRow({ name, party, note }: { name: string; party: ResultParty | "C"; note: string }) {
  return <div className={styles.winner}>
    <span>{name}{" "}<span className={styles.dim}>· {party === "C" ? "Still counting" : PARTY_WORD[party].word}</span></span>
    <span style={{ fontWeight: 600 }}>{note}</span>
  </div>;
}

/** The phone's bottom sheet: collapsed it leaves the map two thirds of the screen. */
export function Sheet({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  return <div className={styles.sheet} style={{ height: open ? 620 : 216, maxHeight: "86%" }}>
    <button type="button" className={styles.sheetHandle} aria-expanded={open} aria-label={open ? "Show more map" : "Show more results"} onClick={onToggle}><span /></button>
    <div className={styles.sheetBody}>{children}</div>
  </div>;
}
