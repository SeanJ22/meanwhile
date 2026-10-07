/**
 * The plain-English sweep over the RENDERED admin console: machine codes arrive
 * at render time from the control plane, so only the rendered document can be
 * asked. It reads the document twice:
 *
 * ```
 *   FACE   every `<details>` closed, every `title=` ignored — what the owner
 *          sees before clicking anything. A machine constant here is a defect.
 *   DEPTH  every `<details>` open. A machine constant here is CORRECT and is
 *          counted, not failed.
 * ```
 *
 * What counts as a machine constant:
 *
 * ```
 *   SCREAMING_SNAKE     CYCLE_DEFERRED, NOT_WALKED, REFUSED_BY_HOST
 *   an env-var name     WTP_WORKERS_ANTHROPIC_API_KEY
 *   a shell command     pnpm <script>
 *   a source path       lib/control-plane/promotion
 *   a bare long hash    a 12+ hex run of a work-item or attempt id
 *   four-decimal money  $0.4394
 * ```
 *
 * Each exception carries its reason; the owner's own vocabulary (READER,
 * TRUTH, FRESHNESS, GREEN, AMBER, RED) is not a machine constant.
 *
 *   pnpm admin:plain-sweep                    # against a local next start
 *   ADMIN_SWEEP_BASE=http://localhost:3100 pnpm admin:plain-sweep
 *
 * It mints a real admin session rather than bypassing the gate, and it never
 * contacts production.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ADMIN_ORIGIN } from "../lib/ops/origins.ts";
import { join } from "node:path";

import { ADMIN_SESSION_COOKIE, signSession } from "../lib/control-plane/admin-auth.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { launchGuarded } from "./browser.mts";

/** The admin host, derived from the one origins module rather than retyped. */
const ADMIN_HOST = new URL(ADMIN_ORIGIN).host;

/** The surfaces swept. A new admin page belongs on this list the day it ships. */
export const SWEPT_PATHS: readonly string[] = [
  "admin",
];

/** One kind of thing that must not reach the face, with how to find it. */
export interface Offence {
  readonly kind: string;
  readonly pattern: RegExp;
  readonly why: string;
}

export const OFFENCES: readonly Offence[] = [
  { kind: "machine constant", pattern: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, why: "ADM-25: an underscore standing for a space is not English" },
  { kind: "shell command", pattern: /\bpnpm [a-z][a-z0-9:-]*/g, why: "ADM-37: the owner is not a coder and cannot run one" },
  { kind: "source path", pattern: /\blib\/[a-z0-9-]+\/[a-z0-9-]+/g, why: "ADM-46: a code path is not an explanation" },
  { kind: "four-decimal money", pattern: /\$\d+\.\d{3,}/g, why: "ADM-26: dollars round to cents" },
  { kind: "bare long hash", pattern: /(?<![\w/-])[0-9a-f]{12,}(?![\w-])/g, why: "ADM-44: a hash on the face is not a name" },
];

/**
 * Words that LOOK like machine constants and are the owner's own vocabulary.
 * Every entry carries the reason it is not a defect.
 */
export const ALLOWED_ON_THE_FACE: Readonly<Record<string, string>> = {
  // The health scale the owner explicitly asked to keep.
  GREEN: "the health grade, in the owner's own words",
  AMBER: "the health grade, in the owner's own words",
  RED: "the health grade, in the owner's own words",
  UNKNOWN: "the health grade, in the owner's own words",
  READER: "the contract's name as the owner says it",
  TRUTH: "the contract's name as the owner says it",
  FRESHNESS: "the contract's name as the owner says it",
};

export interface SweepReading {
  readonly path: string;
  readonly status: number;
  /** Milliseconds to first render and to data-ready. */
  readonly domMs: number;
  readonly readyMs: number;
  readonly faceChars: number;
  readonly depthChars: number;
  readonly detailsCount: number;
  /** Offences on the face, with the exact text and its surrounding sentence. */
  readonly onTheFace: readonly { readonly kind: string; readonly text: string; readonly context: string }[];
  /** The same offences one disclosure down, which is where they belong. */
  readonly inDisclosures: number;
}

function findOffences(text: string): { kind: string; text: string; context: string }[] {
  const found: { kind: string; text: string; context: string }[] = [];
  for (const offence of OFFENCES) {
    for (const m of text.matchAll(offence.pattern)) {
      const hit = m[0];
      if (offence.kind === "machine constant" && ALLOWED_ON_THE_FACE[hit]) continue;
      const at = m.index ?? 0;
      found.push({ kind: offence.kind, text: hit, context: text.slice(Math.max(0, at - 60), at + hit.length + 60).replace(/\s+/g, " ") });
    }
  }
  return found;
}

async function main(): Promise<void> {
  const base = process.env.ADMIN_SWEEP_BASE ?? "http://localhost:3100";
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
    throw new Error(`admin:plain-sweep refuses ${base}: this instrument reads a LOCAL build and never production.`);
  }
  const key = process.env.WTP_ADMIN_SESSION_KEY;
  if (!key) throw new Error("WTP_ADMIN_SESSION_KEY is not set, so no admin session can be minted and no admin page can be read.");

  const nowSeconds = Math.floor(Date.now() / 1000);
  const cookie = await signSession({ sid: "adm_plainsweep0000000000", iat: nowSeconds, exp: nowSeconds + 3600, via: "google" }, key);
  const browser = await launchGuarded({ label: "admin-plain-sweep" });
  const context = await browser.context({
    viewport: { width: 1440, height: 1200 },
    extraHTTPHeaders: { "x-forwarded-host": ADMIN_HOST },
  });
  await context.addCookies([{ name: ADMIN_SESSION_COOKIE, value: cookie, url: base.replace(/^http:/, "https:"), secure: true, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();

  const readings: SweepReading[] = [];
  for (const path of SWEPT_PATHS) {
    const startedAt = Date.now();
    let status = 0;
    try {
      const response = await page.goto(`${base}/${path}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      status = response?.status() ?? 0;
    } catch {
      status = 0;
    }
    const domMs = Date.now() - startedAt;
    try {
      await page.waitForLoadState("networkidle", { timeout: 30_000 });
    } catch {
      /* a page that never idles is still read; the timing says so */
    }
    const readyMs = Date.now() - startedAt;
    if (status !== 200) {
      readings.push({ path, status, domMs, readyMs, faceChars: 0, depthChars: 0, detailsCount: 0, onTheFace: [], inDisclosures: 0 });
      continue;
    }

    // THE FACE: every disclosure closed.
    const face = await page.evaluate(() => {
      for (const d of Array.from(document.querySelectorAll("details"))) d.removeAttribute("open");
      return document.body.innerText;
    });
    // DEPTH: every disclosure open.
    const depth = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("details"));
      for (const d of all) d.setAttribute("open", "");
      return { text: document.body.innerText, details: all.length };
    });

    const onTheFace = findOffences(face);
    const inDepth = findOffences(depth.text);
    readings.push({
      path,
      status,
      domMs,
      readyMs,
      faceChars: face.length,
      depthChars: depth.text.length,
      detailsCount: depth.details,
      onTheFace,
      inDisclosures: Math.max(0, inDepth.length - onTheFace.length),
    });
  }

  await context.close();
  await browser.close();

  const out = join(process.cwd(), ".scratch", "admin-plain-sweep.json");
  mkdirSync(join(process.cwd(), ".scratch"), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ base, sweptAt: new Date().toISOString(), readings }, null, 2)}\n`);

  const reached = readings.filter((r) => r.status === 200);
  const offending = reached.filter((r) => r.onTheFace.length > 0);
  console.log(floorLine(floored("admin surfaces read", "the swept path list", SWEPT_PATHS.length, reached.length)));
  for (const reading of readings) {
    const head = `${reading.path} — status ${reading.status}, ready ${reading.readyMs} ms, ${reading.detailsCount} disclosure(s)`;
    if (reading.status !== 200) {
      console.log(`${head} · NOT READ`);
      continue;
    }
    console.log(`${head} · ${reading.onTheFace.length} on the face, ${reading.inDisclosures} one click down`);
    for (const hit of reading.onTheFace.slice(0, 12)) {
      console.log(`    ${hit.kind}: ${hit.text}  …${hit.context}…`);
    }
    if (reading.onTheFace.length > 12) console.log(`    …and ${reading.onTheFace.length - 12} more; the full list is in ${out}`);
  }
  console.log(
    offending.length === 0
      ? "PLAIN: no machine constant, command, code path, four-decimal dollar or bare hash reached the face of any surface read."
      : `NOT PLAIN: ${offending.length} of ${reached.length} surfaces read still carry one.`,
  );
  process.exitCode = offending.length === 0 ? 0 : 1;
}

await main();
