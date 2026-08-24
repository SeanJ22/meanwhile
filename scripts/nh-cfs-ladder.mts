#!/usr/bin/env tsx
/**
 * **NEW HAMPSHIRE'S CAMPAIGN FINANCE SYSTEM — walking the ladder at
 * `cfs.sos.nh.gov`.** Item 5 of the 2026-08-24 state-campaign-money session.
 *
 * Committed per RULING 76: the rung that falls is the deliverable, and a
 * one-shot script that carries a technique stays in the tree.
 *
 * ## What is already known before this runs (RULING 63)
 *
 * `sos.nh.gov` was recorded walled host-wide from 2026-08-13 and answered at
 * **rung 5** on 2026-08-21 — so a wall on this host has fallen before, and
 * RULING 53 puts walled sources on a 14-day clock regardless of how
 * emphatically the wall was recorded.
 *
 * Measured 2026-08-24 at rung 3 (the full browser header set): **HTTP 403**
 * from Akamai, with an `errors.edgesuite.net` reference. That is an EDGE
 * refusal rather than an application refusal, which matters for where to go
 * next: a header problem is fixed with headers, and an edge fingerprint
 * refusal is not.
 *
 * So this walks the rungs that remain and RECORDS EACH ONE with its result,
 * because a wall that is named with its rungs is a finding and a wall that is
 * asserted is not.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";
import { today } from "./doc-dates.mjs";

const AS_OF = today();
const ROOT = join(import.meta.dirname, "..");

const TARGETS = [
  "https://cfs.sos.nh.gov/",
  "https://cfs.sos.nh.gov/Public/ReceiptsList",
  "https://cfs.sos.nh.gov/Public/CommitteeList",
] as const;

interface Rung {
  rung: number;
  what: string;
  url: string;
  status: number | string;
  bytes: number;
  /** The CONTROL: is the body about the thing asked for, or a refusal page? */
  isTheThing: boolean;
  note: string;
  attemptedAt: string;
}

const rungs: Rung[] = [];

const looksLikeRefusal = (body: string): boolean =>
  /access denied|edgesuite|<title>\s*403|forbidden|incapsula|_incapsula_resource|distil/i.test(body);

/* ── Rung 2: a plain fetch ────────────────────────────────────────────────── */
for (const url of TARGETS) {
  try {
    const res = await fetch(url);
    const body = await res.text();
    rungs.push({
      rung: 2,
      what: "plain fetch",
      url,
      status: res.status,
      bytes: body.length,
      isTheThing: res.ok && !looksLikeRefusal(body),
      note: looksLikeRefusal(body) ? "refusal page" : res.ok ? "served" : `HTTP ${res.status}`,
      attemptedAt: AS_OF,
    });
  } catch (err) {
    rungs.push({
      rung: 2, what: "plain fetch", url, status: "ERROR", bytes: 0, isTheThing: false,
      note: String((err as Error)?.message ?? err), attemptedAt: AS_OF,
    });
  }
}

/* ── Rung 3: the full browser header set ──────────────────────────────────── */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};
for (const url of TARGETS.slice(0, 1)) {
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  const body = await res.text();
  rungs.push({
    rung: 3, what: "full browser header set", url, status: res.status, bytes: body.length,
    isTheThing: res.ok && !looksLikeRefusal(body),
    note: looksLikeRefusal(body) ? "Akamai refusal page (errors.edgesuite.net) — an EDGE refusal, not an application one" : `HTTP ${res.status}`,
    attemptedAt: AS_OF,
  });
}

/* ── Rung 6: THE LIVE BROWSER, JavaScript executed, content awaited ───────── */
/*
 * The rung that matters against an edge fingerprint filter. A page that
 * renders for a human renders for us, and a plain fetch returning nothing on
 * an edge-protected host is a FALSE MISS rather than a wall.
 */
const browser = await launchGuarded({ label: "nh-cfs-ladder-0824" });
try {
  const page = await browser.page({ viewport: { width: 1280, height: 900 } });
  for (const url of TARGETS) {
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(2500);
      const body = (await page.evaluate("document.documentElement.outerHTML")) as string;
      const title = (await page.evaluate("document.title")) as string;
      rungs.push({
        rung: 6,
        what: "live browser, JS executed",
        url,
        status: response?.status() ?? "no response",
        bytes: body.length,
        isTheThing: !looksLikeRefusal(body) && body.length > 2000,
        note: looksLikeRefusal(body) ? `refusal page, title "${title}"` : `title "${title}"`,
        attemptedAt: AS_OF,
      });
    } catch (err) {
      rungs.push({
        rung: 6, what: "live browser, JS executed", url, status: "ERROR", bytes: 0,
        isTheThing: false, note: String((err as Error)?.message ?? err), attemptedAt: AS_OF,
      });
    }
  }

  /* ── Rung 7: the page's own network calls, if the browser got in ────────── */
  const gotIn = rungs.some((r) => r.rung === 6 && r.isTheThing);
  if (gotIn) {
    const calls: string[] = [];
    page.on("response", (r) => {
      const u = r.url();
      if (/\/api\/|\.json|\.ashx|DataHandler|List/i.test(u)) calls.push(`${r.status()} ${u}`);
    });
    await page.goto(TARGETS[1], { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    rungs.push({
      rung: 7, what: "the page's own network calls", url: TARGETS[1],
      status: calls.length ? 200 : "none observed", bytes: 0,
      isTheThing: calls.length > 0,
      note: calls.length ? calls.slice(0, 8).join(" | ") : "no data endpoints observed",
      attemptedAt: AS_OF,
    });
  }
} finally {
  await browser.close();
}

/* ── Rung 11: the Internet Archive, which no edge filter governs ──────────── */
for (const url of TARGETS.slice(0, 2)) {
  try {
    const api = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
    const res = await fetch(api);
    const j = (await res.json()) as { archived_snapshots?: { closest?: { url?: string; timestamp?: string } } };
    const snap = j.archived_snapshots?.closest;
    rungs.push({
      rung: 11, what: "the Internet Archive", url, status: res.status, bytes: 0,
      isTheThing: Boolean(snap?.url),
      note: snap?.url ? `snapshot ${snap.timestamp}: ${snap.url}` : "no snapshot",
      attemptedAt: AS_OF,
    });
  } catch (err) {
    rungs.push({
      rung: 11, what: "the Internet Archive", url, status: "ERROR", bytes: 0, isTheThing: false,
      note: String((err as Error)?.message ?? err), attemptedAt: AS_OF,
    });
  }
}

/* ── Report ───────────────────────────────────────────────────────────────── */

console.log(`nh-cfs-ladder · cfs.sos.nh.gov, walked ${AS_OF}\n`);
for (const r of rungs) {
  console.log(
    `  rung ${String(r.rung).padStart(2)}  ${r.isTheThing ? "REACHED " : "refused "} ` +
      `${String(r.status).padStart(7)}  ${String(r.bytes).padStart(7)}b  ${r.url}`,
  );
  console.log(`          ${r.what} — ${r.note.slice(0, 150)}`);
}

const reached = rungs.filter((r) => r.isTheThing);
console.log(`\n  rungs walked ${rungs.length} · REACHED THE DOCUMENT on ${reached.length}`);
if (reached.length === 0) {
  console.log(
    "\n  Every rung walked above returned a refusal. That is a WALL WITH A DATE AND A\n" +
      "  RUNG HISTORY, not a finding about New Hampshire's records — the records exist\n" +
      "  and are public. The next branches are named in the session report.",
  );
}

writeFileSync(
  join(ROOT, "data/hunt/nh-cfs-ladder.json"),
  `${JSON.stringify({ host: "cfs.sos.nh.gov", walkedAt: AS_OF, rungs }, null, 1)}\n`,
  "utf8",
);
console.log(`\n  wrote data/hunt/nh-cfs-ladder.json`);
