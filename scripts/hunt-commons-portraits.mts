/**
 * The Commons rung (photo session Tier 3, rung 3): for each hunted person,
 * find their Wikidata item, verify identity by ATTRIBUTES (never by name
 * alone), and if the item carries a P18 portrait whose Commons license is
 * machine-checkably free, stage the image for human judgment.
 *
 * `pnpm exec tsx scripts/hunt-commons-portraits.mts <targets.json> <outDir>`
 *
 * Identity discipline:
 * - A person with a bioguide id matches ONLY via Wikidata P1157 — a stable
 *   id join, the strongest available.
 * - Everyone else must pass attribute verification: a P39 (position held)
 *   label or the item description must match BOTH the office context and
 *   the place context supplied for that person. Zero passing hits is a
 *   miss; two or more is AMBIGUOUS and also a miss — never guessed past.
 *
 * License discipline: Commons extmetadata must state a free license (public
 * domain / CC0 / CC BY / CC BY-SA — never NC or ND). License, artist, and
 * the Commons file page are recorded per staged image.
 *
 * NOTHING SHIPS FROM THIS SCRIPT. It writes staged images + a results file;
 * a human judges every staged image (clean solo portrait or it does not
 * ship) before a separate step commits winners.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

interface Target {
  /** Our stable key for the person (card key, roster id, officeholder id). */
  key: string;
  name: string;
  /** Known bioguide id → P1157 join. */
  bioguide?: string;
  /** Regex (case-insensitive) the office evidence must match. */
  officePattern: string;
  /** Regex (case-insensitive) the place evidence must match. */
  placePattern: string;
}

interface ResultRow {
  key: string;
  name: string;
  outcome:
    | "STAGED"
    | "NO_WIKIDATA_MATCH"
    | "AMBIGUOUS"
    | "NO_P18"
    | "LICENSE_NOT_FREE"
    | "DOWNLOAD_FAILED";
  detail: string;
  attemptedAt: string;
  wikidataId?: string;
  commonsFile?: string;
  commonsFilePage?: string;
  license?: string;
  artist?: string;
  stagedFile?: string;
}

const [targetsPath, outDir] = process.argv.slice(2);
if (!targetsPath || !outDir) {
  console.error("usage: hunt-commons-portraits.mts <targets.json> <outDir>");
  process.exit(1);
}
await mkdir(outDir, { recursive: true });

// BOM-tolerant: PowerShell's utf8 Out-File prepends one.
const targets = JSON.parse(
  (await readFile(targetsPath, "utf8")).replace(/^﻿/, ""),
) as Target[];
const UA = "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)";
const now = new Date().toISOString();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(base: string, params: Record<string, string>) {
  const url = `${base}?${new URLSearchParams({ format: "json", ...params })}`;
  // Politeness: spaced requests, and 429s honored via Retry-After — the
  // public-records fetch discipline (never at a rate that degrades service).
  await sleep(400);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (res.status === 429 && attempt < 3) {
      const retryAfter = Number(res.headers.get("retry-after")) || 15;
      console.log(`    429 — waiting ${retryAfter}s`);
      await sleep(retryAfter * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return res.json();
  }
}
const wikidata = (p: Record<string, string>) =>
  api("https://www.wikidata.org/w/api.php", p);
const commons = (p: Record<string, string>) =>
  api("https://commons.wikimedia.org/w/api.php", p);

/** English P39 labels + description + P1157 + P18 for a set of items. */
async function entities(ids: string[]) {
  if (ids.length === 0) return {};
  const data = await wikidata({
    action: "wbgetentities",
    ids: ids.join("|"),
    props: "claims|descriptions|labels",
    languages: "en",
  });
  return data.entities ?? {};
}

function claimValues(entity: any, prop: string): any[] {
  return (entity?.claims?.[prop] ?? [])
    .map((c: any) => c.mainsnak?.datavalue?.value)
    .filter((v: any) => v !== undefined);
}

const FREE_LICENSE =
  /public domain|\bpd\b|cc0|cc[ -]by(?![ -]?(nc|nd))(-sa)?/i;

const results: ResultRow[] = [];

for (const target of targets) {
  const record = (row: Omit<ResultRow, "key" | "name" | "attemptedAt">) => {
    results.push({ key: target.key, name: target.name, attemptedAt: now, ...row });
    console.log(`  ${row.outcome.padEnd(18)} ${target.name} ${row.detail ? "— " + row.detail : ""}`);
  };

  try {
    // ── Find candidate items ──────────────────────────────────────────
    let matchedId: string | null = null;
    let matchBasis = "";

    if (target.bioguide) {
      const search = await wikidata({
        action: "query",
        list: "search",
        srsearch: `haswbstatement:"P1157=${target.bioguide}"`,
        srlimit: "2",
      });
      const hits = search.query?.search ?? [];
      if (hits.length === 1) {
        matchedId = hits[0].title;
        matchBasis = `P1157=${target.bioguide} (stable-id join)`;
      } else {
        record({
          outcome: "NO_WIKIDATA_MATCH",
          detail: `P1157=${target.bioguide} returned ${hits.length} items`,
        });
        continue;
      }
    } else {
      const search = await wikidata({
        action: "wbsearchentities",
        search: target.name,
        language: "en",
        type: "item",
        limit: "5",
      });
      const hitIds: string[] = (search.search ?? []).map((h: any) => h.id);
      if (hitIds.length === 0) {
        record({ outcome: "NO_WIKIDATA_MATCH", detail: "no search hits" });
        continue;
      }
      const ents = await entities(hitIds);
      // Resolve every P39 position label in one batch.
      const positionIds = new Set<string>();
      for (const id of hitIds) {
        for (const v of claimValues(ents[id], "P39")) {
          if (v?.id) positionIds.add(v.id);
        }
      }
      const positions = await entities([...positionIds].slice(0, 50));
      const office = new RegExp(target.officePattern, "i");
      const place = new RegExp(target.placePattern, "i");

      const passing: { id: string; basis: string }[] = [];
      for (const id of hitIds) {
        const desc: string = ents[id]?.descriptions?.en?.value ?? "";
        const p39Labels = claimValues(ents[id], "P39")
          .map((v: any) => positions[v?.id]?.labels?.en?.value ?? "")
          .filter(Boolean);
        const evidence = [desc, ...p39Labels].join(" | ");
        if (office.test(evidence) && place.test(evidence)) {
          passing.push({ id, basis: `attributes: "${evidence.slice(0, 160)}"` });
        }
      }
      if (passing.length === 1) {
        matchedId = passing[0].id;
        matchBasis = passing[0].basis;
      } else if (passing.length === 0) {
        record({
          outcome: "NO_WIKIDATA_MATCH",
          detail: `${hitIds.length} hits, none passed office=/${target.officePattern}/ + place=/${target.placePattern}/`,
        });
        continue;
      } else {
        record({
          outcome: "AMBIGUOUS",
          detail: `${passing.length} items passed verification (${passing.map((p) => p.id).join(", ")}) — not guessed past`,
        });
        continue;
      }
    }

    // ── P18 portrait ──────────────────────────────────────────────────
    const ent = (await entities([matchedId]))[matchedId];
    const p18 = claimValues(ent, "P18")[0];
    if (!p18) {
      record({
        outcome: "NO_P18",
        detail: `${matchedId} matched (${matchBasis}) but carries no P18 image`,
        wikidataId: matchedId,
      });
      continue;
    }

    // ── License check via Commons extmetadata ─────────────────────────
    const fileTitle = `File:${p18}`;
    const info = await commons({
      action: "query",
      titles: fileTitle,
      prop: "imageinfo",
      iiprop: "extmetadata|url",
      iiurlwidth: "600",
    });
    const page: any = Object.values(info.query?.pages ?? {})[0];
    const ii = page?.imageinfo?.[0];
    const meta = ii?.extmetadata ?? {};
    const licenseShort = meta.LicenseShortName?.value ?? "";
    const licenseLong = meta.UsageTerms?.value ?? "";
    const artist = (meta.Artist?.value ?? "").replace(/<[^>]+>/g, "").trim();
    const license = licenseShort || licenseLong;
    if (!FREE_LICENSE.test(`${licenseShort} ${licenseLong}`)) {
      record({
        outcome: "LICENSE_NOT_FREE",
        detail: `${fileTitle}: "${license}" is not a recordable free license`,
        wikidataId: matchedId,
        commonsFile: fileTitle,
      });
      continue;
    }

    // ── Stage the 600px render for human judgment ─────────────────────
    const thumbUrl = ii?.thumburl ?? ii?.url;
    const dl = await fetch(thumbUrl, { headers: { "user-agent": UA } });
    if (!dl.ok) {
      record({
        outcome: "DOWNLOAD_FAILED",
        detail: `HTTP ${dl.status} for ${thumbUrl}`,
        wikidataId: matchedId,
        commonsFile: fileTitle,
      });
      continue;
    }
    const safe = target.key.replace(/[^a-zA-Z0-9_-]+/g, "_");
    const ext = /\.png$/i.test(p18) ? "png" : "jpg";
    const stagedFile = join(outDir, `${safe}.${ext}`);
    await writeFile(stagedFile, Buffer.from(await dl.arrayBuffer()));
    record({
      outcome: "STAGED",
      detail: `${matchedId} via ${matchBasis}; license "${license}"`,
      wikidataId: matchedId,
      commonsFile: fileTitle,
      commonsFilePage: `https://commons.wikimedia.org/wiki/${encodeURIComponent(fileTitle)}`,
      license,
      artist,
      stagedFile,
    });
  } catch (error) {
    record({
      outcome: "DOWNLOAD_FAILED",
      detail: String(error),
    });
  }
}

const staged = results.filter((r) => r.outcome === "STAGED").length;
await writeFile(join(outDir, "results.json"), JSON.stringify(results, null, 2) + "\n");
console.log(
  `\n${targets.length} hunted: ${staged} staged for judgment, ${targets.length - staged} misses — ${join(outDir, "results.json")}`,
);
