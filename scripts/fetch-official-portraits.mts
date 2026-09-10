/**
 * @freshness-reads-here
 *
 * RULING 107 — the clock stamps in this file are minted by the code path that
 * performs the read: the freshness date is taken at the moment of the fetch,
 * which is what the ruling asks for rather than what it forbids. Verified
 * 2026-08-23 by reading each stamp site against the retrieval it sits in.
 */
/**
 * Door 2 of the photo rule (2026-08-14, the author's decision): fetch the
 * portrait a government body publishes to identify its OWN member.
 *
 * This is the tier the licence-only rule blocked whole. A chamber's member
 * page, a governor's office page, a board's roster page — the body publishes
 * that portrait precisely so the public can identify the person holding the
 * office, and using it with the source recorded, attribution to the
 * publishing body, and a documented remove-on-request posture is the second
 * acceptable basis. Commercial photography is NOT in scope here and never
 * will be: campaign headshots, press photos and wire images still need an
 * explicit licence.
 *
 * Two phases, deliberately separated, because the never-wrong-face standard
 * cannot be automated:
 *
 *   `--stage <targets.json> <outDir>`  fetches every portrait into a staging
 *                                      directory and writes results.json.
 *   (a human — or the session — then LOOKS at every staged image)
 *   `--ship <outDir>`                  commits the judged ones.
 *
 * A target that fails at any rung is recorded with what the rung returned,
 * never dropped. Counts are reported per run: fetched / staged / failed,
 * against the stated denominator (the operation-that-can-return-nothing
 * rule — a sweep that stages zero must not read as a clean run).
 *
 * Requests are serialized, identify themselves, and honour Retry-After.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { stamp } from "./stamp.mts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA =
  "we-the-people-civic-app/0.1 (nonpartisan civic information; contact seanj22@gmail.com)";

export interface PortraitTarget {
  /** Manifest / card key: congress:…, statewide:…, roster:…, ballot-… */
  key: string;
  name: string;
  /** The body's own page that publishes this portrait. */
  pageUrl: string;
  /** The portrait's absolute URL, read off that page. */
  imageUrl: string;
  /** The publishing body, credited on the row. */
  publisher: string;
}

export interface PortraitResult extends PortraitTarget {
  outcome: "STAGED" | "FETCH_FAILED" | "NOT_AN_IMAGE" | "TOO_SMALL";
  detail: string;
  attemptedAt: string;
  stagedFile?: string;
  width?: number;
  height?: number;
  bytes?: number;
}

/** JPEG/PNG dimensions without decoding — enough to reject a banner crop. */
function imageSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      // SOF0..SOF15, excluding the non-frame markers in that range.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function politeGet(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, { headers: { "user-agent": UA } });
    if (response.status === 429 || response.status === 503) {
      const after = Number(response.headers.get("retry-after") ?? 5);
      console.log(`  ${response.status} — honouring Retry-After ${after}s`);
      await sleep(Math.min(after, 60) * 1000);
      continue;
    }
    return response;
  }
  throw new Error("rate-limited after 4 attempts");
}

export async function stage(
  targets: PortraitTarget[],
  outDir: string,
): Promise<PortraitResult[]> {
  await mkdir(outDir, { recursive: true });
  // America/Phoenix, never UTC — after 5pm local the obvious one-liner
  // returns tomorrow and every row claims a date nobody could have read.
  const attemptedAt = stamp();
  const results: PortraitResult[] = [];

  for (const [index, target] of targets.entries()) {
    const label = `[${index + 1}/${targets.length}] ${target.name}`;
    try {
      const response = await politeGet(target.imageUrl);
      if (!response.ok) {
        results.push({
          ...target,
          outcome: "FETCH_FAILED",
          detail: `HTTP ${response.status} from ${target.imageUrl}`,
          attemptedAt,
        });
        console.log(`${label}: HTTP ${response.status}`);
        continue;
      }
      const type = response.headers.get("content-type") ?? "";
      const buf = Buffer.from(await response.arrayBuffer());
      if (!/^image\/(jpeg|png)/.test(type)) {
        results.push({
          ...target,
          outcome: "NOT_AN_IMAGE",
          detail: `content-type ${type || "(none)"} — not a JPEG or PNG`,
          attemptedAt,
        });
        console.log(`${label}: not an image (${type})`);
        continue;
      }
      const size = imageSize(buf);
      // A portrait is taller than it is wide, or close to square. A wide
      // image at this URL is a banner or a page header — the canonical
      // failure class — and it never reaches the judgment pass.
      if (!size || size.w < 100 || size.h < 100 || size.w / size.h > 1.25) {
        results.push({
          ...target,
          outcome: "TOO_SMALL",
          detail: size
            ? `${size.w}×${size.h} — too small or too wide to be a portrait (banner/header shape)`
            : "could not read image dimensions",
          attemptedAt,
          width: size?.w,
          height: size?.h,
        });
        console.log(`${label}: rejected shape ${size?.w}×${size?.h}`);
        continue;
      }
      const ext = type.includes("png") ? "png" : "jpg";
      const stagedFile = join(
        outDir,
        `${target.key.replace(/[^a-zA-Z0-9-]+/g, "-")}.${ext}`,
      );
      await writeFile(stagedFile, buf);
      results.push({
        ...target,
        outcome: "STAGED",
        detail: `${size.w}×${size.h}, ${buf.length} bytes, ${type}`,
        attemptedAt,
        stagedFile,
        width: size.w,
        height: size.h,
        bytes: buf.length,
      });
      console.log(`${label}: staged ${size.w}×${size.h}`);
    } catch (error) {
      results.push({
        ...target,
        outcome: "FETCH_FAILED",
        detail: (error as Error).message,
        attemptedAt,
      });
      console.log(`${label}: ${(error as Error).message}`);
    }
    await sleep(400);
  }

  await writeFile(
    join(outDir, "results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
    "utf8",
  );

  // The counts, always — against the denominator we asked for.
  const staged = results.filter((r) => r.outcome === "STAGED").length;
  console.log(
    `\n=== staged ${staged} of ${targets.length} attempted; ${
      targets.length - staged
    } recorded as misses with their rung ===`,
  );
  return results;
}

/**
 * Commit the judged portraits. `judgments` maps key → the one-line human
 * judgment; a staged image absent from it DOES NOT SHIP, exactly as the
 * Commons pipeline works.
 */
export async function ship(
  _results: PortraitResult[],
  _judgments: Record<string, string>,
): Promise<{ shipped: number; recorded: number }> {
  throw new Error(
    "TRACKED_PORTRAIT_BINDING_WRITER_RETIRED: reviewed official-photo and roster-photo bindings must be included in a registry-runtime-bindings package and promoted with scripts/promote-registry-runtime.mts --promote.",
  );
}

// ── CLI ──────────────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith("fetch-official-portraits.mts")) {
  const mode = process.argv[2];
  if (mode === "--stage") {
    const targets = JSON.parse(
      await readFile(process.argv[3], "utf8"),
    ) as PortraitTarget[];
    await stage(targets, process.argv[4]);
  } else if (mode === "--ship") {
    const dir = process.argv[3];
    const results = JSON.parse(
      await readFile(join(dir, "results.json"), "utf8"),
    ) as PortraitResult[];
    const judgments = JSON.parse(
      await readFile(join(dir, "judgments.json"), "utf8"),
    ) as Record<string, string>;
    await ship(results, judgments);
  } else {
    console.error(
      "usage: fetch-official-portraits.mts --stage <targets.json> <outDir> | --ship <outDir>",
    );
    process.exit(1);
  }
}
