/**
 * **Every person the product can render, and where their portrait comes
 * from.** (F01-continued session 2, item 0B, 2026-08-19.)
 *
 * ## Why this is a module rather than a loop inside a script
 *
 * Three scripts need this enumeration — `photo-census.mts` counts it,
 * `photo-review.mts` quotes it, `photo-reconcile.mts` intersects it against
 * the manifest — and before this module each of them would have had its own
 * copy of the walk. Four hand-copied `today()` functions in `scripts/` were
 * found the same day and converged for the same reason: a rule with N copies
 * has N places to drift, and the copy that drifts is always the one that
 * stops disagreeing with anything.
 *
 * It matters more here than for a date helper. The portrait numbers are the
 * ones F01-continued session 1 reported twice and could not reconcile — two
 * measures of two different populations set beside each other as though they
 * partitioned one, leaving 37 portraits nobody could account for. A shared
 * enumeration is what makes "the same 591" mean the same 591.
 *
 * ## The two universes, kept apart on purpose
 *
 * * **The SLOT side** — this module. Universe: people the product renders.
 *   Question: does this one have a portrait?
 * * **The MANIFEST side** — `lib/registry/official-photos.json`. Universe:
 *   portraits we hold. Question: can any surface reach this person?
 *
 * They cross but neither contains the other, and `portraitFrom` below is the
 * crossing term: a rendered portrait may come from the manifest, or from the
 * ballot cards file which is not in the manifest at all.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BALLOT_FILES, COVERED, rosterFile } from "./artifacts.ts";
import { BODY_ROSTERS } from "../registry/body-rosters.ts";
import { STATEWIDE_EXECUTIVES } from "../officials/statewide-executives.ts";

/** Which FILE a rendered portrait's bytes are recorded in. */
export type PortraitSource = "manifest" | "candidate-cards" | "inline";

export interface PhotoSlot {
  /** The surface a reader meets this person on. */
  surface:
    | "ballot candidates"
    | "federal officials"
    | "state legislators"
    | "curated local rosters"
    | "statewide executives";
  state: string;
  name: string;
  /** The officeholder id, where the slot resolves through one. */
  id: string | null;
  hasPortrait: boolean;
  /** Null exactly when `hasPortrait` is false. */
  portraitFrom: PortraitSource | null;
  /** Why a slot renders initials, for the named miss list. Null when it does not. */
  note: string | null;
}

function stateOfOcdId(ocdId: string): string {
  const m = /state:(\w\w)/.exec(ocdId);
  return m ? m[1].toUpperCase() : "??";
}

/**
 * Walk every surface and return one row per person.
 *
 * `root` is the repository root; the caller supplies it because a script and
 * a test resolve it differently and guessing is how a census quietly reads
 * the wrong tree.
 */
export function photoSlots(root: string): PhotoSlot[] {
  const read = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));
  const slots: PhotoSlot[] = [];

  // The manifest gate: a row only ships if it carries a licence. This is the
  // same test the render path applies, so the census cannot report a portrait
  // the product would refuse to serve.
  const manifest = read("lib/registry/official-photos.json") as {
    photos: { officeholderId: string; license: string | null }[];
  };
  const shippedIds = new Set(
    manifest.photos.filter((p) => p.license).map((p) => p.officeholderId),
  );

  const registry = read("lib/registry/registry.json") as {
    divisions: { ocdId: string; tier?: string }[];
  };
  const coveredOcdIds = new Set(registry.divisions.map((d) => d.ocdId));

  // ── Surface 1: ballot candidates (cards + lineup nominees) ────────────
  const cardsFile = read("data/ballot/candidate-cards-2026.json") as {
    cards: Record<string, { photoUrl: string | null }>;
  };
  for (const { file, state } of BALLOT_FILES) {
    const data = read(`data/ballot/${file}`) as {
      candidacies: { id: string; familyName: string; givenName: string }[];
    };
    for (const cand of data.candidacies) {
      const card = cardsFile.cards[cand.id];
      slots.push({
        surface: "ballot candidates",
        state,
        name: `${cand.givenName} ${cand.familyName}`,
        id: null,
        hasPortrait: Boolean(card?.photoUrl),
        portraitFrom: card?.photoUrl ? "candidate-cards" : null,
        note: card
          ? card.photoUrl
            ? null
            : "curated card, photo fell to initials (recorded hunt)"
          : "no curated card — renders initials",
      });
    }
  }
  const lineup = read("data/ballot/az-general-lineup-2026.json") as {
    contests: { contestId: string; nominees: { name: string }[] }[];
  };
  // A nominee who is also a candidacy (the governor's race) must not be
  // double-counted.
  const candidacyNames = new Set(slots.map((s) => s.name));
  for (const contest of lineup.contests) {
    for (const nominee of contest.nominees) {
      if (candidacyNames.has(nominee.name)) continue;
      const card = cardsFile.cards[`${contest.contestId}|${nominee.name}`];
      slots.push({
        surface: "ballot candidates",
        state: "AZ",
        name: nominee.name,
        id: null,
        hasPortrait: Boolean(card?.photoUrl),
        portraitFrom: card?.photoUrl ? "candidate-cards" : null,
        note: card?.photoUrl ? null : "lineup nominee — renders initials",
      });
    }
  }

  // ── Surface 2: federal roster officials ───────────────────────────────
  const us = read("lib/registry/officeholders-us.json") as {
    officeholders: { id: string; name: string }[];
    divisions: { officeholderId: string; ocdId: string }[];
  };
  const usRendered = new Map<string, string>();
  // House members render through the NATIONAL congressional-district layer,
  // so every attached House member is genuinely renderable.
  for (const d of us.divisions) {
    if (coveredOcdIds.has(d.ocdId)) usRendered.set(d.officeholderId, stateOfOcdId(d.ocdId));
  }
  // Senators attach to state-root divisions the registry does not carry —
  // they render through coverage.senators for the states covered at the
  // local tier. Derived from the registry, never hardcoded.
  const localTierStates = new Set(
    registry.divisions.filter((d) => d.tier === "local").map((d) => stateOfOcdId(d.ocdId)),
  );
  for (const d of us.divisions) {
    const m = /^ocd-division\/country:us\/state:(\w\w)$/.exec(d.ocdId);
    if (m && localTierStates.has(m[1].toUpperCase())) {
      usRendered.set(d.officeholderId, m[1].toUpperCase());
    }
  }
  for (const holder of us.officeholders) {
    const state = usRendered.get(holder.id);
    if (!state) continue; // not attached to a covered division — never renders
    const shipped = shippedIds.has(holder.id);
    slots.push({
      surface: "federal officials",
      state,
      name: holder.name,
      id: holder.id,
      hasPortrait: shipped,
      portraitFrom: shipped ? "manifest" : null,
      note: shipped ? null : "recorded miss in official-photos.json (license or 404)",
    });
  }

  // ── Surface 3: state legislators (district popups) ────────────────────
  for (const state of COVERED) {
    const data = read(`lib/registry/${rosterFile(state)}`) as {
      officeholders: { id: string; name: string }[];
      divisions: { officeholderId: string; ocdId: string }[];
    };
    const rendered = new Set(
      data.divisions.filter((d) => coveredOcdIds.has(d.ocdId)).map((d) => d.officeholderId),
    );
    for (const holder of data.officeholders) {
      if (!rendered.has(holder.id)) continue;
      const shipped = shippedIds.has(holder.id);
      slots.push({
        surface: "state legislators",
        state: state.usps,
        name: holder.name,
        id: holder.id,
        hasPortrait: shipped,
        portraitFrom: shipped ? "manifest" : null,
        note: shipped ? null : "recorded miss in official-photos.json (terms or absence)",
      });
    }
  }

  // ── Surface 4: curated local rosters (body popups, who-governs) ───────
  for (const roster of BODY_ROSTERS) {
    for (const member of roster.members) {
      const shipped = shippedIds.has(member.id);
      slots.push({
        surface: "curated local rosters",
        state: stateOfOcdId(roster.bodyId),
        name: member.name,
        id: member.id,
        hasPortrait: shipped,
        portraitFrom: shipped ? "manifest" : null,
        note: shipped ? null : "no shipped photo for this roster member",
      });
    }
  }

  // ── Surface 5: statewide executives (who-governs card, B11) ───────────
  for (const executive of STATEWIDE_EXECUTIVES) {
    const holder = executive.holder as {
      id: string;
      name: string;
      photoUrl?: string | null;
    };
    const viaManifest = shippedIds.has(holder.id);
    const viaInline = Boolean(holder.photoUrl);
    slots.push({
      surface: "statewide executives",
      state: stateOfOcdId(executive.stateOcdId),
      name: holder.name,
      id: holder.id,
      hasPortrait: viaManifest || viaInline,
      portraitFrom: viaManifest ? "manifest" : viaInline ? "inline" : null,
      note:
        viaManifest || viaInline
          ? null
          : "recorded miss in official-photos.json (terms or absence)",
    });
  }

  return slots;
}

/**
 * The standing portrait figures, derived from one walk so no two callers can
 * disagree about them.
 *
 * `rendered` is THE STANDING FIGURE for "portraits rendered". Everything else
 * on this object is derived from the same walk and is labelled as derived
 * wherever it is quoted.
 */
export function photoTotals(root: string) {
  const slots = photoSlots(root);
  const withPortrait = slots.filter((s) => s.hasPortrait);
  const from = (src: PortraitSource) =>
    withPortrait.filter((s) => s.portraitFrom === src).length;
  return {
    /** Slot denominator: every person the product renders. */
    people: slots.length,
    /** **STANDING** — people the product renders who have a portrait. */
    rendered: withPortrait.length,
    /** Derived: rendered portraits whose bytes are a manifest row. */
    fromManifest: from("manifest"),
    /** Derived: rendered portraits from the ballot cards file. */
    fromCandidateCards: from("candidate-cards"),
    /** Derived: rendered portraits recorded inline on the officeholder. */
    fromInline: from("inline"),
    /** Derived: the denominator less the standing figure. */
    initials: slots.length - withPortrait.length,
    slots,
  };
}
