import { districtTitle, flipCount, flipParty, type DistrictResult, type ResultParty, type SeatParty } from "./results.ts";

export interface CardRow { name: string; party: SeatParty; note: string }
export interface CardModel {
  title: string;
  meta: string;
  flip: { party: ResultParty; label: string } | null;
  rows: CardRow[];
  /** False when nothing is filed for this place: the card says we're working on it. */
  hasResult: boolean;
}

const percent = (votes: number | null, total: number) => votes !== null && total > 0 ? `${(votes / total * 100).toFixed(votes / total < 0.1 ? 2 : 1)}%` : "";

function rowsFor(result: DistrictResult): CardRow[] {
  // The national summary names no candidates: a seat shows the party that holds it.
  if (result.candidates.length === 0) return result.seats.map((seat, index) => ({ name: result.seats.length > 1 ? `Seat ${index + 1}` : "Winner's party", party: seat.party, note: "" }));
  const total = result.candidates.reduce((sum, candidate) => sum + (candidate.votes ?? 0), 0);
  const single = result.seats.length === 1;
  const rows: CardRow[] = result.candidates.filter(candidate => candidate.result === "won").map(candidate => ({
    name: candidate.name, party: candidate.party,
    note: single ? ["Won", percent(candidate.votes, total)].filter(Boolean).join(" · ") : "Won",
  }));
  for (const candidate of result.candidates) if (candidate.incumbent && candidate.result !== "won") rows.push({ name: candidate.name, party: candidate.party, note: "Incumbent · lost" });
  result.seats.forEach((seat, index) => { if (seat.party === "C") rows.push({ name: single ? "Result" : `Seat ${index + 1}`, party: "C", note: "" }); });
  return rows;
}

function flipPill(result: DistrictResult) {
  const party = flipParty(result), count = flipCount(result);
  if (!party) return null;
  return { party, label: count > 1 ? `${count} seats flipped` : result.seats.length > 1 ? "1 seat flipped" : "Flipped" };
}

/** A legislative or U.S. House district's card. */
export function districtCard(ocdId: string, result: DistrictResult | undefined, yours: boolean): CardModel {
  const seats = result?.seats.length ?? 1;
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
    meta: `${yours ? "Your state · " : ""}${result ? (result.seats.length > 1 ? `Top ${result.seats.length} win` : "Vote for 1") : "No U.S. Senate race this year"}`,
    flip: result ? flipPill(result) : null,
    rows: result ? rowsFor(result) : [],
    hasResult: Boolean(result),
    raceThisYear: Boolean(result),
  };
}

/** Phone House view: how many seats in a state have flipped so far. */
export function houseStateMeta(name: string, flips: number, yours: boolean): { title: string; meta: string } {
  return { title: `U.S. House, ${name}`, meta: `${yours ? "Your state · " : ""}${flips ? `${flips} ${flips > 1 ? "seats" : "seat"} flipped so far` : "No flips reported yet"}` };
}

const PARTY_NAME = { D: "Democrat", R: "Republican", O: "Other", C: "still counting" } as const;

/** "Democrat 3 · Republican 2 · 1 still counting": the seats a state holds in one chamber so far. */
export function seatSummary(result: DistrictResult): string {
  const counts = new Map<SeatParty, number>();
  for (const seat of result.seats) counts.set(seat.party, (counts.get(seat.party) ?? 0) + 1);
  return (["D", "R", "O", "C"] as const).flatMap(party => counts.has(party) ? [party === "C" ? `${counts.get(party)} still counting` : `${PARTY_NAME[party]} ${counts.get(party)}`] : []).join(" · ");
}
