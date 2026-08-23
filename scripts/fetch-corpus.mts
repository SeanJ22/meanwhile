/**
 * @freshness-reads-here
 *
 * RULING 107 — the clock stamps in this file are minted by the code path that
 * performs the read: the freshness date is taken at the moment of the fetch,
 * which is what the ruling asks for rather than what it forbids. Verified
 * 2026-08-23 by reading each stamp site against the retrieval it sits in.
 */
/**
 * Fill the statement corpus (3e): fetch each verified campaign site and each
 * wired official's official page into `data/corpus/statements.json`.
 *
 * `pnpm corpus:fetch`
 *
 * Append-only: an unchanged `contentHash` for the same (subject, url)
 * appends nothing and is counted as `unchanged`; a changed hash appends a
 * new snapshot BESIDE the old one — that pair is the "this page changed"
 * marker's raw material. Serialized requests, identified User-Agent, and
 * the run reports fetched/appended/unchanged/failed with the denominator.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { CAMPAIGN_SITES } from "../lib/officials/campaign-sites.ts";
import type {
  SourceSnapshot,
  StatementCorpus,
} from "../lib/corpus/types.ts";
import { coverageAt } from "../lib/registry/server.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "corpus", "statements.json");

const ZIPS: [number, number][] = [
  [32.21696, -110.971],
  [32.04903, -110.62291],
  [40.95499, -74.48801],
  [43.31403, -72.02455],
];

/** Strip tags and collapse whitespace — a text snapshot, not a DOM. */
function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;|&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleOf(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? extractText(match[1]) || null : null;
}

interface Target {
  subjectId: string;
  subjectName: string;
  kind: SourceSnapshot["kind"];
  url: string;
}

// The wired officials: everyone the four-zip surface renders.
const wired = new Map<string, { name: string; websiteUrl: string | null }>();
for (const [lat, lng] of ZIPS) {
  const c = await coverageAt(lat, lng, 1);
  for (const s of c.seats)
    for (const r of s.representatives)
      wired.set(r.id, { name: r.name, websiteUrl: r.websiteUrl });
  for (const r of c.senators)
    wired.set(r.id, { name: r.name, websiteUrl: r.websiteUrl });
}

const targets: Target[] = [];
for (const [id, info] of wired) {
  if (info.websiteUrl) {
    targets.push({
      subjectId: id,
      subjectName: info.name,
      kind: "OFFICIAL_PAGE",
      url: info.websiteUrl,
    });
  }
  const campaign = CAMPAIGN_SITES[id];
  if (campaign) {
    targets.push({
      subjectId: id,
      subjectName: info.name,
      kind: "CAMPAIGN_SITE",
      url: campaign.url,
    });
  }
}

let corpus: StatementCorpus = { snapshots: [] };
try {
  corpus = JSON.parse(await readFile(OUT, "utf8")) as StatementCorpus;
} catch {
  // First run: an empty corpus is the honest starting state.
}

/** The latest snapshot per (subject, url) — the unchanged check's basis. */
const latest = new Map<string, SourceSnapshot>();
for (const snap of corpus.snapshots) {
  latest.set(`${snap.subjectId}|${snap.url}`, snap);
}

let appended = 0;
let unchanged = 0;
let failed = 0;

for (const target of targets) {
  const retrievedAt = new Date().toISOString();
  let status = 0;
  let html: string | null = null;

  try {
    const response = await fetch(target.url, {
      headers: {
        "user-agent":
          "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)",
        accept: "text/html",
      },
      redirect: "follow",
    });
    status = response.status;
    if (response.ok) html = await response.text();
  } catch {
    status = 0;
  }

  const text = html ? extractText(html) : null;
  const ok = text !== null && text.length > 0;
  const contentHash = createHash("sha256")
    .update(text ?? `FAILED:${status}`)
    .digest("hex");

  const prior = latest.get(`${target.subjectId}|${target.url}`);
  if (prior && prior.contentHash === contentHash) {
    unchanged++;
    console.log(`  UNCHANGED ${target.subjectName} ${target.kind}`);
    continue;
  }

  const snapshot: SourceSnapshot = {
    id: `${target.subjectId}|${target.url}|${contentHash}`,
    subjectId: target.subjectId,
    subjectName: target.subjectName,
    kind: target.kind,
    url: target.url,
    contentHash,
    retrievedAt,
    httpStatus: status,
    extraction: ok ? "ok" : "failed",
    text: ok ? text : null,
    title: html ? titleOf(html) : null,
  };

  corpus.snapshots.push(snapshot);
  latest.set(`${target.subjectId}|${target.url}`, snapshot);
  if (ok) {
    appended++;
    console.log(
      `  APPENDED  ${target.subjectName} ${target.kind} — ${Math.round((text?.length ?? 0) / 1024)} KB text${prior ? " (CHANGED since " + prior.retrievedAt.slice(0, 10) + ")" : ""}`,
    );
  } else {
    failed++;
    console.log(`  FAILED    ${target.subjectName} ${target.kind} — HTTP ${status}`);
  }
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(corpus, null, 1) + "\n");

console.log(
  `${targets.length} targets: ${appended} appended, ${unchanged} unchanged, ${failed} failed → ${corpus.snapshots.length} snapshots total`,
);
if (targets.length === 0) {
  console.error("zero targets — that is a finding, not a success");
  process.exit(1);
}
