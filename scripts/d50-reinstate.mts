/**
 * @freshness-reads-here
 *
 * RULING 107 — the clock stamps in this file are minted by the code path that
 * performs the read: the freshness date is taken at the moment of the fetch,
 * which is what the ruling asks for rather than what it forbids. Verified
 * 2026-08-23 by reading each stamp site against the retrieval it sits in.
 */
/**
 * **D50 item 7c — reinstate the two portraits the never-wrong-face gate held
 * back**, on the author's instruction (2026-08-19): *"Put them in for now,
 * but be prepared to pull them out. I want to see it to assess it."*
 *
 * Brian Taylor and Bob Harb are New Hampshire House members whose OFFICIAL
 * portraits — door 2, published by the chamber to identify its own member —
 * were staged by g20's round-3 hunt and then failed the human portrait
 * judgment as DISTANCE SHOTS. The image is right, the framing is not.
 *
 * ## What this is NOT
 *
 * It is not a relaxation of the never-wrong-face standard. That standard is
 * about IDENTITY — a wrong face, a group shot where the subject is ambiguous,
 * a generated likeness — and neither of these fails it: both are the chamber's
 * own published portrait of the named member, on the member's own page. What
 * they fail is COMPOSITION, and composition is the thing the author has asked
 * to look at.
 *
 * So both ship, both are flagged in the review list as distance shots so the
 * author knows what he is looking at, and one line pulls either back out.
 *
 * The four-door rule is unmoved: door 2, official government-published
 * portrait, attributed to the publishing body, source URL recorded per row,
 * EXIF stripped, served from our own origin, remove-on-request honoured.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { stripImageMetadata } from "./strip-image-metadata.mts";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "public", "officials");
const MANIFEST = join(ROOT, "lib", "registry", "official-photos.json");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// F01-continued session 2, item 0B: the Phoenix day comes from the one
// module that owns it, exactly as `pnpm stamp` does. This file used to
// carry its own byte-identical copy of the formatter — correct on the day
// it was written, and one more place for the rule to drift.
import { today } from "./doc-dates.mjs";
const TODAY = today();

/** The two, by the id their slot renders under. */
const REINSTATE = [
  {
    officeholderId: "plural:8297edd2-5298-4cef-b2ab-75d4f9fa5a31",
    name: "Brian Taylor",
    page: "https://gc.nh.gov/house/members/member.aspx?pid=11314",
    note: "754×950 — a distance shot; the member is the sole subject and the identity is unambiguous, but the framing is wide.",
  },
  {
    officeholderId: "plural:c62fca24-e8c3-4f87-95dd-cb52a3d58c05",
    name: "Bob Harb",
    page: "https://gc.nh.gov/house/members/member.aspx?pid=9293",
    note: "200×200 — a distance shot at small size; sole subject, unambiguous identity, wide framing.",
  },
];

interface Photo {
  officeholderId: string;
  name: string;
  url: string;
  sourceUrl: string;
  license: string;
  attribution: string | null;
  collectedAt: string;
  /** Present only on a row the author has asked to eyeball (item 7b). */
  review?: string;
}

interface Manifest {
  generatedAt: string;
  photos: Photo[];
  missing: { officeholderId: string; name: string; reason: string; attemptedAt: string }[];
}

/**
 * The House declares its portrait by TEMPLATE CONTROL ID, not by filename —
 * `pageBody_imgMember` — with a filename id that appears nowhere else on the
 * page. Round 3 found that and it is the whole of the extraction.
 */
function portraitUrlFrom(html: string, page: string): string | null {
  const m = /id="pageBody_imgMember"[^>]*\ssrc="([^"]+)"/i.exec(html)
    ?? /\ssrc="([^"]+)"[^>]*id="pageBody_imgMember"/i.exec(html);
  if (!m) return null;
  return new URL(m[1], page).toString();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;

  let shipped = 0;
  const failures: string[] = [];

  for (const person of REINSTATE) {
    if (manifest.photos.some((p) => p.officeholderId === person.officeholderId)) {
      console.log(`  ${person.name}: already shipped, nothing to do`);
      continue;
    }
    const pageRes = await fetch(person.page, { headers: { "user-agent": UA } });
    if (!pageRes.ok) {
      failures.push(`${person.name}: member page HTTP ${pageRes.status}`);
      continue;
    }
    const url = portraitUrlFrom(await pageRes.text(), person.page);
    if (!url) {
      failures.push(`${person.name}: no pageBody_imgMember on the member page`);
      continue;
    }
    const imgRes = await fetch(url, { headers: { "user-agent": UA } });
    if (!imgRes.ok) {
      failures.push(`${person.name}: portrait HTTP ${imgRes.status} at ${url}`);
      continue;
    }
    const raw = Buffer.from(await imgRes.arrayBuffer());
    const { bytes, stripped, removed } = stripImageMetadata(raw);
    if (!stripped) {
      // Unchanged rule: an image whose metadata cannot be stripped is not
      // shipped. A staged portrait is not a shipped one.
      failures.push(`${person.name}: not a recognised JPEG/PNG — metadata cannot be stripped`);
      continue;
    }
    const slug = person.officeholderId.replace(/[^a-zA-Z0-9]/g, "-");
    await writeFile(join(OUT_DIR, `${slug}.jpg`), bytes);

    manifest.photos.push({
      officeholderId: person.officeholderId,
      name: person.name,
      url: `/officials/${slug}.jpg`,
      sourceUrl: url,
      license:
        "Official government-published portrait (door 2) — the New Hampshire House's own portrait of its own member, published to identify them. Remove on request.",
      attribution: "New Hampshire General Court",
      collectedAt: new Date(`${TODAY}T00:00:00Z`).toISOString(),
      review: `DISTANCE SHOT — reinstated ${TODAY} on the author's instruction, flagged for his eye. ${person.note} Member page: ${person.page}. One line pulls it back out.`,
    });
    manifest.missing = manifest.missing.filter(
      (m) => m.officeholderId !== person.officeholderId,
    );
    shipped += 1;
    console.log(
      `  ${person.name}: SHIPPED from ${url}` +
        (removed.length > 0 ? ` (stripped ${removed.join(", ")})` : " (no metadata to strip)"),
    );
  }

  manifest.photos.sort((a, b) => a.officeholderId.localeCompare(b.officeholderId));
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(
    `\nD50 7c — ${TODAY}\n` +
      `  reinstated:  ${shipped} of ${REINSTATE.length}\n` +
      `  manifest:    ${manifest.photos.length} portraits, ${manifest.missing.length} named misses\n` +
      `  flagged for the author's review: ${manifest.photos.filter((p) => p.review).length}`,
  );
  for (const f of failures) console.error(`  FAILED — ${f}`);
  if (shipped === 0 && failures.length > 0) process.exit(1);
}

await main();
