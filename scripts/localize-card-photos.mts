/**
 * Localize externally-hosted candidate card photos (photo session,
 * 2026-08-14): the session rule is download-at-build, serve from our
 * origin, strip metadata — a hotlink makes the reader's browser announce
 * itself to a campaign's CDN. Each external photoUrl is fetched once,
 * stripped, committed under public/candidates/, and the card repointed.
 * A fetch that fails leaves the hotlink in place and records the attempt —
 * a worse state than committed, but an honest one.
 *
 * `pnpm exec tsx scripts/localize-card-photos.mts`
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { stripImageMetadata } from "./strip-image-metadata.mts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "data", "ballot", "candidate-cards-2026.json");
const TODAY = "2026-08-14";

const cardsFile = JSON.parse(await readFile(FILE, "utf8"));
await mkdir(join(ROOT, "public", "candidates"), { recursive: true });

let moved = 0;
let failed = 0;
for (const [key, card] of Object.entries(cardsFile.cards) as [
  string,
  { photoUrl: string | null; photoSource: string | null },
][]) {
  if (!card.photoUrl || !/^https?:\/\//.test(card.photoUrl)) continue;
  const response = await fetch(card.photoUrl, {
    headers: { "user-agent": "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)" },
  });
  if (!response.ok) {
    console.log(`  FAIL ${key} — HTTP ${response.status}, hotlink left in place`);
    const hunt = cardsFile.hunts.find((h: { key: string }) => h.key === key);
    const note = `LOCALIZE ATTEMPT ${TODAY}: fetching the shipped photo for a committed copy returned HTTP ${response.status}; the recorded hotlink stays until a copy can be fetched.`;
    if (hunt) hunt.note = `${hunt.note} ${note}`;
    else cardsFile.hunts.push({ key, name: key, note, attemptedAt: TODAY });
    failed++;
    continue;
  }
  const raw = Buffer.from(await response.arrayBuffer());
  const { bytes, stripped } = stripImageMetadata(raw);
  if (!stripped) {
    console.log(`  FAIL ${key} — unrecognized image format, hotlink left in place`);
    failed++;
    continue;
  }
  const ext = raw[0] === 0x89 ? "png" : "jpg";
  const slug = key.replace(/^ballot-/, "").replace(/[^a-zA-Z0-9-]+/g, "-");
  const rel = `candidates/${slug}.${ext}`;
  await writeFile(join(ROOT, "public", rel), bytes);
  card.photoSource = `${card.photoSource} — committed copy of ${card.photoUrl} served from our origin (fetched ${TODAY}, metadata stripped)`;
  card.photoUrl = `/${rel}`;
  console.log(`  OK   ${key} → /${rel} (${Math.round(bytes.length / 1024)} KB)`);
  moved++;
}

await writeFile(FILE, JSON.stringify(cardsFile, null, 2) + "\n");
console.log(`${moved} photos localized, ${failed} left hotlinked (recorded)`);
