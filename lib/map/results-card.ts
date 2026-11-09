import { formatPercent } from "../ballot/results.ts";
import { districtTitle, flipParty, type DistrictResult, type ResultParty } from "./results.ts";

/** A seat on a card: the party holding it, or still being counted. */
type SeatParty = ResultParty | "C";

export interface CardRow { name: string; party: SeatParty; note: string }
export interface CardModel {
  title: string;
  meta: string;
  flip: { party: ResultParty; label: string } | null;
  rows: CardRow[];
  /** False when nothing is filed for this place: the card says we're working on it. */
  hasResult: boolean;
}

const percent = (votes: number | null, total: number) => votes !== null && total > 0 ? formatPercent(votes / total * 100) : "";

/** The seats one by one: Democrats, Republicans, others, then those still being counted. */
const seatList = ({ counts }: Pick<DistrictResult, "counts">): SeatParty[] =>
  (["D", "R", "O", "counting"] as const).flatMap(key => Array.from({ length: counts[key] }, () => key === "counting" ? "C" as const : key));

function rowsFor(result: DistrictResult): CardRow[] {
  // The national summary names no candidates: a seat shows the party that holds it.
  if (result.candidates.length === 0) return seatList(result).map((party, index) => ({ name: result.seats > 1 ? `Seat ${index + 1}` : "Winner's party", party, note: "" }));
  const total = result.candidates.reduce((sum, candidate) => sum + (candidate.votes ?? 0), 0);
  const single = result.seats === 1;
  const rows: CardRow[] = result.candidates.filter(candidate => candidate.result === "won").map(candidate => ({
    name: candidate.name, party: candidate.party,
    note: single ? ["Won", percent(candidate.votes, total)].filter(Boolean).join(" · ") : "Won",
  }));
  for (const candidate of result.candidates) if (candidate.incumbent && candidate.result !== "won") rows.push({ name: candidate.name, party: candidate.party, note: "Incumbent · lost" });
  seatList(result).forEach((party, index) => { if (party === "C") rows.push({ name: single ? "Result" : `Seat ${index + 1}`, party: "C", note: "" }); });
  return rows;
}

function flipPill(result: DistrictResult) {
  const party = flipParty(result), count = result.flipSeats ?? 0;
  if (!party) return null;
  return { party, label: count > 1 ? `${count} seats flipped` : result.seats > 1 ? "1 seat flipped" : "Flipped" };
}

/** A legislative or U.S. House district's card. */
export function districtCard(ocdId: string, result: DistrictResult | undefined, yours: boolean): CardModel {
  const seats = result?.seats ?? 1;
  return {
    title: districtTitle(ocdId),
    meta: `${yours ? "Your district · " : ""}${seats > 1 ? `Top ${seats} win` : "Vote for 1"}`,
    flip: result ? flipPill(result) : null,
    rows: result ? rowsFor(result) : [],
    hasResult: Boolean(result),
  };
}

/** A state's U.S. Senate card. `raceThisYear` is false for a state with no Senate race. */
export function senateCard(name: string, result: DistrictResult | undefined, yours: boolean): CardModel & { raceThisYear: boolean } {
  return {
    title: `U.S. Senate, ${name}`,
    meta: `${yours ? "Your state · " : ""}${result ? (result.seats > 1 ? `Top ${result.seats} win` : "Vote for 1") : "No U.S. Senate race this year"}`,
    flip: result ? flipPill(result) : null,
    rows: result ? rowsFor(result) : [],
    hasResult: Boolean(result),
    raceThisYear: Boolean(result),
  };
}
