/**
 * **THE KELLY SCOREBOARD — RULING 143 made checkable.**
 *
 * Sean's finish line for 07866, ruled 2026-08-24: *every candidate either meets
 * the Kelly standard in full — a photo, a phone, a working contact, a specific
 * verified page, and a campaign site — or carries an ARGUED ABSENCE: a five-move
 * stuck protocol under RULING 94 with its literal queries recorded, and an
 * expiry date under RULING 53. Nothing in between counts.*
 *
 * That sentence is only a finish line if something can compute it, and before
 * this module nothing could: the five fields lived in four different files with
 * four different shapes, and the argued absences lived nowhere at all.
 *
 * ## Why the state is DERIVED and never stored
 *
 * A `kellyDepth: "DONE"` column on a candidate record would be a claim that goes
 * stale the moment any of the five files moves, and nothing would notice —
 * RULING 116's frozen gap, wearing a per-row costume. So the answer is computed
 * from the files that actually hold the facts, every time it is asked.
 *
 * ## An absence EXPIRES, and that is not a detail
 *
 * RULING 53 gives a candidate field a seven-day clock. A protocol walked on
 * Monday is owed again the following Monday, so `at` is compared against the day
 * the scoreboard is run and a stale absence returns the field to OWED. **Done is
 * not a permanent state**, and a scoreboard that reported it as one would be
 * describing a measurement as a conclusion.
 *
 * ## An absence with no protocol is VOID
 *
 * RULING 94, unchanged. A record here without five moves carrying literal query
 * text does not count as an argued absence — it counts as nothing, and the field
 * is still owed. That is checked rather than trusted, because this is exactly
 * the place a session is tempted to round up.
 */

/** The five fields, named once so nothing can drift into a sixth or a fourth. */
export const KELLY_FIELDS = ["photo", "phone", "contact", "verifiedPage", "campaignSite"] as const;

export type KellyField = (typeof KELLY_FIELDS)[number];

/** RULING 53 — a candidate field's measurement is good for seven days. */
export const CANDIDATE_FIELD_EXPIRY_DAYS = 7;

/** The five moves of RULING 94, in order, named so a record cannot invent a sixth. */
export const STUCK_MOVES = [
  "browser-query",
  "tier-above",
  "same-shape",
  "who-compiled-it",
  "lateral",
] as const;

export type StuckMove = (typeof STUCK_MOVES)[number];

export interface StuckStep {
  move: StuckMove;
  /** The literal text typed or the literal URL requested. Never a description. */
  query: string;
  /** What came back, including zero. */
  result: string;
  /**
   * Did this move REACH its source, or was it refused?
   *
   * The distinction is the whole difference between an absence and a wall.
   * `CLAUDE.md`: *no field may move toward `VERIFIED_ABSENT` on a route we were
   * not allowed to walk.* A move that got a challenge page has been attempted
   * and has not been walked, and an absence built on five of those is an
   * absence built on nothing.
   */
  reached: boolean;
}

export interface ArguedAbsence {
  candidacyId: string;
  field: KellyField;
  /** The five moves. Fewer than five is VOID. */
  protocol: StuckStep[];
  /** The day the protocol was walked. Expires under RULING 53. */
  at: string;
  /** The day this stops carrying a claim on being current. */
  expiresOn: string;
  /** Why the absence is believed, in words a reader could check. */
  argument: string;
}

export type FieldState =
  /** The field is held. */
  | { state: "HELD"; evidence: string }
  /** A complete, unexpired stuck protocol says it is not there. */
  | { state: "ARGUED_ABSENT"; at: string; expiresOn: string }
  /** Nobody has looked, or the looking does not meet the bar. */
  | { state: "OWED"; why: string };

export interface KellyReading {
  candacyId: string;
  subject: string;
  contestId: string;
  fields: Record<KellyField, FieldState>;
  /** RULING 143's test: every field HELD or ARGUED_ABSENT. */
  done: boolean;
  owed: KellyField[];
}

/** `YYYY-MM-DD` plus n days, without round-tripping through a `Date`. RULING 140. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  const dt = new Date(t);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Is this record an absence a reader could check, on this date?
 *
 * Three ways to fail, and they are kept apart because they call for different
 * responses: an incomplete protocol is a session that stopped early, a repeated
 * move is a session that filled a quota, and an expired one is simply time
 * passing.
 */
export function absenceStands(
  absence: ArguedAbsence,
  onDay: string,
): { stands: boolean; why: string } {
  if (absence.protocol.length < STUCK_MOVES.length) {
    return {
      stands: false,
      why:
        `VOID — ${absence.protocol.length} of ${STUCK_MOVES.length} stuck-protocol moves recorded. ` +
        "RULING 94: a recorded absence with no stuck-protocol block is void and the field returns to owed.",
    };
  }
  const moves = new Set(absence.protocol.map((s) => s.move));
  if (moves.size < STUCK_MOVES.length) {
    return {
      stands: false,
      why:
        "VOID — the protocol repeats a move rather than walking all five. Five rows of the same " +
        "question is one question asked five times.",
    };
  }
  const empty = absence.protocol.filter((s) => !s.query.trim() || !s.result.trim());
  if (empty.length > 0) {
    return {
      stands: false,
      why: `VOID — ${empty.length} move(s) carry no literal query or no result. RULING 88 asks for the text that was typed, never a description of the search.`,
    };
  }
  /*
   * **A WALLED MOVE IS AN ATTEMPT, NOT A WALK.**
   *
   * `CLAUDE.md` is explicit that no field may move toward `VERIFIED_ABSENT` on a
   * route we were not allowed to walk, and the general web index is exactly such
   * a route at 07866: every host whose `robots.txt` permits walking answers this
   * project's requests with a bot challenge. A protocol whose broad moves were
   * all refused has recorded five honest attempts and established nothing about
   * the fact.
   *
   * The bar is deliberately low — ONE move must have reached a source — because
   * the alternative is a bar no small-town candidate could ever clear, and the
   * point of an argued absence is that it can be earned.
   */
  const reached = absence.protocol.filter((s) => s.reached);
  if (reached.length === 0) {
    return {
      stands: false,
      why:
        "VOID — all five moves were REFUSED and none reached a source. Five walls are five " +
        "attempts, and no field moves toward absence on a route we were not allowed to walk.",
    };
  }
  if (absence.expiresOn < onDay) {
    return {
      stands: false,
      why: `STALE — walked ${absence.at}, expired ${absence.expiresOn}. RULING 53: the field is owed again.`,
    };
  }
  return { stands: true, why: `walked ${absence.at}, current until ${absence.expiresOn}` };
}

/* ========================================================================== *
 *  IS A FIELD HELD — ONE implementation, and it had two for an hour
 * ========================================================================== */

/** What a caller must supply to answer the question. */
export interface KellyHeldInput {
  card: { photoUrl?: string | null; phone?: string | null; email?: string | null } | undefined;
  links: { official?: { url: string } | null; campaign?: { url: string } | null } | undefined;
  /** The contact the filing itself published, where the zip's clerk publishes one. */
  filedEmail: string | null;
  /** Does the committed portrait exist on disk? A path to nothing is not a photo. */
  photoOnDisk: (url: string) => boolean;
}

/**
 * **Is this Kelly field held, and what is the evidence?**
 *
 * ## WHY THIS IS HERE RATHER THAN IN THE SCOREBOARD
 *
 * It was written twice on 2026-08-25 — once in `scripts/kelly-scoreboard.mts`
 * and once in `scripts/argue-absences-0825.mts` — and the two disagreed within
 * the hour. The absence generator counted a PHONE as satisfying `contact`; the
 * scoreboard did not. The consequence was silent and exactly wrong: eight New
 * Hampshire candidates were skipped by the generator as already complete and
 * reported by the scoreboard as still owing the field, so a protocol nobody ran
 * looked like a field nobody needed.
 *
 * RULING 103, in code written the same night as the ruling was cited. Two
 * implementations of one judgement is the thing that can disagree, and the fix
 * is one implementation rather than two careful ones.
 *
 * ## AND `contact` DOES NOT MEAN `phone`
 *
 * `phone` is its own Kelly field. Counting a phone as a contact would let one
 * finding satisfy two of the five, which is a scoreboard measuring four things
 * and calling it five. A contact is an address a reader can write to: the
 * candidate's own email on the card, or the email the filing authority
 * published.
 */
export function kellyFieldHeld(
  field: KellyField,
  input: KellyHeldInput,
): { yes: boolean; evidence: string } {
  const { card, links, filedEmail, photoOnDisk } = input;
  switch (field) {
    case "photo": {
      const url = card?.photoUrl ?? null;
      if (!url) return { yes: false, evidence: "no photoUrl on the card" };
      /*
       * The asset must EXIST. A photoUrl pointing at nothing renders as a broken
       * image, which is worse than an honest initials block — and it would count
       * as a held field while the reader sees a gap.
       */
      if (!photoOnDisk(url)) return { yes: false, evidence: `photoUrl ${url} but no file at public${url}` };
      return { yes: true, evidence: url };
    }
    case "phone":
      return card?.phone
        ? { yes: true, evidence: card.phone }
        : { yes: false, evidence: "no phone on the card" };
    case "contact": {
      const e = card?.email ?? filedEmail ?? null;
      return e ? { yes: true, evidence: e } : { yes: false, evidence: "no email held" };
    }
    case "verifiedPage":
      return links?.official
        ? { yes: true, evidence: links.official.url }
        : { yes: false, evidence: "no verified official page" };
    case "campaignSite":
      return links?.campaign
        ? { yes: true, evidence: links.campaign.url }
        : { yes: false, evidence: "no campaign site" };
  }
}
