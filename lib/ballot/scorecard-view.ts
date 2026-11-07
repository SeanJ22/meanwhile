import type { CardSource } from "../officials/card-sources.ts";
import type { ChamberScore, PartyKey, Scorecard, SeatCounts } from "./results.ts";

/**
 * What the scorecard card says and draws, as plain values. The component only lays these out.
 * Counts are exact; nothing here rounds or abbreviates a number.
 */

const PARTY_PLURAL: Readonly<Record<PartyKey, string>> = { D: "Democrats", R: "Republicans", O: "Other parties" };
const PARTY_SINGULAR: Readonly<Record<PartyKey, string>> = { D: "Democrat", R: "Republican", O: "Independent" };
export const partyPlural = (party: PartyKey): string => PARTY_PLURAL[party];
export const partySingular = (party: PartyKey): string => PARTY_SINGULAR[party];

const PARTY_ORDER: readonly PartyKey[] = ["D", "R", "O"];

function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The chamber whose control moved from one party to the other. */
export const chamberFlipped = (chamber: ChamberScore): PartyKey | null =>
  chamber.controlBefore && chamber.controlNow && chamber.controlBefore !== chamber.controlNow ? chamber.controlNow : null;

/** One-sentence summary under the title: who holds what now, and who held the chambers before. */
export function controlSummary(card: Scorecard): string {
  const holds = new Map<PartyKey, string[]>();
  const add = (party: PartyKey, office: string) => holds.set(party, [...(holds.get(party) ?? []), office]);
  if (card.governor) add(card.governor.party, "the governor’s office");
  const undecided: string[] = [];
  for (const chamber of card.chambers) {
    if (chamber.controlNow) add(chamber.controlNow, `the ${chamber.name}`);
    else undecided.push(`the ${chamber.name}`);
  }
  const now = PARTY_ORDER.filter(party => holds.has(party)).map(party => `${PARTY_PLURAL[party]} now hold ${joinList(holds.get(party)!)}.`);
  if (undecided.length) now.push(`No party has won ${joinList(undecided)} yet.`);

  const known = card.chambers.filter(chamber => chamber.controlBefore);
  const sentences = [...now];
  if (known.length && known.length === card.chambers.length) {
    if (!card.chambers.some(chamberFlipped)) sentences.push("No chamber changed party.");
    else {
      const parties = PARTY_ORDER.filter(party => known.some(chamber => chamber.controlBefore === party));
      const both = known.length === 2 ? (card.scope === "US" ? "both" : "both chambers") : known.length === 1 ? "the chamber" : "all the chambers";
      sentences.push(parties.length === 1
        ? `Before the election, ${PARTY_PLURAL[parties[0]]} held ${both}.`
        : `Before the election, ${joinList(parties.map(party => `${PARTY_PLURAL[party]} held ${joinList(known.filter(chamber => chamber.controlBefore === party).map(chamber => `the ${chamber.name}`))}`))}.`);
    }
  }
  return sentences.join(" ");
}

/** The label and body for the governor block under the chambers. */
export function governorBlock(card: Scorecard): { label: string; text: string } | null {
  if (card.scope === "US" || card.governorsFlipped) {
    if (!card.governorsFlipped) return null;
    const flips = card.governorsFlipped;
    if (!flips.length) return { label: "Governors", text: "No governor’s office changed party." };
    const byParty = PARTY_ORDER.map(party => [party, flips.filter(flip => flip.to === party).length] as const).filter(([, count]) => count > 0);
    const noun = flips.length === 1 ? "governor’s office" : "governor’s offices";
    const split = byParty.map(([party, count]) => `${count} to ${PARTY_PLURAL[party]}`);
    return { label: "Governors", text: `${flips.length} ${noun} changed party: ${joinList(split)}.` };
  }
  const governor = card.governor;
  if (!governor) return null;
  const who = `${governor.name}, ${PARTY_SINGULAR[governor.party]}`;
  if (governor.flipped) return { label: "Governor", text: `${who}, won. The office flipped to ${PARTY_PLURAL[governor.party]}.` };
  return { label: "Governor", text: `${who}, ${governor.reelected ? "re-elected" : "won"}. The office did not change party.` };
}

export interface FlipRow { office: string; to: PartyKey }

/** The statewide offices that changed party, with the label that counts them. */
export function statewideFlips(card: Scorecard): { label: string; rows: readonly FlipRow[] } | null {
  const statewide = card.statewide;
  if (!statewide || !statewide.flipped.length) return null;
  return { label: `Statewide offices that flipped · ${statewide.flipped.length} of ${statewide.total}`, rows: statewide.flipped };
}

export interface ChamberHeaderRow { name: string; flippedTo: PartyKey | null }
export const chamberHeaderRows = (card: Scorecard): ChamberHeaderRow[] =>
  card.chambers.map(chamber => ({ name: chamber.name, flippedTo: chamberFlipped(chamber) }));

/** "27 Democrats", "33 Republicans", "10 still counting": the colored text over a row of dots. */
export interface CountPart { kind: "D" | "R" | "O" | "counting"; text: string }
export function seatCountParts(counts: SeatCounts, options: { showZero?: boolean } = {}): CountPart[] {
  const parts: CountPart[] = [
    { kind: "D", text: `${counts.D} Democrats` },
    { kind: "R", text: `${counts.R} Republicans` },
  ];
  if (counts.O > 0) parts.push({ kind: "O", text: `${counts.O} ${counts.O === 1 ? "independent" : "independents"}` });
  if (counts.counting > 0 || options.showZero) parts.push({ kind: "counting", text: `${counts.counting} still counting` });
  return parts;
}

export interface PartyLine {
  label: string;
  value: string;
  /** "flip" lines are highlighted when above zero; "held" is bold party text with no pill. */
  kind: "plain" | "flip" | "held";
  /** True when a "flip" line carries a number above zero. */
  hot: boolean;
}

const flipLine = (label: string, count: number): PartyLine => ({ label, value: String(count), kind: "flip", hot: count > 0 });

/** The party scorecard for the state or the nation: Democrats or Republicans. */
export function partyLines(card: Scorecard, party: "D" | "R"): PartyLine[] {
  const chambers = card.chambers;
  const national = card.scope === "US";
  const lines: PartyLine[] = chambers.map(chamber => ({
    label: `${chamber.name} seats`, value: `${chamber.before[party]} → ${chamber.now[party]}`, kind: "plain", hot: false,
  }));
  if (!national && card.governor) {
    lines.push({ label: "Governor", value: card.governor.party === party ? "Held" : "Not held", kind: card.governor.party === party ? "held" : "plain", hot: false });
  }
  const statewide = card.statewide;
  if (!national && statewide?.won?.[party] !== undefined) {
    lines.push({ label: "Statewide races won", value: `${statewide.won[party]} of ${statewide.total}`, kind: "plain", hot: false });
  }
  for (const chamber of chambers) {
    const count = chamber.flippedTo?.[party];
    if (count !== undefined) lines.push(flipLine(`${chamber.name} seats flipped to this party`, count));
  }
  if (!national && statewide) lines.push(flipLine("Statewide offices flipped to this party", statewide.flipped.filter(flip => flip.to === party).length));
  if (card.governorsFlipped) lines.push(flipLine("Governor’s offices flipped to this party", card.governorsFlipped.filter(flip => flip.to === party).length));
  lines.push(flipLine("Incumbents who lost", card.incumbentsLost[party]));
  return lines;
}

/** Seat dots: 6px squares for chambers over 100 seats, else 10px; 4px apart. */
export const DOT_GAP = 4;
export const dotSize = (seats: number): number => seats > 100 ? 6 : 10;

/** How many dots fit across: floor((width + gap) / (size + gap)); at least one. */
export const columnsFor = (width: number, size: number, gap: number = DOT_GAP): number =>
  Math.max(1, Math.floor((width + gap) / (size + gap)));

export type DotKind = "D" | "counting" | "R" | "O";
export interface DotGrid {
  size: number;
  width: number;
  height: number;
  /** Rects in fill order, by kind, ready to draw. */
  groups: readonly { kind: DotKind; rects: readonly { x: number; y: number }[] }[];
}

/** Fill order: Democrats, still counting, Republicans, then other parties. Columns never exceed the chamber's seats. */
export function seatGrid(counts: SeatCounts, seats: number, width: number, gap: number = DOT_GAP): DotGrid {
  const size = dotSize(seats);
  const order: readonly [DotKind, number][] = [["D", counts.D], ["counting", counts.counting], ["R", counts.R], ["O", counts.O]];
  const total = order.reduce((sum, [, n]) => sum + n, 0);
  const columns = Math.min(columnsFor(width, size, gap), Math.max(1, seats, total));
  const pitch = size + gap;
  let index = 0;
  const groups = order.map(([kind, n]) => ({
    kind,
    rects: Array.from({ length: n }, () => {
      const at = index++;
      return { x: (at % columns) * pitch, y: Math.floor(at / columns) * pitch };
    }),
  })).filter(group => group.rects.length > 0);
  const rows = Math.max(1, Math.ceil(total / columns));
  const used = Math.min(columns, Math.max(1, total));
  return { size, width: used * size + (used - 1) * gap, height: rows * size + (rows - 1) * gap, groups };
}

/** The scorecard's own source list, shaped for the card's Sources row. */
export function scorecardSources(card: Scorecard | undefined): CardSource[] {
  return (card?.sources ?? []).map(source => ({
    what: source.what,
    provenance: { sourceUrl: source.url || null, sourceOrg: source.from, collectedAt: source.checked, verifiedAt: source.checked },
  }));
}

export const scorecardTitle = (card: Scorecard | undefined, fallbackName: string, scope: string): string =>
  scope === "US" ? "Congress after the election" : `${card?.name ?? fallbackName} after the election`;
