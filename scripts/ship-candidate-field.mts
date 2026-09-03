/**
 * **ONE CANDIDATE'S HUNT RESULT, WRITTEN INTO THE CARD** (built 2026-08-21,
 * NH Hunt 2 item 2).
 *
 * ```
 * pnpm ship:candidate <plan.json>
 * ```
 *
 * The forty-seven-candidacy hunt needed a way to write what it found that was
 * not "edit a 3,000-line JSON file by hand, forty-seven times." Hand-editing is
 * how a `photoSource` loses its door, how a bio loses its read date, and how a
 * MISS stops being recorded at all — the miss is the thing a tired hand drops
 * first, and it is the half the equal-effort rule actually depends on.
 *
 * So this takes a PLAN — a JSON array, one entry per candidate — and applies it
 * whole, refusing anything that would ship a claim without its provenance.
 *
 * ## The plan entry
 *
 * ```json
 * {
 *   "key": "ballot-nh-merrimack:register-of-deeds:morse-samantha",
 *   "name": "Samantha Morse",
 *   "photo": {
 *     "url": "https://…/Morse 1.30.25.jpg",
 *     "door": 2,
 *     "source": "official portrait published by Merrimack County …",
 *     "judgment": "clean solo portrait, unambiguous sole subject, read as an image 2026-08-21",
 *     "file": "nh-merrimack-register-of-deeds-morse-samantha.jpg"
 *   },
 *   "bio": { "text": "…", "sourceUrl": "https://…", "sourceLabel": "In the campaign's words — …, read 2026-08-21" },
 *   "email": "…",
 *   "phone": "(603) 228-0101",
 *   "hunt": { "note": "rungs walked and what each returned", "attemptedAt": "2026-08-21" }
 * }
 * ```
 *
 * ## What it REFUSES, and why each refusal is a rule from `CLAUDE.md`
 *
 * - **A photo without a door, a source and a judgment.** The four-door rule
 *   governs the SOURCE BASIS and the composition standards are separate and
 *   never waived; the judgment string is the record that a person looked at the
 *   image, which RULING 2 requires and which no fetch can supply.
 * - **A photo that is not a JPEG or PNG this repo can strip.** EXIF goes or the
 *   bytes do not ship — `stripImageMetadata` decides, not the caller.
 * - **A bio without a source URL and a source-class label.** A description of a
 *   real person without its source class is treated as a generated claim and
 *   removed. There is no path through here that writes one.
 * - **An entry with no `hunt` note.** A field found and a field missed are both
 *   recorded; a plan that writes a value and says nothing about how it was
 *   reached has spent the discovery and kept nothing.
 * - **A key that is not a real candidacy or lineup key.** A card nothing renders
 *   is a fact about our file, not about a person.
 *
 * ## What it never does
 *
 * It never invents a value, never re-fetches an unchanged image, never removes
 * an existing value that the plan does not mention, and never writes the
 * four-state hunt field — RULING 23 keeps `VERIFIED_ABSENT` earned by a
 * completed hunt, and a script that set it from a plan would be a migration
 * writing it, which that ruling forbids by name.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { ballotPath } from "../lib/holdings/files.ts";
import { fileURLToPath } from "node:url";

import { stripImageMetadata } from "./strip-image-metadata.mts";
import { kindOf, normalisePortrait } from "./transcode-image.mts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CARDS = join(ROOT, "data", "ballot", "candidate-cards-2026.json");
const LINKS = join(ROOT, "data", "ballot", "candidate-links-2026.json");
const PHOTO_DIR = join(ROOT, "public", "candidates");
const REPORT = join(ROOT, "docs", "photo-report.md");

interface PhotoPlan {
  url: string;
  door: 1 | 2 | 3 | 4;
  source: string;
  judgment: string;
  file: string;
}

interface LinkPlan {
  url: string;
  /** What was read at that URL, on that date, that proves it is this person's page. */
  verification: string;
  attemptedAt: string;
}

interface Plan {
  key: string;
  name: string;
  photo?: PhotoPlan;
  bio?: { text: string; sourceUrl: string; sourceLabel: string };
  email?: string;
  phone?: string;
  /**
   * The two link fields of the Kelly standard, written into
   * `data/ballot/candidate-links-2026.json`: `official` is the SPECIFIC
   * VERIFIED PAGE (a body's own page for this person, never the body's front
   * door), `campaign` is the campaign site.
   *
   * A social page may be the `campaign` link only under `CLAUDE.md`'s
   * campaign-site rule — self-identifying with the filed name, the office AND
   * the cycle, reachable by an authoritative trail, with that trail recorded
   * here as the verification. It is labeled honestly on the card and it NEVER
   * supplies a photo.
   */
  official?: LinkPlan | null;
  campaign?: LinkPlan | null;
  hunt: { note: string; attemptedAt: string };
}

interface CardsFile {
  curatedAt: string;
  note: string;
  cards: Record<
    string,
    {
      photoUrl: string | null;
      photoSource: string | null;
      bio: string | null;
      bioSourceUrl: string | null;
      bioSourceLabel: string | null;
      email: string | null;
      phone: string | null;
    }
  >;
  hunts: { key: string; name: string; note: string; attemptedAt: string }[];
}

interface LinksFile {
  curatedAt: string;
  note: string;
  links: Record<string, { official?: LinkPlan | null; campaign?: LinkPlan | null }>;
  hunts: { key: string; name: string; note: string; attemptedAt: string }[];
}

function validCandidacyKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of ["nj-morris-2026.json", "nh-merrimack-2026.json", "az-pima-2026.json"]) {
    const path = join(ROOT, ballotPath(file));
    if (!existsSync(path)) continue;
    const set = JSON.parse(readFileSync(path, "utf8")) as {
      candidacies: { id: string }[];
      contests: { id: string }[];
    };
    for (const c of set.candidacies) keys.add(c.id);
    for (const c of set.contests) keys.add(c.id);
  }
  return keys;
}

async function main(): Promise<void> {
  const planPath = process.argv[2];
  if (!planPath || !existsSync(planPath)) {
    console.error("usage: pnpm ship:candidate <plan.json>");
    process.exit(2);
  }
  const plans = JSON.parse(readFileSync(planPath, "utf8")) as Plan[];
  const file = JSON.parse(readFileSync(CARDS, "utf8")) as CardsFile;
  const links = JSON.parse(readFileSync(LINKS, "utf8")) as LinksFile;
  const valid = validCandidacyKeys();

  const refusals: string[] = [];
  for (const plan of plans) {
    const base = plan.key.includes("|") ? plan.key.split("|")[0]! : plan.key;
    if (!valid.has(base) && !valid.has(plan.key))
      refusals.push(`${plan.key}: not a candidacy or contest key in any ballot file`);
    if (!plan.hunt?.note?.trim() || !plan.hunt?.attemptedAt?.trim())
      refusals.push(`${plan.key}: no hunt note — a value with no record of how it was reached`);
    if (plan.photo && (!plan.photo.door || !plan.photo.source?.trim() || !plan.photo.judgment?.trim()))
      refusals.push(`${plan.key}: a photo needs its door, its source and the judgment that a person looked at it`);
    if (plan.bio && (!plan.bio.sourceUrl?.trim() || !plan.bio.sourceLabel?.trim()))
      refusals.push(`${plan.key}: prose about a real person ships with its source class or it does not ship`);
  }
  if (refusals.length) {
    console.error("\nREFUSED — nothing written:\n");
    for (const r of refusals) console.error(`  ${r}`);
    process.exit(1);
  }

  if (!existsSync(PHOTO_DIR)) mkdirSync(PHOTO_DIR, { recursive: true });

  let photos = 0;
  let fields = 0;
  let linkFields = 0;
  const reportRows: string[] = [];
  for (const plan of plans) {
    const card = file.cards[plan.key] ?? {
      photoUrl: null,
      photoSource: null,
      bio: null,
      bioSourceUrl: null,
      bioSourceLabel: null,
      email: null,
      phone: null,
    };

    if (plan.photo) {
      const response = await fetch(plan.photo.url, {
        headers: {
          "User-Agent": "we-the-people/1.0 (civic data; seanj22@gmail.com)",
          Accept: "image/jpeg,image/png,image/*",
        },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        console.error(`  ${plan.name}: photo fetch HTTP ${response.status} — NOT shipped, and this is a WALL`);
        process.exit(1);
      }
      const raw = Buffer.from(await response.arrayBuffer());
      /*
       * THE CONTAINER IS NEVER A FINDING ABOUT THE PERSON (NH Hunt 4,
       * 2026-08-21). `normalisePortrait` decodes WebP and AVIF, names the
       * format from the BYTES rather than from the plan's filename, and caps
       * what a card is asked to load. All three were live defects on this
       * script's first run of the day: a WebP portrait refused outright, a
       * JPEG shipped under a `.png` name because the plan said so, and a
       * 2.7 MB image put on a card. Every change it makes is recorded in the
       * photo's own source string, so nothing we re-encoded is ever cited as
       * though it were the bytes the source published.
       */
      const portrait = await normalisePortrait(raw);
      const planned = plan.photo.file.replace(/\.[A-Za-z0-9]+$/, "");
      const fileName = `${planned}.${portrait.extension}`;
      if (fileName !== plan.photo.file) {
        console.log(
          `  photo  ${plan.name}  filename corrected to ${fileName} — the bytes are ` +
            `${kindOf(portrait.bytes)} and an extension that disagrees with its contents is a false label`,
        );
      }
      if (portrait.note) console.log(`  photo  ${plan.name}  ${portrait.note}`);
      const { bytes, stripped, removed } = stripImageMetadata(portrait.bytes);
      if (!stripped) {
        console.error(
          `  ${plan.name}: normalisePortrait returned a ${kindOf(portrait.bytes)} this repo cannot ` +
            `strip (source content-type ${response.headers.get("content-type")}) — bytes we cannot inspect do not ship`,
        );
        process.exit(1);
      }
      writeFileSync(join(PHOTO_DIR, fileName), bytes);
      card.photoUrl = `/candidates/${fileName}`;
      card.photoSource = portrait.note
        ? `${plan.photo.source} — ${portrait.note}`
        : plan.photo.source;
      photos++;
      /*
       * THE REPORT ROW IS WRITTEN BY THE SAME CALL THAT WRITES THE PHOTO.
       *
       * `docs/photo-report.md` is where a person eyeballs what ships, and
       * `tests/candidate-cards.test.ts` fails the build for a photo that is not
       * in it — correctly, because a photo missing from the report is a photo
       * nobody judged. Leaving the row to a second, manual step means the row
       * is the thing that gets forgotten at the end of a long hunt, which is
       * exactly what happened on this script's first run. One call, both files.
       */
      reportRows.push(
        `| ${plan.name} | \`/candidates/${fileName}\` | door ${plan.photo.door} — ${card.photoSource} | ${plan.photo.judgment} |`,
      );
      console.log(
        `  photo  ${plan.name}  door ${plan.photo.door}  ${bytes.length} bytes  ` +
          `(source ${portrait.sourceWidth}x${portrait.sourceHeight})` +
          (removed.length ? `  (stripped ${removed.join(", ")})` : "  (no metadata to strip)"),
      );
    }

    if (plan.bio) {
      card.bio = plan.bio.text;
      card.bioSourceUrl = plan.bio.sourceUrl;
      card.bioSourceLabel = plan.bio.sourceLabel;
      fields++;
    }
    if (plan.email !== undefined) {
      card.email = plan.email;
      fields++;
    }
    if (plan.phone !== undefined) {
      card.phone = plan.phone;
      fields++;
    }

    file.cards[plan.key] = card;
    file.hunts.push({
      key: plan.key,
      name: plan.name,
      note: plan.hunt.note,
      attemptedAt: plan.hunt.attemptedAt,
    });

    if (plan.official !== undefined || plan.campaign !== undefined) {
      /*
       * BOTH SIDES ALWAYS EXIST, and one of them is often `null`.
       * `tests/candidate-links.test.ts` walks `official` and `campaign` on
       * every entry and skips only an explicit `null`; an entry created with
       * one side missing throws on `link.url` rather than failing an
       * assertion, which is a guard reporting a crash instead of a defect.
       */
      const entry = links.links[plan.key] ?? { official: null, campaign: null };
      if (plan.official !== undefined) entry.official = plan.official;
      if (plan.campaign !== undefined) entry.campaign = plan.campaign;
      if (entry.official === undefined) entry.official = null;
      if (entry.campaign === undefined) entry.campaign = null;
      links.links[plan.key] = entry;
      linkFields++;
    }

    /*
     * THE LINKS FILE'S HUNT LEDGER IS ABOUT SITE HUNTS SPECIFICALLY, and its
     * notes have carried a `MISS —` / `NOT_ATTEMPTED —` prefix since 2026-08-13
     * so that an absence always states WHICH KIND it is. A site that was found
     * needs no miss row — the link itself is the record — so a row is written
     * here only when this key ends the run with no campaign link, and it says
     * so in the first word.
     */
    const campaignAfter = links.links[plan.key]?.campaign ?? null;
    if (!campaignAfter) {
      links.hunts.push({
        key: plan.key,
        name: plan.name,
        note: `MISS — ${plan.hunt.note}`,
        attemptedAt: plan.hunt.attemptedAt,
      });
    }
  }

  writeFileSync(CARDS, JSON.stringify(file, null, 2) + "\n", "utf8");
  writeFileSync(LINKS, JSON.stringify(links, null, 2) + "\n", "utf8");

  if (reportRows.length) {
    const report = readFileSync(REPORT, "utf8");
    const stamp = plans.find((p) => p.photo)!.hunt.attemptedAt;
    writeFileSync(
      REPORT,
      report.trimEnd() +
        `\n\n## NH Hunt 2 — candidate portraits shipped ${stamp}\n\n` +
        "| Person | Served from | Door and source | Judgment (read as an image) |\n" +
        "|---|---|---|---|\n" +
        reportRows.join("\n") +
        "\n",
      "utf8",
    );
    console.log(`  written  docs/photo-report.md  (+${reportRows.length} row(s))`);
  }
  console.log(
    `\n  plans ${plans.length}  photos shipped ${photos}  other fields set ${fields}  ` +
      `link entries touched ${linkFields}  hunt entries ${plans.length}\n` +
      `  written  data/ballot/candidate-cards-2026.json ` +
      `(${Object.keys(file.cards).length} cards, ${file.hunts.length} hunts)\n` +
      `  written  data/ballot/candidate-links-2026.json ` +
      `(${Object.keys(links.links).length} entries, ${links.hunts.length} hunts)\n`,
  );
}

await main();
