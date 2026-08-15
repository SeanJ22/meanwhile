/**
 * The campaign-site rung (photo session Tier 3, rung 2): for ballot
 * candidates still without a portrait whose verified campaign site is
 * recorded in candidate-links-2026.json, fetch the site and stage its
 * og:image for human judgment. A challenger has no official portrait, so
 * the campaign's own photo is the legitimate source WHEN it passes the
 * clean-solo-portrait bar — the Hobbs wordmark and the Sununu couple
 * photo are the canonical failures this rung must never repeat, which is
 * why nothing ships from this script without the eyeball pass.
 *
 * `pnpm exec tsx scripts/hunt-campaign-photos.mts <outDir>`
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

interface StageRow {
  key: string;
  campaignUrl: string;
  outcome: "STAGED" | "NO_IMAGE_FOUND" | "FETCH_FAILED";
  detail: string;
  imageUrl?: string;
  stagedFile?: string;
  attemptedAt: string;
}
const rows: StageRow[] = [];
const now = new Date().toISOString();

const targets = Object.entries(linksFile.links).filter(([key, link]) => {
  if (!link.campaign?.url) return false;
  const card = cardsFile.cards[key];
  return !card?.photoUrl;
});
console.log(`${targets.length} photo-less candidates with a recorded campaign site`);

for (const [key, link] of targets) {
  const url = link.campaign!.url;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      rows.push({ key, campaignUrl: url, outcome: "FETCH_FAILED", detail: `HTTP ${res.status}`, attemptedAt: now });
      console.log(`  FETCH_FAILED   ${key} — ${res.status}`);
      continue;
    }
    const html = await res.text();
    // og:image first — the image the campaign itself leads with.
    const og =
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html) ??
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html);
    if (!og) {
      rows.push({ key, campaignUrl: url, outcome: "NO_IMAGE_FOUND", detail: "no og:image on the campaign homepage", attemptedAt: now });
      console.log(`  NO_IMAGE       ${key}`);
      continue;
    }
    const imageUrl = new URL(og[1], url).toString();
    const img = await fetch(imageUrl, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(20000),
    });
    if (!img.ok) {
      rows.push({ key, campaignUrl: url, outcome: "FETCH_FAILED", detail: `og:image HTTP ${img.status} at ${imageUrl}`, attemptedAt: now });
      console.log(`  IMG_FAILED     ${key} — ${img.status}`);
      continue;
    }
    const bytes = Buffer.from(await img.arrayBuffer());
    const ext = bytes[0] === 0x89 ? "png" : /\.webp(\?|$)/i.test(imageUrl) ? "webp" : "jpg";
    const safe = key.replace(/[^a-zA-Z0-9_-]+/g, "_");
    const stagedFile = join(outDir, `${safe}.${ext}`);
    await writeFile(stagedFile, bytes);
    rows.push({ key, campaignUrl: url, outcome: "STAGED", detail: `og:image ${Math.round(bytes.length / 1024)} KB`, imageUrl, stagedFile, attemptedAt: now });
    console.log(`  STAGED         ${key} — ${imageUrl}`);
  } catch (error) {
    rows.push({ key, campaignUrl: url, outcome: "FETCH_FAILED", detail: String(error), attemptedAt: now });
    console.log(`  FETCH_FAILED   ${key} — ${error}`);
  }
}

await writeFile(join(outDir, "results.json"), JSON.stringify(rows, null, 2) + "\n");
console.log(`${rows.filter((r) => r.outcome === "STAGED").length} staged → ${outDir}`);
