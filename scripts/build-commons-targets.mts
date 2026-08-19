/**
 * Build the Commons-hunt target list (photo session Tier 3): every rendered
 * person still without a portrait who is in the session's Commons scope —
 * ballot candidates, curated local roster members, the ten federal members
 * the pictorial directory lacks (bioguide join), and the three governors.
 *
 * State legislators are deliberately ABSENT: the brief's Tier 2 sources
 * them from their chamber's own site or not at all this session.
 *
 * `pnpm exec tsx scripts/build-commons-targets.mts <out.json>`
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { BALLOT_FILES, NAME_BY_USPS } from "../lib/coverage/artifacts.ts";
import { BODY_ROSTERS } from "../lib/registry/body-rosters.ts";
import { STATEWIDE_EXECUTIVES } from "../lib/officials/statewide-executives.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

/** USPS → the state name, from the coverage manifest (AUD-06, g18). */
const STATE_PLACE: Record<string, string> = NAME_BY_USPS;

interface Target {
  key: string;
  name: string;
  bioguide?: string;
  officePattern: string;
  placePattern: string;
}
const targets: Target[] = [];

/** Contest id → what the office evidence must look like. */
function officeFor(contestId: string): string | null {
  const c = contestId.toLowerCase();
  if (c.includes("governor")) return "governor";
  if (c.includes("us-senate")) return "senator|congress";
  if (c.includes("us-house")) return "representative|congress";
  if (c.includes("state-house") || c.includes("state-senate"))
    return "legislat|representative|senator|general court";
  if (c.includes("executive-council")) return "executive council";
  if (c.includes("county-commissioner")) return "commissioner|freeholder";
  if (c.includes("county-attorney") || c.includes("attorney"))
    return "attorney";
  if (c.includes("sheriff")) return "sheriff";
  if (c.includes("treasurer")) return "treasurer";
  if (c.includes("secretary")) return "secretary of state";
  if (c.includes("mine-inspector")) return "mine inspector";
  if (c.includes("superintendent")) return "superintendent|education";
  if (c.includes("corporation-commission")) return "corporation commission";
  if (c.includes("supreme-court") || c.includes("judge") || c.includes("justice"))
    return "judge|justice|court";
  if (c.includes("school")) return "school board|education";
  // Unmapped contest: still hunt, with a generic politician bar.
  return "politician|elected";
}

// ── Ballot candidates (cards + lineup), skipping anyone with a photo ────
const cardsFile = read("data/ballot/candidate-cards-2026.json") as {
  cards: Record<string, { photoUrl: string | null }>;
};
const hasPhoto = (key: string) => Boolean(cardsFile.cards[key]?.photoUrl);

for (const { file, state } of BALLOT_FILES) {
  const data = read(`data/ballot/${file}`) as {
    candidacies: { id: string; contestId?: string; familyName: string; givenName: string }[];
  };
  for (const cand of data.candidacies) {
    if (hasPhoto(cand.id)) continue;
    // NJ files carry SHOUTING family names; normalize for the search box
    // only — our key stays exactly the candidacy id.
    const family = cand.familyName === cand.familyName.toUpperCase()
      ? cand.familyName.charAt(0) + cand.familyName.slice(1).toLowerCase()
      : cand.familyName;
    targets.push({
      key: cand.id,
      name: `${cand.givenName} ${family}`.trim(),
      officePattern: officeFor(cand.id) ?? "politician",
      placePattern: STATE_PLACE[state],
    });
  }
}

const lineup = read("data/ballot/az-general-lineup-2026.json") as {
  contests: { contestId: string; nominees: { name: string }[] }[];
};
const alreadyNamed = new Set(targets.map((t) => t.name));
for (const contest of lineup.contests) {
  for (const nominee of contest.nominees) {
    const key = `${contest.contestId}|${nominee.name}`;
    if (hasPhoto(key) || alreadyNamed.has(nominee.name)) continue;
    targets.push({
      key,
      name: nominee.name,
      officePattern: officeFor(contest.contestId) ?? "politician",
      placePattern: STATE_PLACE.AZ,
    });
  }
}

// ── Curated local roster members ────────────────────────────────────────
function placeOfBody(bodyId: string, bodyName: string): string {
  const m = /(?:place|county|school_district):([a-z_]+)/.exec(bodyId);
  const fromId = m
    ? m[1].split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")
    : null;
  const state = STATE_PLACE[(/state:(\w\w)/.exec(bodyId)?.[1] ?? "").toUpperCase()];
  return [fromId, bodyName.split(/ (Board|Council|Commission|Committee)/)[0], state]
    .filter(Boolean)
    .join("|");
}
for (const roster of BODY_ROSTERS) {
  for (const member of roster.members) {
    targets.push({
      key: member.id,
      name: member.name,
      officePattern:
        "mayor|supervisor|council|commissioner|board|trustee|selectman|freeholder|school|superintendent|politician",
      placePattern: placeOfBody(roster.bodyId, roster.bodyName),
    });
  }
}

// ── Federal members the pictorial directory lacks — bioguide join ───────
const manifest = read("lib/registry/official-photos.json") as {
  missing: { officeholderId: string; name: string }[];
};
for (const miss of manifest.missing) {
  if (!miss.officeholderId.startsWith("congress:")) continue;
  targets.push({
    key: miss.officeholderId,
    name: miss.name,
    bioguide: miss.officeholderId.slice("congress:".length),
    officePattern: "congress",
    placePattern: ".",
  });
}

// ── The governors ───────────────────────────────────────────────────────
for (const executive of STATEWIDE_EXECUTIVES) {
  if (executive.holder.photoUrl) continue;
  const state = STATE_PLACE[
    (/state:(\w\w)/.exec(executive.stateOcdId)?.[1] ?? "").toUpperCase()
  ];
  targets.push({
    key: executive.holder.id,
    name: executive.holder.name,
    officePattern: "governor",
    placePattern: state,
  });
}

const out = process.argv[2];
if (!out) {
  console.error("usage: build-commons-targets.mts <out.json>");
  process.exit(1);
}
writeFileSync(out, JSON.stringify(targets, null, 2) + "\n");
const groups = {
  ballot: targets.filter((t) => t.key.startsWith("ballot-")).length,
  locals: targets.filter((t) => t.key.startsWith("roster:")).length,
  federal: targets.filter((t) => t.bioguide).length,
  governors: targets.filter((t) => t.key.startsWith("statewide:")).length,
};
console.log(`${targets.length} targets → ${out}`, groups);
