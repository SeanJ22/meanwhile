/**
 * **THE SOLICITATION LEDGER — the artifact that proves equal solicitation.**
 * (RULING 160, 2026-08-25, Sean's ruling. Extends RULING 120, narrows nothing.)
 *
 * ## Why this exists when three of the four constraints need no instrument
 *
 * Neutrality is carried by four constraints: **equal solicitation**, **published
 * uniform rates**, **never exclusive**, and **no off-catalog bespoke cuts**.
 *
 * Three of those are ARTIFACTS and verify themselves. A rate sheet is either
 * published and uniform or it is not. An exclusivity clause either exists or it
 * does not. A cut is either on the catalog or it is off it. Anyone can check
 * those by looking, and no code is needed to make them true.
 *
 * **Equal solicitation is a BEHAVIOUR, and it is the one that actually carries
 * the neutrality.** Offering insight to the campaign that asked while never
 * approaching its opponent produces **a perfectly uniform rate sheet and a
 * lopsided customer list** — and that failure is invisible in every artifact
 * above. Nothing about the rates, the catalog or the absence of exclusivity
 * would look any different. It is only visible if the offers themselves are
 * written down.
 *
 * ## The reconciling unit is the CONTEST, and that is the design
 *
 * Sean's requirement is that it be answerable *at a glance and by anyone*
 * whether both sides of a contest were approached. A ledger sorted by BUYER
 * cannot answer that without the reader performing a join in their head, and a
 * claim that depends on the reader doing arithmetic is a claim nobody checks.
 * So `reconcileByContest` is the primary read, it returns NAMES rather than a
 * percentage, and a one-sided contest is a BREACH with the unapproached side
 * listed.
 *
 * ## What is NOT here, deliberately
 *
 * - **No reader anything.** No zip, no reaction, no search row, no continuity
 *   key, no email belonging to a reader. The ledger holds buyers, offers,
 *   published-rate references and PUBLIC contest ids. It shares no joinable
 *   column with any collection store (RULING 132), and
 *   `tests/solicitation-ledger.test.ts` asserts that over VALUE SPACES rather
 *   than over column names — because checking names is exactly how
 *   `feedback.reply_to` held a raw email address and was waved through.
 * - **No per-offer price.** An offer references a `rateCardId`; it cannot carry
 *   a number. A typed number is how an off-catalog cut gets made without
 *   anybody deciding to make one, which is constraint 4 failing quietly.
 * - **No buyer-composition target.** RULING 120's second half stands: who
 *   ACCEPTS is a fact about the market and is not an obligation. This measures
 *   what we did, never what they did.
 */

/** A published rate-card entry. Uniform by construction: one price per product. */
export interface RateCardEntry {
  /** Stable id an offer references. */
  readonly id: string;
  /** What is being sold, in plain language. */
  readonly product: string;
  /** The published price, in whole cents, for everybody. */
  readonly priceCents: number;
  /** The day this price was published. From `pnpm stamp`, never a guess. */
  readonly publishedOn: string;
}

/**
 * A buyer we may approach.
 *
 * `side` is the thing the ledger reconciles over, and it is deliberately NOT a
 * party label: a contest can have three candidates, an unaffiliated one, or a
 * committee acting for a slate. What matters is which CANDIDACY the buyer is
 * acting for, because that is what makes "both sides were approached"
 * checkable. A buyer acting for nobody in particular — a newsroom, a
 * university — carries `null` and is excluded from the reconciliation rather
 * than counted on one side of it.
 */
export interface Buyer {
  readonly id: string;
  /** The organization's own name, as filed. Never characterized (CLAUDE.md). */
  readonly name: string;
  /** The candidacy this buyer acts for, or `null` for an unaligned buyer. */
  readonly actsForCandidacyId: string | null;
}

/** One offer, made on one day, at one published rate, touching one contest. */
export interface Offer {
  readonly id: string;
  readonly buyerId: string;
  /** The PUBLIC ballot contest id. Nothing about a reader is derivable from it. */
  readonly contestId: string;
  /** A reference to a published rate. NEVER a number typed here. */
  readonly rateCardId: string;
  /** The day the offer went out. A plan is not a send (RULING 107). */
  readonly offeredOn: string;
}

export interface Ledger {
  readonly rateCard: readonly RateCardEntry[];
  readonly buyers: readonly Buyer[];
  readonly offers: readonly Offer[];
  /**
   * Every candidacy in every contest the ledger covers, so "who was NOT
   * approached" can be answered by NAME. Without this the ledger could only
   * ever report who WAS approached, which is the half that never looks wrong.
   */
  readonly contests: readonly {
    readonly contestId: string;
    readonly title: string;
    readonly candidacyIds: readonly string[];
  }[];
}

export interface ContestReconciliation {
  readonly contestId: string;
  readonly title: string;
  /** Candidacies whose buyer received an offer touching this contest. */
  readonly approached: readonly string[];
  /** Candidacies with no offer at all. THE BREACH, by name. */
  readonly notApproached: readonly string[];
  /** Offers from buyers acting for nobody — counted, never taken as a side. */
  readonly unalignedOffers: number;
  readonly equal: boolean;
}

/** An offer whose rate is not on the published card, or whose buyer is unknown. */
export interface LedgerDefect {
  readonly offerId: string;
  readonly why: string;
}

/**
 * Constraint 2 and constraint 4, checked together.
 *
 * An offer referencing a rate that is not on the published card IS an
 * off-catalog cut, whatever it is called, because the only thing making a rate
 * uniform is that it is the published one.
 */
export function offCatalogOffers(ledger: Ledger): LedgerDefect[] {
  const rates = new Set(ledger.rateCard.map((r) => r.id));
  const buyers = new Set(ledger.buyers.map((b) => b.id));
  const out: LedgerDefect[] = [];
  for (const offer of ledger.offers) {
    if (!rates.has(offer.rateCardId)) {
      out.push({
        offerId: offer.id,
        why: `rate "${offer.rateCardId}" is not on the published rate card — an off-catalog cut is constraint 4 failing quietly`,
      });
    }
    if (!buyers.has(offer.buyerId)) {
      out.push({ offerId: offer.id, why: `buyer "${offer.buyerId}" is not in the ledger` });
    }
  }
  return out;
}

/**
 * Constraint 1, per contest, by NAME.
 *
 * This is the read Sean asked for: at a glance, and by anyone, was every side of
 * this contest approached.
 */
export function reconcileByContest(ledger: Ledger): ContestReconciliation[] {
  const buyerById = new Map(ledger.buyers.map((b) => [b.id, b]));
  return ledger.contests.map((contest) => {
    const approached = new Set<string>();
    let unalignedOffers = 0;
    for (const offer of ledger.offers) {
      if (offer.contestId !== contest.contestId) continue;
      const buyer = buyerById.get(offer.buyerId);
      if (!buyer) continue;
      if (buyer.actsForCandidacyId === null) unalignedOffers += 1;
      else approached.add(buyer.actsForCandidacyId);
    }
    const notApproached = contest.candidacyIds.filter((c) => !approached.has(c));
    return {
      contestId: contest.contestId,
      title: contest.title,
      approached: [...approached].sort(),
      notApproached,
      unalignedOffers,
      // A contest nobody was approached about is not a BREACH — no offer was
      // made, so no advantage was handed to anyone. The breach is the LOPSIDED
      // case, which is the one an artifact can never show.
      equal: approached.size === 0 || notApproached.length === 0,
    };
  });
}

/** The contests where one side was approached and another was not. */
export function solicitationBreaches(ledger: Ledger): ContestReconciliation[] {
  return reconcileByContest(ledger).filter((r) => !r.equal);
}

/**
 * The whole verdict, in the shape a report prints.
 *
 * Both numbers, always, as a pair (the two-numbers rule) — and the breaches
 * carry the NAMES, because a count of breaches is a number somebody reads past
 * and a name is a person somebody has to go and approach.
 */
export function ledgerVerdict(ledger: Ledger): {
  contests: number;
  equal: number;
  breaches: ContestReconciliation[];
  offCatalog: LedgerDefect[];
  line: string;
} {
  const all = reconcileByContest(ledger);
  const breaches = all.filter((r) => !r.equal);
  const offCatalog = offCatalogOffers(ledger);
  return {
    contests: all.length,
    equal: all.length - breaches.length,
    breaches,
    offCatalog,
    line:
      `equal solicitation: ${all.length - breaches.length} of ${all.length} contest(s)` +
      (breaches.length === 0
        ? ""
        : ` — BREACH in ${breaches
            .map((b) => `${b.title} (not approached: ${b.notApproached.join(", ")})`)
            .join("; ")}`) +
      (offCatalog.length === 0 ? "" : ` — ${offCatalog.length} off-catalog offer(s)`),
  };
}
