/**
 * `NH26`/`NH30`/`NH65`/`NH78`/`NH111`, 2026-08-24 — enumerate exactly which
 * staged portraits are awaiting a decision, computed from the render path
 * rather than read off a tracker row's prose.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { officialPhotoForPerson } from "../lib/photos/person.ts";
import { reviewFor } from "../lib/photos/review.ts";

const ROOT = process.cwd();
const cards = JSON.parse(
  readFileSync(join(ROOT, "data", "ballot", "candidate-cards-2026.json"), "utf8"),
) as { cards: Record<string, { photoUrl: string | null }> };

const personKey = (name: string): string =>
  name.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(JR|SR|II|III|IV)\b\.?/g, "").replace(/[^A-Z ]/g, "")
    .replace(/\s+/g, " ").trim();

const byState: Record<string, { key: string; name: string; url: string }[]> = {};
for (const [key, card] of Object.entries(cards.cards)) {
  const tail = key.split(":").pop() ?? "";
  const name = (key.includes("|") ? key.split("|").pop() : tail.split("-").reverse().join(" ")) ?? "";
  const official = officialPhotoForPerson(name);
  const url = official?.url ?? card.photoUrl;
  if (!url) continue;
  const state = reviewFor(personKey(name), url).state;
  (byState[state] ??= []).push({ key, name, url });
}
for (const [state, list] of Object.entries(byState)) {
  console.log(`\n${state}: ${list.length}`);
  if (state !== "APPROVED") for (const r of list) console.log(`   ${r.name.padEnd(28)} ${r.url}`);
}
