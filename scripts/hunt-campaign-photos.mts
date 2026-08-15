/**
 * Doors 3 and 4: the candidate's own published portrait.
 *
 *   pnpm exec tsx scripts/hunt-campaign-photos.mts <outDir>
 *
 * **The rule this runs under changed on 2026-08-15** (CLAUDE.md, the
 * author's ruling), and this script's previous self-description was written
 * under the old one. It said "a challenger has no official portrait, so the
 * campaign's own photo is the legitimate source WHEN it passes the
 * clean-solo-portrait bar", and the round-4 session correctly refused to ship
 * anything from it: composition was never the only bar, and a campaign
 * website was neither of the two doors that existed then.
 *
 * There are four doors now, and this rung is doors 3 and 4:
 *
 * - **Door 3** — the campaign's OWN self-published portrait from its OWN
 *   site (`og:image` or a site headshot), labelled "campaign-provided",
 *   source recorded, remove-on-request. A campaign publishing its
 *   candidate's face for recognition is distributing it.
 * - **Door 4**, last resort when 1–3 fail for a person — any portrait on the
 *   candidate's own campaign site or on any `.gov` site.
 *
 * **What did NOT change, and this script cannot loosen:** the composition
 * and identity standards. A clean solo portrait or honest initials — never a
 * banner, a logo, a wordmark, a group shot, an event candid where the person
 * is not the unambiguous sole subject, a screengrab, or any doubt about
 * identity. The nine failures round 4 recorded (wordmarks, banners, a rally
 * photo, a man beside a novelty sign) fail under doors 3 and 4 exactly as
 * they failed under 1 and 2. **Nothing ships from this script without the
 * eyeball pass** — it stages candidates for judgment and never decides.
 *
 * Still prohibited at every door: press photos, wire images,
 * photographer-credited images, social-media images. The demand-letter class
 * is not reachable by any door.
 *
 * ## What changed mechanically
 *
 * Round 4 staged only the `og:image` — one image per candidate — and nine of
 * ten were banners, because **an `og:image` is a social-share card and is
 * designed to be a banner**. That is a fact about the format, not about the
 * candidates. This version also collects the page's own `<img>` elements and
 * stages several per person, because the headshot a campaign puts on its
 * About page is usually a clean solo portrait and was never being looked at.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)";
const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: hunt-campaign-photos.mts <outDir>");
  process.exit(1);
}
await mkdir(outDir, { recursive: true });

const cardsFile = JSON.parse(
  await readFile(join(ROOT, "data", "ballot", "candidate-cards-2026.json"), "utf8"),
);
const linksFile = JSON.parse(
  await readFile(join(ROOT, "data", "ballot", "candidate-links-2026.json"), "utf8"),
) as { links: Record<string, { campaign?: { url: string } | null }> };

interface StagedImage {
  imageUrl: string;
  /** `og:image` or `img` — which rung of the page produced it. */
  via: "og:image" | "img";
  file: string;
  bytes: number;
}
interface StageRow {
  key: string;
  campaignUrl: string;
  outcome: "STAGED" | "NO_IMAGE_FOUND" | "FETCH_FAILED";
  detail: string;
  staged: StagedImage[];
  attemptedAt: string;
}
const rows: StageRow[] = [];
const now = new Date().toISOString();

/** Images that are structurally not portraits. Cheap, before any download. */
const NOT_A_PORTRAIT =
  /(logo|wordmark|icon|favicon|sprite|banner|header|footer|bg-|background|donate|paypal|actblue|stripe|badge|arrow|spinner|placeholder|\.svg($|\?))/i;

/** How many images to stage per candidate before the eyeball pass. */
const MAX_PER_CANDIDATE = 6;

const targets = Object.entries(linksFile.links).filter(([key, link]) => {
  if (!link.campaign?.url) return false;
  const card = cardsFile.cards[key];
  return !card?.photoUrl;
});
console.log(
  `${targets.length} photo-less candidates with a recorded campaign site\n`,
);

async function download(
  imageUrl: string,
  key: string,
  via: StagedImage["via"],
  index: number,
): Promise<StagedImage | null> {
  try {
    const img = await fetch(imageUrl, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(20000),
    });
    if (!img.ok) return null;
    const bytes = Buffer.from(await img.arrayBuffer());
    // Under 4 KB is an icon or a tracking pixel, whatever its filename says.
    if (bytes.length < 4096) return null;
    const ext =
      bytes[0] === 0x89 ? "png" : /\.webp(\?|$)/i.test(imageUrl) ? "webp" : "jpg";
    const safe = key.replace(/[^a-zA-Z0-9_-]+/g, "_");
    const file = join(outDir, `${safe}__${index}_${via.replace(":", "")}.${ext}`);
    await writeFile(file, bytes);
    return { imageUrl, via, file, bytes: bytes.length };
  } catch {
    return null;
  }
}

for (const [key, link] of targets) {
  const url = link.campaign!.url;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      rows.push({
        key,
        campaignUrl: url,
        outcome: "FETCH_FAILED",
        detail: `HTTP ${res.status}`,
        staged: [],
        attemptedAt: now,
      });
      console.log(`  FETCH_FAILED   ${key} — ${res.status}`);
      continue;
    }
    const html = await res.text();

    const found: Array<{ src: string; via: StagedImage["via"] }> = [];
    // The og:image first — the image the campaign itself leads with. Kept
    // even though it is usually a banner, because when it IS a portrait it
    // is the campaign's own chosen one.
    const og =
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html) ??
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html);
    if (og) found.push({ src: og[1], via: "og:image" });

    // Then the page's own images — where the About-page headshot lives.
    for (const m of html.matchAll(/<img[^>]+>/gi)) {
      const tag = m[0];
      const src =
        /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1] ??
        /\bdata-src=["']([^"']+)["']/i.exec(tag)?.[1];
      if (!src) continue;
      if (src.startsWith("data:")) continue;
      if (NOT_A_PORTRAIT.test(src)) continue;
      found.push({ src, via: "img" });
    }

    const seen = new Set<string>();
    const staged: StagedImage[] = [];
    for (const f of found) {
      if (staged.length >= MAX_PER_CANDIDATE) break;
      let abs: string;
      try {
        abs = new URL(f.src, url).toString();
      } catch {
        continue;
      }
      if (seen.has(abs)) continue;
      seen.add(abs);
      const got = await download(abs, key, f.via, staged.length + 1);
      if (got) staged.push(got);
    }

    if (staged.length === 0) {
      rows.push({
        key,
        campaignUrl: url,
        outcome: "NO_IMAGE_FOUND",
        detail: `${found.length} image references on the page, none downloadable above the 4 KB icon floor`,
        staged: [],
        attemptedAt: now,
      });
      console.log(`  NO_IMAGE       ${key} — ${found.length} refs, 0 usable`);
      continue;
    }

    rows.push({
      key,
      campaignUrl: url,
      outcome: "STAGED",
      detail: `${staged.length} of ${found.length} image references staged for judgment`,
      staged,
      attemptedAt: now,
    });
    console.log(`  STAGED ${String(staged.length).padStart(2)}    ${key}`);
  } catch (error) {
    rows.push({
      key,
      campaignUrl: url,
      outcome: "FETCH_FAILED",
      detail: String(error),
      staged: [],
      attemptedAt: now,
    });
    console.log(`  FETCH_FAILED   ${key} — ${error}`);
  }
}

await writeFile(join(outDir, "results.json"), JSON.stringify(rows, null, 2) + "\n");
const stagedCount = rows.reduce((n, r) => n + r.staged.length, 0);
console.log(
  `\n${stagedCount} images staged for ${rows.filter((r) => r.outcome === "STAGED").length} of ${targets.length} candidates → ${outDir}` +
    `\nNOTHING SHIPS FROM HERE without the eyeball pass: composition and identity` +
    `\nstandards do not move at any door.`,
);
