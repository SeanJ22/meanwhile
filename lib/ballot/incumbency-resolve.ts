/**
 * THE ONE PLACE A BALLOT SURFACE ASKS WHO HOLDS THE SEAT.
 * (2026-08-26, the sources-and-incumbency session. Item 10's consolidation.)
 *
 * **Three sites decided incumbency and none of them read the same source.**
 * Enumerated 2026-08-26:
 *
 * | Site | What it read |
 * |---|---|
 * | `components/ballot/candidate-battlecard.tsx` | a boolean prop derived from the FEC funding snapshot, defaulting to `false` |
 * | `components/map/popup/official-modal.tsx` | the literal `"INCUMBENT"`, asserted definitionally on an officeholder card |
 * | `scripts/coverage-matrix.mts` | `candidacy?.incumbent === true` on the ballot record, which is `null` for all 367 candidates in all four zips |
 *
 * They did not agree, they could not agree, and the disagreement was invisible
 * because two of the three never rendered a contradiction on the same page.
 * **That scatter is the root defect**; this module is where it is answered
 * once.
 *
 * The officeholder-card site is left as it is and is correct: `Incumbent` on a
 * card ABOUT a sitting officeholder is definitional, and it is already gated on
 * whether the office is elected at all (`standingChipMayAttach`, BC-26). What
 * consolidates here is the BALLOT question — which of these candidates holds
 * this seat — and the coverage matrix now reads the same answer.
 */

import type { SeatHolder } from "../officials/lookup.ts";
import { seatHoldersForDivision } from "../registry/server.ts";
import { standingChipMayAttach } from "../officials/elected-role.ts";

import {
  nameParts,
  namesAgree,
  namesAgreeLoosely,
  resolveContestIncumbency,
  splitDisplayName,
  type IncumbencyDecision,
  type SeatHolderRef,
} from "./incumbency.ts";
import { nhLegislativeHolders } from "./seat-holders.ts";

/**
 * One person on this ballot, as the two ballot branches each know them.
 *
 * **`key` and `targetKey` are deliberately separate.** The certified-lineup
 * branch keys a candidate by display name and builds `${contest.id}|${name}`;
 * the filed-candidate branch keys by a candidacy id and uses that id directly.
 * Collapsing them would have made the federal lookup silently ask for a key
 * that does not exist on one of the two branches — a join failing quietly,
 * which is the shape of the defect this whole module exists to fix.
 */
export interface ContestCandidate {
  /** How the calling surface will look this person's decision back up. */
  readonly key: string;
  /** The display name, for the name comparison. */
  readonly display: string;
  /** The key the FEC/congress join is stored under for this person. */
  readonly targetKey: string;
}

export interface ContestForIncumbency {
  readonly id: string;
  readonly title: string;
  /**
   * The seat's own division key. **This is the join, and it is exact.**
   *
   * `seatHoldersForDivision` is keyed by OCD-ID, so asking who sits in
   * `ocd-division/country:us/state:nh/sldl:607` is a lookup rather than a
   * search. Verified 2026-08-26: it returns Karen Ebel and Greg Sargent for
   * that division, Dan Innis for `sldu:7`, Bergen and Webber for NJ `sldl:26`,
   * and Volk and Keshel for AZ `sldl:17`.
   */
  readonly ocdId: string;
  readonly candidates: readonly ContestCandidate[];
  readonly federal: boolean;
}

export interface ContestIncumbencyResult {
  readonly decisions: Map<string, IncumbencyDecision>;
  /**
   * Candidate key → the officeholder record they hold the seat under.
   *
   * **This is what Item 14 needed and could not get.** The voting-record panel
   * was gated on the FEC/congress join, so a state legislator with roll calls
   * in the committed snapshot had no door to them. Now the same resolution that
   * decides the chip also hands over the officeholder id the votes are keyed
   * on.
   */
  readonly holderFor: Map<string, SeatHolder>;
}

/**
 * The federal route, kept behind a declared seam.
 *
 * `incumbentHolderFor` reads the FEC funding snapshot and requires a
 * `congress:` roster id, which is why it can only ever answer for federal
 * offices. That is FINE as one branch among several; what was wrong was it
 * being the ONLY branch while a ternary turned its silence into `Challenger`.
 */
export type FederalHolderLookup = (targetKey: string) => Promise<SeatHolder | null>;

export async function contestIncumbency(
  contest: ContestForIncumbency,
  federalHolderFor: FederalHolderLookup,
  holdersForDivision: (ocdId: string) => Promise<SeatHolder[]> = seatHoldersForDivision,
): Promise<ContestIncumbencyResult> {
  const candidates = contest.candidates.map((c) => ({
    id: c.key,
    ...splitDisplayName(c.display),
  }));

  // THE OFFICE GATE IS ASKED ONCE (RULING 118, BC-26, and RULING 103's reason).
  const officeIsElected = standingChipMayAttach(contest.title);

  /*
   * BRANCH ONE, AND IT IS AN EXACT KEY JOIN: the registry, asked by the seat's
   * own OCD-ID. No name matching reaches the SEAT at all — only the question of
   * which candidate is which sitting member, which is a smaller question over a
   * two-to-five-person population.
   */
  const registryHolders = officeIsElected ? await holdersForDivision(contest.ocdId) : [];
  let holders: SeatHolderRef[] = registryHolders.map((h) => ({
    ...splitDisplayName(h.name),
    personKey: null,
    source: `the officeholder registry for ${contest.ocdId}`,
  }));

  if (holders.length === 0 && contest.federal) {
    /*
     * For a federal contest the officeholder side is reached per candidate
     * rather than per seat, because that is the shape the FEC join has. A
     * nominee the join resolves IS a sitting member of this seat, so the
     * per-candidate answers assemble into the per-seat list this module wants.
     *
     * **A federal contest where the join resolves NOBODY yields an empty list
     * and therefore UNKNOWN — never a contest of challengers.** An open seat
     * and an unrecorded seat look identical from here, and the honest render
     * for both is that we have not sourced who holds it.
     */
    const resolved = await Promise.all(
      contest.candidates.map(async (c) => {
        const holder = await federalHolderFor(c.targetKey);
        return holder === null ? null : { display: c.display, holder };
      }),
    );
    holders = resolved
      .filter((r): r is { display: string; holder: SeatHolder } => r !== null)
      .map(({ display }) => ({
        ...splitDisplayName(display),
        personKey: null,
        source: "the FEC candidate/committee join against the congressional roster",
      }));
  }

  const decisions = resolveContestIncumbency({ candidates, holders, officeIsElected });

  /*
   * THE OFFICEHOLDER BEHIND EACH INCUMBENT, so the voting-record panel can be
   * gated on whether records EXIST rather than on a federal-only join.
   *
   * Matched the same way the decision was — by name, over the one contest — so
   * the panel and the chip cannot disagree about who this person is.
   */
  const holderFor = new Map<string, SeatHolder>();
  for (const c of contest.candidates) {
    if (decisions.get(c.key)?.standing !== "INCUMBENT") continue;
    const cand = nameParts(splitDisplayName(c.display).givenName, splitDisplayName(c.display).familyName);
    const hit = registryHolders.find((h) => {
      const parts = splitDisplayName(h.name);
      const hp = nameParts(parts.givenName, parts.familyName);
      return namesAgree(cand, hp) || namesAgreeLoosely(cand, hp);
    });
    if (hit) holderFor.set(c.key, hit);
  }

  return { decisions, holderFor };
}

/**
 * WHAT THE BODY'S OWN ROSTER SAYS ABOUT THE SAME SEAT.
 *
 * RULING 147 — no reconciliation may compare a parser to itself. The registry
 * above is Plural/Open States, an INTERMEDIARY. `gc.nh.gov/downloads/Members.txt`
 * is the New Hampshire General Court publishing its own membership. Comparing
 * the two is a real external anchor; re-deriving the registry from the registry
 * would agree with itself on every seat, every day, forever.
 *
 * It REPORTS and never overrides. A disagreement is a finding (RULING 57 and
 * RULING 114), closed by walking a third branch, never by editing the
 * expectation.
 */
export function anchorAgainstGencourt(
  contestTitle: string,
  registryHolderNames: readonly string[],
  ocdId: string,
): {
  anchor: "AGREES" | "DISAGREES" | "COULD_NOT_ANCHOR";
  detail: string;
} {
  /*
   * THE STATE GATE, and it is here because the first run of pnpm incumbency:census
   * proved it was needed. "State Senator, District 19" is a title ARIZONA and NEW
   * HAMPSHIRE both use, and a parser that reads only the title answered an AZ
   * contest with New Hampshire members. The resolution itself was never at risk —
   * it joins on the OCD-ID — but the ANCHOR was, and an anchor that compares the
   * wrong two things is worse than no anchor.
   */
  if (!ocdId.includes("/state:nh/")) {
    return {
      anchor: "COULD_NOT_ANCHOR",
      detail: `${ocdId} is not a New Hampshire division, and the General Court's roster only answers for New Hampshire seats.`,
    };
  }
  const body = nhLegislativeHolders(contestTitle);
  if (body.length === 0) {
    return {
      anchor: "COULD_NOT_ANCHOR",
      detail:
        "the General Court's own roster does not answer for this contest — either it is not a New " +
        "Hampshire legislative seat, or the title did not parse into the county-and-district pair the " +
        "roster is keyed on. NOT the same as agreeing (RULING 147).",
    };
  }
  const surname = (s: string) => splitDisplayName(s).familyName.toLowerCase();
  const bodySurnames = new Set(body.map((h) => h.familyName.toLowerCase()));
  const regSurnames = new Set(registryHolderNames.map(surname));
  const onlyBody = [...bodySurnames].filter((s) => !regSurnames.has(s));
  const onlyReg = [...regSurnames].filter((s) => !bodySurnames.has(s));
  if (onlyBody.length === 0 && onlyReg.length === 0) {
    return { anchor: "AGREES", detail: `${body.length} sitting member(s), same surnames on both sides` };
  }
  return {
    anchor: "DISAGREES",
    detail:
      `the General Court's roster carries ${bodySurnames.size} sitting member(s) and the registry ` +
      `carries ${regSurnames.size}. Only in the body's roster: ${onlyBody.join(", ") || "none"}. ` +
      `Only in the registry: ${onlyReg.join(", ") || "none"}. Two official enumerations disagreeing ` +
      "is a FINDING, not an error.",
  };
}
