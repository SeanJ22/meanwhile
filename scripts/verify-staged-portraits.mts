/**
 * `pnpm photos:verify` — **decode every staged portrait before it can queue.**
 * (2026-08-25, Item 11 of the one-session brief.)
 *
 * The door-2 hunt of 2026-08-24 queued **two soft-404 HTML pages as
 * portraits**: served `200`, several kilobytes each, `.jpg`-shaped URLs, and
 * nothing between the fetch and the review sheet asked whether the bytes were
 * an image. Only the author's eyes on the sheet caught them.
 *
 * This fetches each staged row's bytes, decodes them with
 * `lib/photos/decode.ts`, and writes the verdict back onto the row. The queue
 * (`lib/photos/staged.ts`) refuses any row without a passing record — a
 * MISSING record refuses exactly as a failing one does, so a row that has
 * never been through here cannot reach the author by default.
 *
 * **It is polite and it identifies itself**, as the public-records rule
 * requires of every fetch this project makes: serialized requests, a
 * `User-Agent` with a contact address, and `Retry-After` honoured.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { decodeImage, decodeRecord, type PortraitDecodeRecord } from "../lib/photos/decode.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const UA =
  "we-the-people/1.0 (civic meeting data; contact via https://sparkwtp.netlify.app/feedback)";

/** Every artifact the review queue reads. Kept in step with `STAGING_FILES`. */
const FILES = [
  "data/photos/door2-incumbents-2026-08-25.json",
  "data/photos/door2-tusd-board-2026-08-25.json",
];

interface Row {
  subject?: string;
  portrait?: { src: string } | null;
  photoAlreadyHeld?: boolean;
  decode?: PortraitDecodeRecord;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function politeGet(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429 || res.status === 503) {
      const after = Number(res.headers.get("retry-after") ?? 5);
      console.log(`  ${res.status} — honouring Retry-After ${after}s`);
      await sleep(Math.min(after, 60) * 1000);
      continue;
    }
    return res;
  }
  throw new Error("rate-limited after 4 attempts");
}

/*
 * The stamp comes from `today()`, never a UTC slice. A UTC slice reads a day
 * AHEAD of America/Phoenix after 5pm local, and this writes a DECODE DATE onto
 * a record RULING 53 later reads to decide whether to re-walk it. Caught by
 * tests/generated-doc-dates.test.ts before it shipped — the second time that
 * guard has caught this exact mistake in this session.
 */
const stamp = today();
let checked = 0;
let passed = 0;
const failures: string[] = [];

for (const file of FILES) {
  const path = join(ROOT, file);
  let parsed: { rows?: Row[] };
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as typeof parsed;
  } catch {
    console.log(`  ${file}: absent — nothing to verify`);
    continue;
  }

  console.log(`\n${file}`);
  for (const row of parsed.rows ?? []) {
    if (!row.portrait?.src || row.photoAlreadyHeld) continue;
    checked += 1;
    const url = row.portrait.src;
    let record: PortraitDecodeRecord;
    try {
      const res = await politeGet(url);
      const bytes = new Uint8Array(await res.arrayBuffer());
      /*
       * The STATUS is recorded and is deliberately not the verdict. A soft 404
       * is a 200, which is the whole reason this script exists — RULING 117
       * settled the same question for the asset store: a 200 that is not the
       * thing is not a document.
       */
      const verdict = decodeImage(bytes);
      record = decodeRecord(verdict, stamp);
      if (!verdict.ok) {
        record.detail = `HTTP ${res.status}; ${record.detail ?? ""}`.trim();
      }
    } catch (error) {
      record = {
        ok: false,
        reason: "FETCH_FAILED",
        detail: (error as Error).message.split("\n")[0].slice(0, 160),
        decodedAt: stamp,
      };
    }
    row.decode = record;
    if (record.ok) {
      passed += 1;
      console.log(
        `  PASS  ${row.subject ?? "(unnamed)"} — ${record.format} ${record.width}x${record.height}, ${record.bytes} bytes`,
      );
    } else {
      failures.push(`${row.subject ?? "(unnamed)"}: ${record.reason} — ${record.detail}`);
      console.log(`  REFUSED  ${row.subject ?? "(unnamed)"} — ${record.reason}: ${record.detail}`);
    }
    await sleep(1200);
  }

  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

console.log(`\nphotos:verify · ${passed} of ${checked} staged portrait(s) decode as images`);
if (failures.length > 0) {
  console.log(`\n${failures.length} REFUSED — these can no longer reach the review sheet:`);
  for (const f of failures) console.log(`  ${f}`);
}
