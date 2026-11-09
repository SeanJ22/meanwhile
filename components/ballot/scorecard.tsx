"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ResultCard } from "@/components/ballot/result-card";
import { useResultsFeed } from "@/components/ballot/results-feed";
import { CardGapContribution, CardGapSection } from "@/components/ui/card-gap-context";
import { stateName } from "@/lib/facts/entity-read";
import {
  type PartyKey, type Scorecard,
  chamberFlipped, chamberHeaderRows, controlSummary, governorBlock, partyLines, partyPlural, scorecardSources, scorecardTitle,
  scorecardsFromFacts, seatCountParts, seatGrid, statewideFlips, type DotKind,
} from "@/lib/ballot/scorecard-view";
import styles from "./scorecard.module.css";

/** Measured before the chamber card has a width: a phone-sized card, so the first paint is close. */
const DEFAULT_DOTS_WIDTH = 246;

const PILL_PARTY: Readonly<Record<PartyKey, string>> = { D: styles.pillD, R: styles.pillR, O: styles.pillO };
const COUNT_CLASS = { D: styles.partyD, R: styles.partyR, O: styles.partyO, counting: styles.stillCounting } as const;
const FILL_CLASS: Readonly<Record<DotKind, string>> = { D: styles.fillD, R: styles.fillR, O: styles.fillO, counting: styles.fillCounting };

/** Democrat flips point left, every other party's point right. */
function FlipPill({ to, large = false }: { to: PartyKey; large?: boolean }) {
  const size = large ? 12 : 11;
  return <span className={`${styles.pill} ${PILL_PARTY[to]} ${large ? styles.pillMd : ""}`} data-flipped-to={to}>
    <span>Flipped<span className="sr-only"> to {partyPlural(to)}</span></span>
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d={to === "D" ? "M10 6H3M5.5 3l-3 3 3 3" : "M2 6h7M6.5 3l3 3-3 3"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </span>;
}

/** The card's inner width, kept current while the card resizes or first becomes visible. */
function useInnerWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_DOTS_WIDTH);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const read = () => { if (element.clientWidth > 0) setWidth(element.clientWidth); };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function SeatRow({ label, counts, seats, width, showZeroCounting }: {
  label: string; counts: Scorecard["chambers"][number]["now"]; seats: number; width: number; showZeroCounting: boolean;
}) {
  const grid = seatGrid(counts, seats, width);
  return <div className={styles.seatRow}>
    <div className={styles.counts}>
      <span className={styles.rowLabel}>{label}</span>
      {seatCountParts(counts, { showZero: showZeroCounting }).map(part => <span key={part.kind} className={COUNT_CLASS[part.kind]}>{part.text}</span>)}
    </div>
    <svg aria-hidden="true" width={grid.width} height={grid.height} viewBox={`0 0 ${grid.width} ${grid.height}`} shapeRendering="crispEdges">
      {grid.groups.map(group => <g key={group.kind} className={FILL_CLASS[group.kind]}>
        {group.rects.map((rect, index) => <rect key={index} x={rect.x} y={rect.y} width={grid.size} height={grid.size} rx={1} />)}
      </g>)}
    </svg>
  </div>;
}

function ChamberPanel({ chamber }: { chamber: Scorecard["chambers"][number] }) {
  const [ref, width] = useInnerWidth();
  const flipped = chamberFlipped(chamber);
  return <div className={styles.chamber} data-chamber={chamber.name}>
    <div className={styles.chamberHead}>
      <span className={styles.chamberName}>{chamber.name}</span>
      <span className={styles.chamberSize}>{chamber.seats} seats · {chamber.toControl} to control</span>
    </div>
    <div ref={ref} className={styles.dots}>
      <SeatRow label="Before" counts={chamber.before} seats={chamber.seats} width={width} showZeroCounting={false} />
      <SeatRow label="Now" counts={chamber.now} seats={chamber.seats} width={width} showZeroCounting={false} />
    </div>
    <div className={styles.control}>
      <span className={styles.controlLabel}>Control</span>
      {flipped ? <FlipPill to={flipped} large />
        : <span className={styles.controlNow}>{chamber.controlNow ? `${partyPlural(chamber.controlNow)}, no change` : "Not decided yet"}</span>}
    </div>
    {typeof chamber.seatsFlipped === "number" && <span className={styles.note}>Seats that flipped: {chamber.seatsFlipped}.</span>}
    {chamber.note && <span className={styles.note}>{chamber.note}</span>}
  </div>;
}

function PartyPanel({ card, party }: { card: Scorecard; party: "D" | "R" }) {
  const bar = party === "D" ? styles.partyDBar : styles.partyRBar;
  return <div className={`${styles.party} ${bar}`} data-party-scorecard={party}>
    <span className={`${styles.partyName} ${party === "D" ? styles.partyD : styles.partyR}`}>{partyPlural(party)}</span>
    {partyLines(card, party).map(line => {
      const tone = line.kind === "held" ? (party === "D" ? styles.heldD : styles.heldR) : line.hot ? (party === "D" ? styles.hotD : styles.hotR) : "";
      return <div key={line.label} className={styles.line}>
        <span className={styles.lineLabel}>{line.label}</span>
        <span className={`${styles.value} ${tone}`}>{line.value}</span>
      </div>;
    })}
  </div>;
}

function ScorecardBody({ card }: { card: Scorecard }) {
  const governor = governorBlock(card);
  const flips = statewideFlips(card);
  return <>
    {card.chambers.length > 0 && <div className={styles.chambers}>{card.chambers.map(chamber => <ChamberPanel key={chamber.name} chamber={chamber} />)}</div>}
    {typeof card.seatsFlippedTotal === "number" && <div className={styles.block}>
      <span className={styles.blockLabel}>State legislative seats that flipped</span><p className={styles.blockText}>{card.seatsFlippedTotal}</p>
    </div>}
    {(governor || flips) && <div className={styles.twoUp}>
      {governor && <div className={styles.block}><span className={styles.blockLabel}>{governor.label}</span><p className={styles.blockText}>{governor.text}</p></div>}
      {flips && <div className={styles.block}>
        <span className={styles.blockLabel}>{flips.label}</span>
        <ul className={styles.flips}>{flips.rows.map(row => <li key={`${row.office}:${row.to}`}><span>{row.office}</span><FlipPill to={row.to} /></li>)}</ul>
      </div>}
    </div>}
    {typeof card.incumbentsLostTotal === "number" && <div className={styles.block}>
      <span className={styles.blockLabel}>Incumbents who lost</span><p className={styles.blockText}>{card.incumbentsLostTotal}</p>
    </div>}
    <div className={styles.block}>
      <span className={styles.blockLabel}>Party scorecards</span>
      <div className={styles.parties}><PartyPanel card={card} party="D" /><PartyPanel card={card} party="R" /></div>
    </div>
  </>;
}

const tabId = (scope: string) => `scorecard-tab-${scope}`;

export interface ScorecardTab { code: string; label: string }

/**
 * The party scorecard card for one chosen area. `settled` is false while the results load. The ballot's card keeps its own
 * choice of area; the results map drives it from its state tabs, and opens it (`startOpen`).
 */
export function ScorecardView({ tabs, scope, onScope, card, settled, startOpen }: {
  tabs: readonly ScorecardTab[]; scope: string; onScope: (code: string) => void; card: Scorecard | undefined; settled: boolean; startOpen?: boolean;
}) {
  const labelOf = (code: string) => tabs.find(tab => tab.code === code)?.label ?? stateName(code) ?? code;
  const title = scorecardTitle(card, labelOf(scope), scope);
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const target = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : step ? (index + step + tabs.length) % tabs.length : -1;
    if (target < 0) return;
    event.preventDefault();
    onScope(tabs[target].code);
    document.getElementById(tabId(tabs[target].code))?.focus();
  };

  const rows = card ? chamberHeaderRows(card) : [];
  const sentence = card ? controlSummary(card) : "";
  const summary = card && (sentence || rows.length) ? <div className={`${styles.fills} ${styles.summary}`}>
    {sentence && <p className={styles.sentence}>{sentence}</p>}
    {rows.some(row => row.flippedTo) && <div className={styles.headRows}>
      {rows.filter(row => row.flippedTo).map(row => <span key={row.name} className={styles.headRow}>
        <span className={styles.headName}>{row.name}</span><FlipPill to={row.flippedTo!} />
      </span>)}
    </div>}
  </div> : undefined;

  return <ResultCard id="scorecard" title={title} tier={scope === "US" ? "national" : "state"} summary={summary} startOpen={startOpen}
    sources={scorecardSources(card)} attrs={{ "data-scorecard": scope }}>
    <div className={`${styles.fills} ${styles.body}`}>
      <div className={styles.tabs} role="tablist" aria-label="Scorecard area">
        {tabs.map((tab, index) => <button key={tab.code} id={tabId(tab.code)} type="button" role="tab" className={styles.tab}
          aria-selected={tab.code === scope} aria-controls="scorecard-panel" tabIndex={tab.code === scope ? 0 : -1}
          onClick={() => onScope(tab.code)} onKeyDown={event => moveTab(event, index)}>{tab.label}</button>)}
      </div>
      <div id="scorecard-panel" role="tabpanel" aria-labelledby={tabId(scope)} className={styles.body}>
        {card ? <ScorecardBody card={card} />
          : !settled ? null : <CardGapSection label={`${labelOf(scope)} results`}><CardGapContribution id={`scorecard:${scope}`} label={`${labelOf(scope)} results`} /></CardGapSection>}
      </div>
    </div>
  </ResultCard>;
}

/** The party scorecard card on the ballot: the reader's state and the whole country, switchable. */
export function ScorecardCard({ homeScope, homeName }: { homeScope: string; homeName: string }) {
  const feed = useResultsFeed();
  const scorecards = feed.status === "settled" ? scorecardsFromFacts(feed.facts, homeScope, homeName) ?? {} : undefined;
  const [scope, setScope] = useState(homeScope);
  const tabs = (homeScope === "US" ? ["US"] : [homeScope, "US"]).map(code => ({ code, label: code === "US" ? "United States" : scorecards?.[code]?.name ?? stateName(code) ?? code }));
  return <ScorecardView tabs={tabs} scope={scope} onScope={setScope} card={scorecards?.[scope]} settled={scorecards !== undefined} />;
}
