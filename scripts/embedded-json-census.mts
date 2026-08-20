/**
 * **How big is the silently-failed-extraction blind spot?** — F01-continued
 * session 2, item 0C (2026-08-19). **SIZING ONLY.** RULING 12: no extractor
 * is built here.
 *
 * `pnpm census:embedded-json`
 *
 * ## What went wrong, and why counting it is the work
 *
 * Vail Unified's superintendent was carried as "Carruth". Session 1 measured
 * the cause and it was none of the three anyone guessed: the link was in the
 * static HTML, the page answered **200 to a plain fetch**, and the full name
 * "John Carruth" was in that HTML **six times**. The fetch worked, the
 * discovery worked, and **the extraction read nothing** — the district runs
 * on **Apptegy**, which ships its page content as an escaped JSON payload
 * embedded in a `<script>` tag, so a reader of the rendered prose finds a
 * news blurb saying "Superintendent Carruth" and never the byline.
 *
 * Session 1 then reported the class as **2 of 1,369** — but that is the class
 * of BADLY-SHAPED NAMES, which is what the name census can see. It is not the
 * class of SILENTLY FAILED EXTRACTIONS, which by construction leaves a
 * plausible-looking value behind and nothing to detect it by. That class has
 * never been sized, and an unsized blind spot on a retrieval path is exactly
 * the "a failed operation may not render as empty success" rule with nobody
 * asking the question.
 *
 * ## The method, stated so the count is checkable
 *
 * One polite serialized GET per body homepage, our own `User-Agent` with a
 * contact address, `Retry-After` honoured — the manners in
 * `lib/sources/http.ts`, unchanged. For each response body we look for the
 * signatures that mean *"the prose you can see is not where the content
 * lives"*:
 *
 * | Platform | Signature |
 * |---|---|
 * | Apptegy | `apptegy` / `thrillshare` in markup or asset hosts |
 * | Next.js | a `__NEXT_DATA__` script tag, or `self.__next_f.push` |
 * | Nuxt | `window.__NUXT__` or `__NUXT_DATA__` |
 * | Gatsby | `window.___gatsby` with a page-data fetch |
 * | Generic | a `<script type="application/json">` block over 2 KB |
 *
 * A body is counted at most once, under the first platform that matches, and
 * every body's attempt is recorded with its `attemptedAt` and result —
 * including the failures, because a refused fetch is a refused fetch and
 * never an absence.
 *
 * The output is a table plus a machine-readable JSON file the source-ladder
 * rung quotes from, so the numbers in the doc cannot drift from the run.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { politeGetText } from "../lib/sources/http.ts";
import { today } from "./doc-dates.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Body {
  id: string;
  name: string | null;
  bodyClass: string;
  coverageStatus: string;
  agendaSourceType: string | null;
  agendaSourceRef: string | null;
  homepageUrl: string | null;
}

const registry = JSON.parse(
  readFileSync(join(ROOT, "lib", "registry", "registry.json"), "utf8"),
) as { bodies: Body[] };

const PLATFORMS = [
  {
    key: "APPTEGY",
    test: (html: string) => /apptegy|thrillshare/i.test(html),
  },
  {
    key: "NEXT",
    test: (html: string) => /id="__NEXT_DATA__"|self\.__next_f\.push/.test(html),
  },
  {
    key: "NUXT",
    test: (html: string) => /window\.__NUXT__|__NUXT_DATA__/.test(html),
  },
  {
    key: "GATSBY",
    test: (html: string) => /window\.___gatsby|page-data\.json/.test(html),
  },
  {
    key: "GENERIC_JSON_BLOCK",
    test: (html: string) => {
      for (const m of html.matchAll(
        /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi,
      )) {
        // JSON-LD is structured markup we already read (ladder rung 8) and
        // is not a content-hiding payload, so it does not count here.
        if (/"@context"\s*:/.test(m[1])) continue;
        if (m[1].length > 2048) return true;
      }
      return false;
    },
  },
] as const;

interface Row {
  bodyId: string;
  name: string | null;
  url: string;
  attemptedAt: string;
  status: number | null;
  /** The first signature matched — how the body is counted, once. */
  platform: string | null;
  /**
   * EVERY signature matched. Apptegy is built on Nuxt and also ships an
   * `application/json` block, so it hits three; counting a body once under
   * its first match is right for the total and hides that, which is why both
   * are recorded.
   */
  signatures: string[];
  bytes: number | null;
  /** Bytes inside `application/json` script blocks — the payload's size. */
  jsonBytes: number | null;
  error: string | null;
}

/** How many bytes of a page are sitting inside a typed JSON script block. */
function embeddedJsonBytes(html: string): number {
  let total = 0;
  for (const m of html.matchAll(
    /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    if (/"@context"\s*:/.test(m[1])) continue;
    total += m[1].length;
  }
  return total;
}

const candidates = registry.bodies.filter((b) => b.homepageUrl);
const heldTotal = registry.bodies.length;

console.log("=== embedded-JSON census (SIZING ONLY — RULING 12) ===\n");
console.log(`bodies held in the registry            ${heldTotal}`);
console.log(`bodies carrying a homepage URL         ${candidates.length}`);
console.log(`bodies with NO homepage URL to fetch   ${heldTotal - candidates.length}`);
console.log(
  "\nA body with no homepage URL is not evidence of anything — it is a body\n" +
    "this census could not ask. It is reported separately for that reason.\n",
);

const rows: Row[] = [];
let done = 0;
for (const body of candidates) {
  const url = body.homepageUrl as string;
  const attemptedAt = new Date().toISOString();
  done += 1;
  try {
    const res = await politeGetText(url, { profile: "browser" });
    const signatures = PLATFORMS.filter((p) => p.test(res.text)).map((p) => p.key);
    const platform = signatures[0] ?? null;
    const jsonBytes = embeddedJsonBytes(res.text);
    rows.push({
      bodyId: body.id,
      name: body.name,
      url,
      attemptedAt,
      status: res.status,
      platform,
      signatures,
      bytes: res.text.length,
      jsonBytes,
      error: null,
    });
    process.stdout.write(
      `  [${done}/${candidates.length}] ${res.status} ${platform ?? "-"}  ${url}` +
        (jsonBytes > 0 ? `  (${jsonBytes}B embedded JSON)` : "") +
        "\n",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /HTTP (\d+)/.exec(message)?.[1];
    rows.push({
      bodyId: body.id,
      name: body.name,
      url,
      attemptedAt,
      status: status ? Number(status) : null,
      platform: null,
      signatures: [],
      bytes: null,
      jsonBytes: null,
      error: message,
    });
    process.stdout.write(`  [${done}/${candidates.length}] FAILED  ${url}  — ${message}\n`);
  }
}

// ── The counts ──────────────────────────────────────────────────────────
const reached = rows.filter((r) => r.error === null);
const refused = rows.filter((r) => r.error !== null);
const byPlatform = new Map<string, Row[]>();
for (const r of reached) {
  if (!r.platform) continue;
  byPlatform.set(r.platform, [...(byPlatform.get(r.platform) ?? []), r]);
}
const embedded = reached.filter((r) => r.platform !== null);

/**
 * The wiring rows, which is the other Apptegy number and a different
 * question: how many bodies do we FETCH AGENDAS from through the Apptegy
 * adapter. Session 1 reported 2 of 19; it is recomputed here rather than
 * quoted, so the doc cannot carry a stale figure.
 */
const apptegyWired = registry.bodies.filter((b) => b.agendaSourceType === "APPTEGY");
const wiredTotal = registry.bodies.filter(
  (b) => b.agendaSourceType && b.agendaSourceType !== "NONE",
);

console.log("\n=== RESULTS ===\n");
console.log(`fetched                                ${rows.length}`);
console.log(`  reached (2xx)                        ${reached.length}`);
console.log(`  refused / failed                     ${refused.length}`);
console.log(`\nof the ${reached.length} reached, serving content as embedded JSON: ${embedded.length}`);
for (const [key, list] of [...byPlatform].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${key.padEnd(22)}${list.length}`);
}
console.log(`  ${"(no signature)".padEnd(22)}${reached.length - embedded.length}`);

// Counted once under its first match above; a body can trip several, and
// saying so is the difference between "two platforms" and "two bodies".
const everySignature = new Map<string, number>();
for (const r of reached) {
  for (const s of r.signatures) everySignature.set(s, (everySignature.get(s) ?? 0) + 1);
}
console.log("\n  every signature each body trips (a body may trip several):");
for (const [key, n] of [...everySignature].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${key.padEnd(22)}${n}`);
}
console.log("\n  the embedded payloads, named and measured:");
for (const r of embedded) {
  console.log(
    `    ${r.url}\n      ${r.jsonBytes}B of ${r.bytes}B ` +
      `(${(((r.jsonBytes ?? 0) / (r.bytes ?? 1)) * 100).toFixed(1)}% of the page) ` +
      `signatures=[${r.signatures.join(", ")}]`,
  );
}

console.log(`\nApptegy as an AGENDA WIRING (a different question):`);
console.log(`  wired via APPTEGY                    ${apptegyWired.length}`);
console.log(`  wired via anything                   ${wiredTotal.length}`);

console.log(`\nEXTRACTION VERIFIED AGAINST RENDERED PAGE CONTENT`);
console.log(
  `  bodies with a recorded verification   0 of ${heldTotal}\n` +
    "  Nothing in this repository records such a verification for ANY body:\n" +
    "  no field, no file, no run. That is the finding — the blind spot is not\n" +
    "  N bodies wide, it is the whole registry, because the question has never\n" +
    "  been asked of any of them.",
);

if (refused.length > 0) {
  console.log("\nREFUSED, named — a wall is recorded as a wall, never as an absence:");
  for (const r of refused) console.log(`  ${r.url} — ${r.error}`);
}

const out = {
  generatedAt: today(),
  method: "one polite serialized browser-profile GET per body homepage",
  heldTotal,
  fetched: rows.length,
  reached: reached.length,
  refused: refused.length,
  embeddedJson: embedded.length,
  byPlatform: Object.fromEntries([...byPlatform].map(([k, v]) => [k, v.length])),
  apptegyWired: apptegyWired.length,
  wiredTotal: wiredTotal.length,
  extractionVerified: 0,
  rows,
};
const outPath = join(ROOT, "docs", "evidence", "embedded-json-census.json");
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
console.log(`\nwritten: ${outPath}`);
