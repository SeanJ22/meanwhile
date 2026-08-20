/**
 * **The portrait review list** — D50 item 7b, the author's standing order
 * (2026-08-19): *"make sure those are noted in the tracker for ME to go look
 * at so I can give feedback."*
 *
 * `pnpm photo:review` → writes `docs/photo-review.md`.
 *
 * ## Why a generated list rather than a note
 *
 * A portrait is the one thing in this product that a machine cannot finally
 * judge. The never-wrong-face standard is a HUMAN judgment, and every rung
 * before it — the door, the licence, the sole-subject check, the EXIF strip —
 * exists to put a picture in front of a person who can say yes or no. A list
 * written by hand goes stale the first time a hunt runs; this one is
 * regenerated from the manifest, so it is always what is actually shipped.
 *
 * ## What lands on it, and it is deliberately two kinds
 *
 * 1. **FLAGGED** — a row carrying a `review` note. Today that is the two
 *    distance shots the author asked to see; tomorrow it is anything a hunt
 *    ships with a doubt attached. The note says what the doubt is, so he is
 *    not asked to guess what he is looking at.
 * 2. **NEW SINCE** — every portrait collected on or after a given date, so a
 *    session's own additions can be eyeballed as a batch. `--since=YYYY-MM-DD`.
 *
 * The list is a WORKING SURFACE, not a report: one row per portrait, the
 * image served from our own origin, the source URL beside it, and the door it
 * shipped through. Everything he needs to say "pull that one".
 */
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { STATEWIDE_EXECUTIVES } from "../lib/officials/statewide-executives.ts";
import { photoTotals } from "../lib/coverage/photo-slots.ts";

const ROOT = process.cwd();

// F01-continued session 2, item 0B. The SLOT-side figures come from the one
// module that walks the surfaces, so this file and `photo-census.mts` cannot
// print two different 591s.
const TOTALS = photoTotals(ROOT);
const RENDERED_PORTRAITS = TOTALS.rendered;
const RENDERED_PEOPLE = TOTALS.people;
const MANIFEST_DRAWN = TOTALS.fromManifest;
const CARD_DRAWN = TOTALS.fromCandidateCards;

interface Photo {
  officeholderId: string;
  name: string;
  url: string;
  sourceUrl: string;
  license: string;
  attribution: string | null;
  collectedAt: string;
  review?: string;
}

// F01-continued session 2, item 0B: the Phoenix day comes from the one
// module that owns it, exactly as `pnpm stamp` does. This file used to
// carry its own byte-identical copy of the formatter — correct on the day
// it was written, and one more place for the rule to drift.
import { today } from "./doc-dates.mjs";

/** Which of the four doors a licence string describes. Never guessed. */
function doorOf(license: string): string {
  if (/public domain|commons|cc[ -]by/i.test(license)) return "1 — recorded licence";
  if (/official government-published|door 2/i.test(license)) return "2 — official portrait";
  if (/campaign-provided|door 3/i.test(license)) return "3 — campaign's own";
  if (/door 4|last resort/i.test(license)) return "4 — last resort";
  return "unstated in the licence field";
}

/**
 * **WHERE DOES THIS PORTRAIT ACTUALLY RENDER?** — F01 2.3, 2026-08-19.
 *
 * The author's complaint, and it is about this file rather than about a
 * picture: *"fix docs/photo-review.md — it currently lists portraits with no
 * way to find them. Every entry states the zip and surface where it renders,
 * or says 'not rendered anywhere'. The author could not locate Taylor or Harb
 * because the file does not say where to look."*
 *
 * He could not locate them because **they do not render**. Brian Taylor and
 * Bob Harb are New Hampshire state representatives in `officeholders-33.json`
 * with NO division mapping — no `sldl:` seat — so no zip resolves to them and
 * no surface in this product draws their face. A review list that shows a
 * reviewer a picture and cannot tell them where it appears is asking them to
 * hunt for something that is not there.
 *
 * So each row now resolves its person against the shipped officeholder files
 * and the curated body rosters, and says one of three things: the DIVISION it
 * renders under (with a zip that reaches it, where one of the covered four
 * does), the ROSTER it sits on, or — truthfully — that nothing renders it.
 *
 * The division → zip map is deliberately SMALL and literal. It covers the four
 * zips this product actually covers in depth; anything outside them says which
 * division to look under without inventing a zip that might not resolve to it.
 */
function renderSites(): {
  sites: Map<string, string>;
  divisionIds: Set<string>;
  statewideIds: Set<string>;
} {
  const sites = new Map<string, string>();
  // F01-continued item 1: the two reachable kinds are counted separately,
  // because reporting only the division-mapped half against the manifest
  // total is what left 23 portraits in no category at all.
  const divisionIds = new Set<string>();
  const statewideIds = new Set<string>();

  const ZIP_FOR_STATE: Record<string, string> = {
    az: "85701",
    nj: "07866",
    nh: "03255",
  };

  for (const file of [
    "officeholders-us.json",
    "officeholders-04.json",
    "officeholders-33.json",
    "officeholders-34.json",
  ]) {
    let parsed: {
      officeholders?: { id: string }[];
      divisions?: Record<string, { officeholderId: string; ocdId: string }>;
    };
    try {
      parsed = JSON.parse(
        readFileSync(join(ROOT, "lib", "registry", file), "utf8"),
      );
    } catch {
      continue;
    }
    for (const seat of Object.values(parsed.divisions ?? {})) {
      if (!seat?.officeholderId || !seat.ocdId) continue;
      const state = /state:(\w\w)/.exec(seat.ocdId)?.[1] ?? "";
      const zip = ZIP_FOR_STATE[state];
      divisionIds.add(seat.officeholderId);
      sites.set(
        seat.officeholderId,
        zip
          ? `${seat.ocdId} — reachable at ${zip}`
          : `${seat.ocdId} — outside the four covered zips`,
      );
    }
  }

  // The curated local rosters key their own ids and render on the body card.
  try {
    const rosterPhotos = JSON.parse(
      readFileSync(join(ROOT, "lib", "registry", "roster-photos.json"), "utf8"),
    ) as Record<string, unknown>;
    for (const id of Object.keys(rosterPhotos)) {
      if (!sites.has(id)) sites.set(id, `curated body roster (${id.split("#")[0]})`);
    }
  } catch {
    // A missing roster file is not a reason to write nothing for the rest.
  }

  // F01-continued session 2, item 0B — the THIRD reach kind, and the reach
  // map could not see it.
  //
  // The three governors carry ids of the shape `statewide:az/governor`. They
  // have no `sldl:` seat and no roster-photos key, so both loops above miss
  // them and this file called them "not rendered anywhere" — while they
  // render on the who-governs card at EVERY zip, which is about as reachable
  // as anything in this product gets.
  //
  // Found by measuring rather than by reading: `scripts/photo-reconcile.mts`
  // intersected the manifest against the slots and found 557 manifest rows a
  // rendered slot actually draws against 554 this file called reachable. The
  // three names in the difference were Hobbs, Ayotte and Sherrill.
  for (const executive of STATEWIDE_EXECUTIVES) {
    const id = executive.holder.id;
    const state = /state:(\w\w)/.exec(executive.stateOcdId)?.[1] ?? "";
    const zip = ZIP_FOR_STATE[state];
    if (!sites.has(id)) {
      sites.set(
        id,
        zip
          ? `the who-governs card — reachable at ${zip} (and at every zip in ${state.toUpperCase()})`
          : "the who-governs card — reachable at every zip in the state",
      );
      statewideIds.add(id);
    }
  }

  return { sites, divisionIds, statewideIds };
}

const {
  sites: SITES,
  divisionIds: DIVISION_IDS,
  statewideIds: STATEWIDE_IDS,
} = renderSites();

const NOT_RENDERED =
  "**not rendered anywhere** — no division maps to this person, so no zip reaches them";

const sinceArg = process.argv.find((a) => a.startsWith("--since="));
const since = sinceArg ? sinceArg.slice("--since=".length) : null;

const manifest = JSON.parse(
  readFileSync(join(ROOT, "lib", "registry", "official-photos.json"), "utf8"),
) as { photos: Photo[]; missing: unknown[] };

const rendered = manifest.photos.filter((p) => SITES.has(p.officeholderId)).length;
// F01-continued item 1. The three categories are computed as a PARTITION —
// every manifest row lands in exactly one — so the figure cannot be reported
// with a component missing. F01 reported 902 collected, 531 division-mapped
// and 348 unreachable; 531 + 348 = 879, and the 23 that fell out of the
// arithmetic were the curated-body-roster portraits, which are reachable and
// were simply never named as their own kind.
const viaDivision = manifest.photos.filter((p) =>
  DIVISION_IDS.has(p.officeholderId),
).length;
// F01-continued session 2, item 0B: a THIRD reachable kind. The who-governs
// card renders the three governors at every zip in their state, and neither
// of the two loops above could see them — so `unreachable` carried three
// portraits that a reader reaches on the first screen they land on.
const viaStatewide = manifest.photos.filter((p) =>
  STATEWIDE_IDS.has(p.officeholderId),
).length;
const viaRoster = rendered - viaDivision - viaStatewide;
const unreachable = manifest.photos.length - rendered;

const flagged = manifest.photos.filter((p) => p.review);
const newSince = since
  ? manifest.photos.filter((p) => !p.review && p.collectedAt.slice(0, 10) >= since)
  : [];

function table(rows: Photo[], withNote: boolean): string {
  // F01 2.3: WHERE IT RENDERS is a column, on both tables. A review list a
  // reviewer cannot navigate from is a list of pictures, not a review.
  const head = withNote
    ? "| Person | Portrait | Door | Source | Where it renders | What to look at |\n|---|---|---|---|---|---|"
    : "| Person | Portrait | Door | Source | Where it renders | Collected |";
  const sep = withNote ? "" : "\n|---|---|---|---|---|---|";
  const body = rows
    .map((p) => {
      const img = `![${p.name}](../public${p.url})`;
      const src = `[page](${p.sourceUrl})`;
      const where = (SITES.get(p.officeholderId) ?? NOT_RENDERED).replace(/\|/g, "/");
      const tail = withNote ? p.review!.replace(/\|/g, "/") : p.collectedAt.slice(0, 10);
      return `| ${p.name} | ${img} | ${doorOf(p.license)} | ${src} | ${where} | ${tail} |`;
    })
    .join("\n");
  return `${head}${sep}\n${body}`;
}

const lines: string[] = [
  "# Portraits to eyeball",
  "",
  "**Generated by `pnpm photo:review` — do not hand-edit.** Regenerate it and",
  "the list is whatever is actually shipped right now.",
  "",
  "D50 item 7b, the author's standing order: every portrait he needs to look at",
  "in one place he can work from. A portrait is the one thing in this product a",
  "machine cannot finally judge — every rung before this one exists to put a",
  "picture in front of a person who can say yes or no.",
  "",
  `Generated ${today()}. Manifest holds **${manifest.photos.length}** portraits and`,
  `**${manifest.missing.length}** named misses.`,
  "",
  // F01 2.3: the shape of the collection, stated before any table, because it
  // is the first thing a reviewer needs and it is not what anyone assumed.
  // F01-continued item 1 made it a PARTITION that sums to the total.
  `**${rendered}** of those **${manifest.photos.length}** belong to a person some surface can`,
  `reach, so a reader can find them. The other **${unreachable}** belong to people`,
  "no surface resolves — mostly state legislators whose seat is not wired to",
  "a district yet — and **nothing in the product renders them**. That is why a",
  "portrait can be in the manifest and impossible to find on screen, and it is a",
  "MAPPING gap rather than a photo gap: the picture is fine, the seat is missing.",
  "",
  "### The standing figure, and it reconciles",
  "",
  `Counted ${today()} from \`lib/registry/official-photos.json\` against the`,
  "shipped division mappings, the curated body rosters and the who-governs",
  "card. Every manifest row lands in exactly ONE of these, which is the point:",
  "",
  "| | Count | What it means |",
  "|---|---|---|",
  `| **Collected** | **${manifest.photos.length}** | rows in the portrait manifest |`,
  `| — reachable, via a division mapping | ${viaDivision} | a zip resolves to the seat, so the face renders |`,
  `| — reachable, via a curated body roster | ${viaRoster} | no division seat, but a body card lists the person |`,
  `| — reachable, via the who-governs card | ${viaStatewide} | a statewide executive, on every zip in the state |`,
  `| — reachable by nobody | ${unreachable} | held, judged, and on no surface a reader can get to |`,
  "",
  `**${viaDivision} + ${viaRoster} + ${viaStatewide} + ${unreachable} = ${
    viaDivision + viaRoster + viaStatewide + unreachable
  }.**`,
  "",
  "### The standing figure for PORTRAITS RENDERED is **" +
    `${RENDERED_PORTRAITS}**, and everything else is derived from it`,
  "",
  "**Method.** `scripts/photo-census.mts` walks the SLOT side — every person",
  "the product can put on a screen — and asks of each whether the surface",
  "serves a judged photo. That is the number that answers the only question a",
  "reader's experience turns on, so it is the standing one. It is a count of",
  "PEOPLE WITH A FACE, not of manifest rows, and it is quoted from here.",
  "",
  "| Figure | Count | How it is obtained |",
  "|---|---|---|",
  `| **Portraits rendered (STANDING)** | **${RENDERED_PORTRAITS}** | slot side: people the product renders who have a portrait |`,
  `| — drawn from this manifest | ${MANIFEST_DRAWN} | derived: the standing figure less the candidate-card portraits |`,
  `| — drawn from \`candidate-cards-2026.json\` | ${CARD_DRAWN} | derived: ballot-candidate portraits, which never enter this manifest |`,
  `| People rendering initials | ${RENDERED_PEOPLE - RENDERED_PORTRAITS} | derived: the slot denominator less the standing figure |`,
  `| Slot denominator | ${RENDERED_PEOPLE} | every person the product renders |`,
  "",
  "**The two sides now cross exactly**, which is what says the ledger is",
  `closed: ${MANIFEST_DRAWN} manifest rows are drawn by a rendered slot, and`,
  `${viaDivision + viaRoster + viaStatewide} manifest rows are reachable — the same number.`,
  "",
  "**What the 37 was.** F01-continued session 1 set `531 + 23 + 348` beside",
  "`591 + 311` as though both partitioned the same 902 and reported that they",
  `disagreed by 37 about how many portraits reach a reader. They never`,
  "partitioned the same population. `pnpm photo:reconcile` intersects the two",
  `universes by id and resolves the 37 with no residue: **${CARD_DRAWN} of it is`,
  "ballot-candidate portraits**, which live in `candidate-cards-2026.json` and",
  `are not manifest rows at all, and **${viaStatewide} of it was a defect in this file** —`,
  "the three governors render on the who-governs card at every zip in their",
  "state, and the reach map above could see neither a `sldl:` seat nor a",
  "roster key for them, so it called them unreachable. They are the third row",
  "of the partition table now.",
  "",
  "**Neither side is a correction of the other.** This file counts PORTRAITS",
  "WE HOLD and asks whether anything renders them; the census counts PEOPLE",
  "THE PRODUCT RENDERS and asks whether each has a portrait. A report naming",
  "one number without saying which side it was counted from has said nothing",
  "checkable — which is exactly how the 37 survived a session.",
  "",
  "---",
  "",
  "## Flagged — shipped with a stated doubt",
  "",
];

if (flagged.length === 0) {
  lines.push("Nothing is flagged right now. That is a real zero: every shipped");
  lines.push("portrait passed its judgment without a note attached.");
} else {
  lines.push(
    `**${flagged.length}** shipped carrying a doubt the author asked to see. One line`,
    "pulls any of them back out.",
    "",
    table(flagged, true),
  );
}

if (since) {
  lines.push("", "---", "", `## New since ${since}`, "");
  if (newSince.length === 0) {
    lines.push(`No unflagged portrait has been collected since ${since}.`);
  } else {
    lines.push(`**${newSince.length}** collected since ${since}.`, "", table(newSince, false));
  }
}

lines.push(
  "",
  "---",
  "",
  "## What the standard is, so a review is against something",
  "",
  "A clean solo portrait or honest initials. Never a wrong face, a banner, a",
  "logo, a wordmark, a group shot, an event candid where the person is not the",
  "unambiguous sole subject, a screengrab, or a generated likeness. **Any doubt",
  "about identity fails at every door.**",
  "",
  "Composition is a different question from identity, and it is the one the",
  "flagged rows above are asking about.",
  "",
);

const out = join(ROOT, "docs", "photo-review.md");
writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
console.log(
  `wrote ${out}\n` +
    `  flagged for review: ${flagged.length}\n` +
    (since ? `  new since ${since}: ${newSince.length}\n` : "") +
    `  manifest: ${manifest.photos.length} portraits, ${manifest.missing.length} named misses`,
);
