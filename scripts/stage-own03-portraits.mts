#!/usr/bin/env tsx
/**
 * `pnpm own03:stage` — pull the nine QUEUED statewide portraits down to a
 * staged directory so the author can look at all nine at once.
 *
 * OWN03 has sat in Needs Sean because approving a portrait requires SEEING it
 * (RULING 55: the decision is about an IMAGE, not about a person), and the
 * acquisition record holds only URLs. Nine URLs is not a thing anyone reviews.
 * Nine faces on one sheet is.
 *
 * **This ships nothing and decides nothing.** It fetches, verifies each
 * response really is an image, and writes `results.json` in the shape
 * `ship-staged-portraits.mts` already consumes — so the author's yes has a
 * path, and his no costs one `rm`.
 *
 * A fetch that fails is recorded as a FAILED FETCH with its status. It is
 * never recorded as a portrait that does not exist, and it never silently
 * shrinks the nine.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { PORTRAIT_ACCEPT } from "../lib/photos/decode.ts";

const ROOT = resolve(import.meta.dirname, "..");
const RECORD = join(ROOT, "data", "photos", "door2-statewide-executives-2026-08-28.json");
const OUT_DIR = join(ROOT, "data", "photos", "staged", "own03-2026-08-31");

/** The identifier this product shows every public body. It does not change per host. */
const UA = "we-the-people/1.0 (+https://github.com/SeanJ22/We-The-People)";

/*
 * `PORTRAIT_ACCEPT` is imported rather than written here, and that is the
 * point: it is derived from the formats `decodeImage` can actually read, so
 * this fetch cannot drift away from the decoder that judges its result. See
 * the note on the constant — this script is where that defect was found.
 */
const ACCEPT = PORTRAIT_ACCEPT;

interface Row {
  subject: string;
  officeTitle: string;
  stateOcdId: string;
  page: string;
  portrait?: { src: string; alt: string; why: string } | null;
  decode?: { ok: boolean; reason?: string; detail?: string } | null;
}

const record = JSON.parse(
  await import("node:fs/promises").then((fs) => fs.readFile(RECORD, "utf8")),
) as { rows: Row[]; totals: Record<string, number> };

/*
 * QUEUED is "has a portrait AND decoded successfully". Ten rows carry a
 * portrait object and only nine were queued; the tenth is Tom Horne, whose
 * decode returned NOT_AN_IMAGE because azed.gov answered a Cloudflare
 * interstitial. Deriving the set from `decode.ok` rather than from the count
 * is the point — a hardcoded 9 would silently include him the moment the
 * ordering changed.
 */
const queued = record.rows.filter((r) => r.portrait?.src && r.decode?.ok !== false);
const refused = record.rows.filter((r) => r.portrait?.src && r.decode?.ok === false);

console.log(`own03:stage — ${record.rows.length} walked, ${queued.length} queued, ${refused.length} refused at decode`);
for (const r of refused) {
  console.log(`  ! ${r.subject}: ${r.decode?.reason} — NOT staged, and NOT an absence. ${r.page}`);
}
if (queued.length !== record.totals.portraitsQueued) {
  console.error(
    `own03:stage — REFUSING: derived ${queued.length} queued, the record's own totals say ` +
      `${record.totals.portraitsQueued}. One of the two is wrong and this will not guess which.`,
  );
  process.exit(2);
}

mkdirSync(OUT_DIR, { recursive: true });

const SIGNATURES: Array<[string, string]> = [
  ["ffd8ff", "jpg"],
  ["89504e47", "png"],
  ["52494646", "webp"],
  ["47494638", "gif"],
];

interface StagedRow {
  subject: string;
  officeTitle: string;
  stateOcdId: string;
  page: string;
  sourceUrl: string;
  stagedFile?: string;
  bytes?: number;
  format?: string;
  fetch: { ok: boolean; status?: number; reason?: string };
}

const results: StagedRow[] = [];

for (const [i, row] of queued.entries()) {
  const src = row.portrait!.src;
  const base: StagedRow = {
    subject: row.subject,
    officeTitle: row.officeTitle,
    stateOcdId: row.stateOcdId,
    page: row.page,
    sourceUrl: src,
    fetch: { ok: false },
  };
  try {
    const res = await fetch(src, {
      headers: { "user-agent": UA, accept: ACCEPT },
    });
    if (!res.ok) {
      base.fetch = { ok: false, status: res.status, reason: "HTTP" };
      console.log(`  ! ${row.subject}: HTTP ${res.status} — recorded as unfetched, never as absent`);
      results.push(base);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const head = buf.subarray(0, 4).toString("hex");
    const hit = SIGNATURES.find(([sig]) => head.startsWith(sig));
    if (!hit) {
      base.fetch = {
        ok: false,
        status: res.status,
        reason: `NOT_AN_IMAGE — begins ${JSON.stringify(buf.subarray(0, 60).toString("utf8"))}`,
      };
      console.log(`  ! ${row.subject}: 200 but NOT AN IMAGE — a wall answering with a page, not a portrait`);
      results.push(base);
      continue;
    }
    const name = `${String(i + 1).padStart(2, "0")}-${row.subject.replace(/[^\w]+/g, "-").toLowerCase()}.${hit[1]}`;
    writeFileSync(join(OUT_DIR, name), buf);
    base.stagedFile = join(OUT_DIR, name);
    base.bytes = buf.length;
    base.format = hit[1];
    base.fetch = { ok: true, status: res.status };
    console.log(`  ok ${row.subject} — ${buf.length} bytes, ${hit[1]}`);
  } catch (e) {
    base.fetch = { ok: false, reason: (e as Error).message };
    console.log(`  ! ${row.subject}: ${(e as Error).message} — recorded as unfetched`);
  }
  results.push(base);
}

writeFileSync(join(OUT_DIR, "results.json"), `${JSON.stringify(results, null, 2)}\n`, "utf8");

const got = results.filter((r) => r.fetch.ok).length;
console.log(`\nown03:stage — ${got} of ${queued.length} staged into ${OUT_DIR}`);
if (got < queued.length) {
  console.log(`  ${queued.length - got} could not be fetched. They are still QUEUED and still owed.`);
}
console.log(`  next: pnpm sheet ${OUT_DIR} docs/photo-review/own03-nine.png`);
