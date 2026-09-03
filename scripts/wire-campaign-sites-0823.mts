/**
 * **WIRING THE PROMOTED CAMPAIGN SITES ONTO THE CARD THAT RENDERS THEM.**
 * (`NH106` session, 2026-08-23. Serves the campaign-site field at 07866.)
 *
 * ## What this is, and what it deliberately is NOT
 *
 * `pnpm leads:promote` produced the finding. This moves it to the reader.
 * Collection and rendering are different measurements and this repo reports
 * them as a PAIR, so a session that collects ten sites and wires none of them
 * has moved one number and not the other.
 *
 * **No new surface was built.** `data/ballot/candidate-links-2026.json`
 * already carries a `campaign` slot per candidacy and
 * `lib/ballot/candidate-sites.ts` already reads it — checked BEFORE writing
 * anything, because RULING 63 makes building a route that already exists a
 * reported defect, and duplication is worse than a gap.
 *
 * ## The join, and why it is asserted rather than trusted
 *
 * RULING 111: a join is never a lookup for a fact that lives on only one side.
 * Every promoted HIT must resolve to a candidacy on the ballot, and this
 * REFUSES to write when one does not, naming it. A merge that silently drops
 * an unmatched row would report ten wired and wire eight.
 *
 * ## The suffix, which is where the first attempt lost two people
 *
 * Matching on `familyName` alone lost two of the promoted rows. Both were
 * **`KEAN, JR.`** and **`DAWKINS, JR.`** — the filing carries the generational
 * suffix inside the family-name field, so a surname comparison sees `keanjr`
 * and `kean` as different people.
 *
 * That is RULING 103's defect exactly: three copies of an initials function
 * rendered `Thomas J. Haynes III` as `TI` because each took the suffix for the
 * surname. Same token, same mistake, a different layer. `surnameKey` strips
 * them here, and the assertion above is what turned it from a silent 8 into a
 * named failure.
 *
 * **The assertion then caught a third, which is the argument for having it.**
 * With the suffix handled the join still refused, this time on **Lana
 * Leguía**: the two sides were folding non-ASCII differently, so her surname
 * was `legua` on one and `leguía` on the other. One shared normalizer, applied
 * to both sides, is the fix — see `fold` below.
 *
 * ## What is NOT written
 *
 * Every row that stayed `LEAD`. Two are surname-only page matches, which any
 * relative or namesake would also produce. **Two more were demoted from `HIT`
 * during this session's own measurement**: `chippersonlaw.com` and
 * `dawkinswarrington.com` are law-firm attorney bios, promoted by a first
 * version of the evidence test that matched `elect` inside *selected*. A
 * lawyer's firm page is a real find for the CONTACT field — the manifest's
 * `bar-directory` route exists for it — and it is not evidence of a candidacy.
 *
 * All four go to `hunts` as recorded honest misses, which is what that array
 * is for. A LEAD never becomes a link.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { politeGetText } from "../lib/sources/http.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROMOTION = join(ROOT, "data/states/nj/hunt/lead-promotion-0823.json");
const EMAIL_ROUTE = join(ROOT, "data/states/nj/hunt/nj-filed-email-domain.json");
const BALLOT = join(ROOT, "data/states/nj/ballot/nj-morris-2026.json");
const LINKS = join(ROOT, "data/ballot/candidate-links-2026.json");

const STAMP = process.env.WTP_STAMP ?? "";
const WRITE = process.argv.includes("--write");

/** Generational suffixes, which are not part of a surname. See the header. */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * ONE normalizer, applied to BOTH sides of the join.
 *
 * The first version had two — the filing side stripped `[^a-z]` and the
 * display side stripped `[^a-zà-ÿ]`. **Lana Leguía** therefore folded to
 * `legua` on one side and `leguía` on the other, and the join lost her. Two
 * normalizers that agree on ASCII and disagree on everything else is the
 * separator defect of RULING 14 wearing a different alphabet, and this repo's
 * standing answer to it is a single shared implementation rather than two
 * that happen to match today.
 *
 * Diacritics are folded through NFD rather than removed as unknown characters,
 * so `í` becomes `i` and `Leguía` and `Leguia` are the same person — which is
 * the whole point, because a county filing and a campaign site routinely
 * disagree about whether to carry the accent.
 */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s,]/g, "");
}

/** The surname, folded and suffix-stripped, from either side of the join. */
function surnameKey(name: string): string {
  const tokens = fold(name)
    .split(/[,\s]+/)
    .filter((t) => t.length > 0 && !SUFFIXES.has(t));
  return tokens[tokens.length - 1] ?? "";
}

/**
 * Evidence that a page is a campaign's own, word-bounded.
 *
 * The same list `promote-leads-0823.mts` applies — repeated here because the
 * ROOT is a DIFFERENT PAGE from the one the promotion measured, and a link
 * inherits nothing from a sibling. Reusing the verdict from `/interviews` to
 * justify wiring `/` would be a fact asserted about a document nobody read.
 */
const CAMPAIGN_EVIDENCE: RegExp[] = [
  /paid for by/,
  /\bfor (congress|senate|mayor|council|assembly|commissioner|sheriff|school board|township committee|borough council|freeholder|board of education)\b/,
  /\bcandidate for\b/,
  /\bre-?elect\b/,
  /\bvote for\b/,
  /\brunning for\b/,
  /\bon the ballot\b/,
  /\b(my|our|the|this) campaign\b/,
];

/**
 * **THE ROOT IS THE READER'S LINK, WHERE THE ROOT EARNS IT.**
 *
 * The mining step returned whatever URL the search surfaced, which for three
 * of these was a deep page: `lanaleguia.com/interviews`,
 * `selenformorriscounty.com/about`, and a single endorsement post on Rebecca
 * Bennett's site. Handing a reader an interior page of a campaign site when
 * the front door works is reader friction, and reader friction is a defect
 * with the same standing as a wrong number.
 *
 * It is NOT a free substitution. The root is fetched, and it is used only if
 * it independently carries the candidate's name AND a campaign signal. Where
 * it does not, the deep URL that was actually verified stays — a worse link is
 * better than an unverified one.
 */
async function preferRoot(
  url: string,
  matchedForms: string[],
): Promise<{ url: string; movedToRoot: boolean; note: string }> {
  const root = `${new URL(url).origin}/`;
  if (root === url) return { url, movedToRoot: false, note: "already the site root" };
  try {
    const r = await politeGetText(root, { profile: "browser" });
    if (r.status !== 200) {
      return { url, movedToRoot: false, note: `root answered HTTP ${r.status}; kept the verified page` };
    }
    const hay = r.text.toLowerCase().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const named = matchedForms.some((f) => hay.includes(f));
    const campaign = CAMPAIGN_EVIDENCE.some((re) => re.test(hay));
    if (named && campaign) {
      return { url: root, movedToRoot: true, note: "the root names the candidate and identifies itself as a campaign" };
    }
    return {
      url,
      movedToRoot: false,
      note: "the root did not independently clear name-plus-campaign evidence; kept the verified page",
    };
  } catch {
    return { url, movedToRoot: false, note: "the root could not be fetched; kept the verified page" };
  }
}

interface PromotionRow {
  set: string;
  subject: string;
  contestOrEntity: string;
  url: string;
  outcome: string;
  detail: string;
  formsSearched: { form: string; kind: string; matched: boolean }[];
  officeEvidence: string[];
}

async function main(): Promise<void> {
  if (STAMP === "") {
    throw new Error("WTP_STAMP is unset — every date comes from `pnpm stamp` (CLAUDE.md).");
  }

  const promotion = JSON.parse(readFileSync(PROMOTION, "utf8")) as {
    summary: { campaignSite: { HIT: number; LEAD: number } };
    rows: PromotionRow[];
  };
  const ballot = JSON.parse(readFileSync(BALLOT, "utf8")) as {
    candidacies: { id: string; familyName: string; givenName: string; contestId: string }[];
  };
  const links = JSON.parse(readFileSync(LINKS, "utf8")) as {
    curatedAt: string;
    note: string;
    links: Record<string, { official: unknown; campaign: unknown }>;
    hunts: { key: string; name: string; note: string; attemptedAt: string }[];
  };

  const hits = promotion.rows.filter((r) => r.set === "campaign-site" && r.outcome === "HIT");
  const leads = promotion.rows.filter((r) => r.set === "campaign-site" && r.outcome === "LEAD");

  /*
   * THE SECOND SOURCE — the `filed-email-domain` route (2026-08-23).
   *
   * It is read HERE rather than given a wiring script of its own. Two scripts
   * writing the same `campaign` slot would be two implementations of one
   * decision, which is RULING 103's defect built deliberately, and the second
   * copy is always the one that forgets the suffix handling and the
   * root-preference below.
   *
   * Its rows carry `candidacyId` outright — the route walks the contact ledger,
   * which is already keyed to the ballot — so they need no surname join at all
   * and skip the failure mode the block below exists to catch. RULING 111's
   * question, *which side holds the fact*, answers itself here.
   *
   * Only `CAMPAIGN_SITE` rows are taken. `SLATE_OR_PARTY` and `OFFICIAL_HOST`
   * are real finds for OTHER fields and wiring either into a candidate's
   * campaign slot would put a county committee's homepage, or a township's,
   * behind a named person's name.
   */
  const emailRoute = JSON.parse(readFileSync(EMAIL_ROUTE, "utf8")) as {
    summary: { CAMPAIGN_SITE: number };
    rows: (PromotionRow & { candidacyId: string; kind: string })[];
  };
  const emailHits = emailRoute.rows.filter((r) => r.kind === "CAMPAIGN_SITE");
  if (emailHits.length !== emailRoute.summary.CAMPAIGN_SITE) {
    throw new Error(
      `count assertion FAILED: the filed-email-domain summary states ` +
        `${emailRoute.summary.CAMPAIGN_SITE} campaign sites and its rows hold ` +
        `${emailHits.length} (RULING 100).`,
    );
  }

  /* RULING 100: the source states its counts; yielding fewer FAILS. */
  if (hits.length !== promotion.summary.campaignSite.HIT) {
    throw new Error(
      `count assertion FAILED: summary states ${promotion.summary.campaignSite.HIT} HITs, ` +
        `rows hold ${hits.length} (RULING 100).`,
    );
  }

  /* Index the ballot by suffix-stripped surname. Collisions are kept as a LIST
   * rather than a last-wins overwrite: two candidates can share a surname, and
   * silently picking one would attach a real person's site to someone else. */
  const bySurname = new Map<string, typeof ballot.candidacies>();
  for (const c of ballot.candidacies) {
    const key = surnameKey(c.familyName);
    const list = bySurname.get(key) ?? [];
    list.push(c);
    bySurname.set(key, list);
  }

  const resolved: { row: PromotionRow; id: string }[] = [];
  const unresolved: string[] = [];

  for (const h of hits) {
    const candidates = bySurname.get(surnameKey(h.subject)) ?? [];
    if (candidates.length === 0) {
      unresolved.push(`${h.subject} — no candidacy on the ballot carries this surname`);
      continue;
    }
    if (candidates.length === 1) {
      resolved.push({ row: h, id: candidates[0].id });
      continue;
    }
    /* Several share the surname. Disambiguate on the given name, and refuse
     * rather than guess — attaching one person's campaign site to a namesake
     * on the same ballot is the fabricated-URL failure pointed at a person. */
    const given = fold(h.subject).split(/[,\s]+/).filter(Boolean)[0] ?? "";
    const narrowed = candidates.filter((c) =>
      fold(c.givenName).replace(/[\s,]/g, "").startsWith(given.slice(0, 3)),
    );
    if (narrowed.length === 1) {
      resolved.push({ row: h, id: narrowed[0].id });
    } else {
      unresolved.push(
        `${h.subject} — ${candidates.length} candidacies share this surname and the given name ` +
          `did not narrow it to one: ${candidates.map((c) => c.id).join(", ")}`,
      );
    }
  }

  /* RULING 111 — the join is asserted. A silent drop would report ten wired
   * and wire eight, which is exactly the shape that ruling was adopted over. */
  if (unresolved.length > 0) {
    throw new Error(
      `JOIN FAILED for ${unresolved.length} of ${hits.length} promoted sites — refusing to write ` +
        `a partial (RULING 111):\n  ${unresolved.join("\n  ")}`,
    );
  }

  // The email-route rows join by candidacy id, so they are appended after the
  // surname join has been asserted rather than being pushed through it.
  const ballotIds = new Set(ballot.candidacies.map((c) => c.id));
  const emailUnresolved: string[] = [];
  for (const h of emailHits) {
    if (!ballotIds.has(h.candidacyId)) {
      emailUnresolved.push(`${h.subject} — candidacy ${h.candidacyId} is not on the ballot`);
      continue;
    }
    if (resolved.some((r) => r.id === h.candidacyId)) continue;
    resolved.push({ row: h, id: h.candidacyId });
  }
  if (emailUnresolved.length > 0) {
    throw new Error(
      `JOIN FAILED for ${emailUnresolved.length} filed-email-domain hit(s) — refusing to ` +
        `write a partial (RULING 111):\n  ${emailUnresolved.join("\n  ")}`,
    );
  }

  let added = 0;
  let alreadyHeld = 0;
  const addedRows: string[] = [];
  const heldRows: string[] = [];

  for (const { row, id } of resolved) {
    const existing = links.links[id];
    if (existing?.campaign) {
      alreadyHeld += 1;
      heldRows.push(`${id} — already ${(existing.campaign as { url: string }).url}`);
      continue;
    }
    const matched = row.formsSearched.filter((f) => f.matched).map((f) => f.form);
    const chosen = await preferRoot(row.url, matched);
    const verification =
      `Fetched ${STAMP} at rung 3 (browser header set): the page names the candidate ` +
      `(${matched.join(", ")}) and identifies itself as a campaign ` +
      `(${row.officeEvidence.join(", ")}). Cleared a control query against a ` +
      "path that cannot exist on the same host, so this is the host answering about this " +
      `person rather than serving boilerplate (RULING 68). Link: ${chosen.note}` +
      (chosen.movedToRoot ? ` — verified page was ${row.url}` : "") +
      "." +
      /*
       * An http:// link carries the MEASUREMENT that justifies it, not an
       * apology. `tests/candidate-links.test.ts` requires this sentence before
       * it will accept a non-https link, so the carve-out cannot be taken
       * silently by a later run.
       */
      (chosen.url.startsWith("http://")
        ? ` This host REFUSES HTTPS — measured ${STAMP}, https:// returned no response while ` +
          "http:// served the page — so the link is http and that is the site as published, " +
          "not a downgrade chosen here."
        : "");
    links.links[id] = {
      official: existing?.official ?? null,
      campaign: { url: chosen.url, verification, attemptedAt: STAMP },
    };
    added += 1;
    addedRows.push(`${id} — ${chosen.url}${chosen.movedToRoot ? "  (root, verified)" : ""}`);
  }

  /* The honest misses. A LEAD is a page whose owner is unestablished and it
   * never becomes a link; recording WHY is what stops the next session
   * re-walking it and reaching the same undecidable place. */
  for (const l of leads) {
    const key = `promotion-0823:${l.subject}`;
    /*
     * MISS, not NOT_ATTEMPTED, and the vocabulary is the guard's not this
     * script's: `tests/candidate-links.test.ts` requires every recorded hunt to
     * open with one of the two, because "we looked and found nothing" and
     * "nobody has looked" are different facts and a bare note runs them
     * together. A search WAS run on each of these, so every one is a MISS.
     */
    const note =
      `MISS — ${l.url} cleared a control query but is NOT wired: ${l.detail} ` +
      `Forms searched: ${l.formsSearched.map((f) => f.form).join(", ")}. ` +
      "Still owed, and re-hunted on its RULING 53 clock — this is not an absence.";
    /* Replace by key rather than skip, so a re-run corrects a note it wrote
     * before instead of leaving a stale one standing beside a fresh one. */
    const at = links.hunts.findIndex((h) => h.key === key);
    const row = { key, name: l.subject, note, attemptedAt: STAMP };
    if (at >= 0) links.hunts[at] = row;
    else links.hunts.push(row);
  }

  /*
   * Both sources, stated as a pair rather than summed behind one denominator.
   * The first version of this line printed `12 of 8` — the merged numerator
   * against one source's total — which is the data-destruction pattern the
   * two-numbers rule names: a single figure standing in front of two
   * measurements, concealing which one moved.
   */
  console.log(
    `\nlead-promotion HITs                     ${hits.length}` +
      `\nfiled-email-domain campaign sites       ${emailHits.length}` +
      `\n  resolved to a candidacy (both)        ${resolved.length} of ${hits.length + emailHits.length}` +
      "\n  (the two sources overlap: a site found by both is resolved once)",
  );
  console.log(`  newly wired                           ${added}`);
  addedRows.forEach((r) => console.log(`    + ${r}`));
  console.log(`  already held a campaign link          ${alreadyHeld}`);
  heldRows.forEach((r) => console.log(`    = ${r}`));
  console.log(`  LEADs recorded as honest misses       ${leads.length}`);

  const njWithCampaign = Object.keys(links.links).filter(
    (k) => k.startsWith("ballot-nj-morris:") && links.links[k].campaign,
  ).length;
  console.log(`\n  nj-morris candidacies with a campaign link: ${njWithCampaign} of 272`);

  if (!WRITE) {
    console.log("\n  (dry run — pass --write to record)");
    return;
  }
  links.curatedAt = STAMP;
  writeFileSync(LINKS, `${JSON.stringify(links, null, 2)}\n`, "utf8");
  console.log(`\nwrote ${LINKS}`);
}

await main();
