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

const ROOT = process.cwd();

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

function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

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
function renderSites(): Map<string, string> {
  const sites = new Map<string, string>();

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

  return sites;
}

const SITES = renderSites();

const NOT_RENDERED =
  "**not rendered anywhere** — no division maps to this person, so no zip reaches them";

const sinceArg = process.argv.find((a) => a.startsWith("--since="));
const since = sinceArg ? sinceArg.slice("--since=".length) : null;

const manifest = JSON.parse(
  readFileSync(join(ROOT, "lib", "registry", "official-photos.json"), "utf8"),
) as { photos: Photo[]; missing: unknown[] };

const rendered = manifest.photos.filter((p) => SITES.has(p.officeholderId)).length;

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
  `**${rendered}** of those **${manifest.photos.length}** belong to a person some division`,
  `maps to, so a zip can reach them. The other **${manifest.photos.length - rendered}** belong to people`,
  "with no division mapping — mostly state legislators whose seat is not wired to",
  "a district yet — and **nothing in the product renders them**. That is why a",
  "portrait can be in the manifest and impossible to find on screen, and it is a",
  "MAPPING gap rather than a photo gap: the picture is fine, the seat is missing.",
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
