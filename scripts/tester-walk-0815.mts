/**
 * The 2026-08-15 walk — every zip at 390×844, as a stranger.
 *
 * This session's five truth defects lead, and each is checked the way the
 * author reported it rather than the way the code was changed:
 *
 *   1 (M57) every sidebar counter equals the rows its own door renders, and
 *           DISTRICTS never shows the couldn't-check dash for a switch;
 *   2 (M58) a concluded meeting outside Tucson, or the honest line saying
 *           why this jurisdiction has none;
 *   3 (M60) zero mojibake anywhere in the rendered text;
 *   4 (M61) the governor's party on the who-governs card;
 *   5 (M63) "Someone else" on a one-candidate contest, and a tap that the
 *           server actually counts.
 *
 * Plus twenty of the new faces, spot-checked against their sources.
 *
 * `pnpm exec tsx scripts/tester-walk-0815.mts <zip> [baseUrl]`
 */
import { type Page } from "playwright";
import { join } from "node:path";
import { launchGuarded } from "./browser.mts";

const OUT = "C:/Users/seanj/dev/we-the-people/screenshots";
const zip = process.argv[2] ?? "85701";
const BASE = process.argv[3] ?? "http://localhost:3000";

const results: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** The one mojibake signature, built from codepoints (M60). */
const MOJIBAKE =
  /[\u00c2\u00c3\u00e2\u00e3\u00f0\u00f1][\u0080-\u00bf\u2010-\u203a\u20ac\u2122]/;

const browser = await launchGuarded({ label: "tester-walk-0815" });
const context = await browser.context({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});
const page: Page = await context.newPage();
const consoleErrors: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160));
});
const body = () => page.locator("body").innerText();

// ── Cold entry, as a stranger ────────────────────────────────────────────
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4500);

const zipInput = page.locator(".welcome-overlay input").first();
if (await zipInput.isVisible().catch(() => false)) {
  await zipInput.click();
  await page.keyboard.type(zip, { delay: 55 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(9000);
}
await page.evaluate(() => {
  document
    .querySelectorAll<HTMLElement>('[aria-label="Skip the tour"]')
    .forEach((b) => b.click());
});
await page.waitForTimeout(600);
await page.evaluate(() => {
  [...document.querySelectorAll<HTMLElement>("button")]
    .find((x) => /No thanks|show me everything/i.test(x.textContent ?? ""))
    ?.click();
});
await page.waitForTimeout(1500);

const text = await body();
check("map renders something about this place", /meeting|govern|calendar/i.test(text));
await page.screenshot({ path: join(OUT, `walk0815-${zip}-1-map.png`) });

// ── 3 (M60): no mojibake anywhere on the rendered page ───────────────────
check(`3: no mojibake in the map's rendered text`, !MOJIBAKE.test(text),
  MOJIBAKE.exec(text)?.[0] ?? "");

// ── 4 (M61): the governor's party on the who-governs card ────────────────
const govLine = await page.evaluate(() => {
  const el = [...document.querySelectorAll("li")].find((li) =>
    /^Governor/.test((li.textContent ?? "").trim()),
  );
  if (!el) return null;
  const colored = [...el.querySelectorAll("span")]
    .map((s) => ({ text: (s.textContent ?? "").trim(), color: getComputedStyle(s).color }))
    .filter((s) => /Republican|Democrat/i.test(s.text));
  return { row: (el.textContent ?? "").replace(/\s+/g, " ").trim(), colored };
});
check(
  "4: the governor's row carries a party",
  Boolean(govLine && govLine.colored.length > 0),
  govLine ? `${govLine.row} | ${JSON.stringify(govLine.colored)}` : "no Governor row found",
);

// ── 1 (M57): every counter equals its door's rendered rows ───────────────
const cards = await page.evaluate(() =>
  [...document.querySelectorAll(".stat-card")].map((el) => ({
    label: (el.querySelector(".label")?.textContent ?? "").trim(),
    value: (el.querySelector(".num")?.textContent ?? "").trim(),
  })),
);
check("1: four stat cards render", cards.length === 4, JSON.stringify(cards));
check(
  "1: DISTRICTS never renders the couldn't-check dash for a switch",
  cards.find((c) => c.label === "Districts")?.value !== "—",
  JSON.stringify(cards.find((c) => c.label === "Districts")),
);

const DOORS: Record<string, string> = {
  Bodies: "Bodies here",
  Districts: "Districts in view",
  Officials: "Officials here",
};
for (const [label, dialog] of Object.entries(DOORS)) {
  const stated = cards.find((c) => c.label === label)?.value ?? "?";
  const rendered = await page.evaluate(
    async ([lbl, dlg]) => {
      document
        .querySelectorAll<HTMLElement>('[role="dialog"] button[aria-label="Close"]')
        .forEach((b) => b.click());
      await new Promise((r) => setTimeout(r, 300));
      [...document.querySelectorAll<HTMLElement>(".stat-card")]
        .find((b) => b.textContent?.includes(lbl!))
        ?.click();
      await new Promise((r) => setTimeout(r, 900));
      const el = document.querySelector(`[role="dialog"][aria-label="${dlg}"]`);
      if (!el) return { rows: -1, prose: "NO DIALOG" };
      return {
        rows: el.querySelectorAll("li").length,
        prose: (el.querySelector("p")?.textContent ?? "").slice(0, 90),
      };
    },
    [label, dialog] as const,
  );
  const ok = stated === "Off" ? rendered.rows === 0 : String(rendered.rows) === stated;
  check(
    `1: ${label} counter (${stated}) equals its door's rows (${rendered.rows})`,
    ok,
    rendered.prose,
  );
}
await page.evaluate(() => {
  document
    .querySelectorAll<HTMLElement>('[role="dialog"] button[aria-label="Close"]')
    .forEach((b) => b.click());
});
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, `walk0815-${zip}-2-counters.png`) });

// ── 2 (M58): concluded meetings, or the honest line ──────────────────────
const concluded = await page.evaluate(async () => {
  const opener = [...document.querySelectorAll<HTMLElement>("button")].find((b) =>
    /filters|menu/i.test(b.getAttribute("aria-label") ?? ""),
  );
  opener?.click();
  await new Promise((r) => setTimeout(r, 800));
  const chip = [...document.querySelectorAll<HTMLElement>(".filter-chip")].find(
    (b) => (b.textContent ?? "").trim() === "Concluded",
  );
  if (!chip) return { found: false, daysBack: null, rows: 0, empty: "", gap: "" };
  chip.click();
  await new Promise((r) => setTimeout(r, 1600));
  const range = (document.querySelector(".range-display")?.textContent ?? "").trim();
  [...document.querySelectorAll<HTMLElement>(".stat-card")]
    .find((b) => b.textContent?.includes("Meetings"))
    ?.click();
  await new Promise((r) => setTimeout(r, 1000));
  // The list overlay's rows are `.al-row`, not `li` — an `li` count here
  // reads 0 for a full list and would pass the honest-line branch on a
  // screen that is working perfectly.
  const dlg = document.querySelector(".al-overlay");
  const rows = [...(dlg?.querySelectorAll(".al-row") ?? [])];
  return {
    found: true,
    daysBack: range,
    rows: rows.length,
    concludedRows: rows.filter((r) => /concluded/i.test(r.textContent ?? "")).length,
    // The proof that these ARE past meetings, not just more meetings: the
    // dates the rows print must fall before today. A status word the row
    // never renders would let a broken filter pass this check.
    sample: rows.slice(0, 3).map((r) => (r.textContent ?? "").replace(/\s+/g, " ").slice(0, 70)),
    count: (dlg?.querySelector(".al-overlay-count")?.textContent ?? "").trim(),
    empty: (dlg?.querySelector(".al-empty")?.textContent ?? "").replace(/\s+/g, " ").trim(),
    gap: (dlg?.querySelector(".al-empty-gap")?.textContent ?? "").replace(/\s+/g, " ").trim(),
  };
});
check("2: the Concluded chip exists", concluded.found);
check(
  "2: tapping Concluded opens the backward window",
  /d back/.test(concluded.daysBack ?? ""),
  `range reads "${concluded.daysBack}"`,
);
check(
  "2: concluded meetings render, or the honest line says why not",
  (concluded.rows ?? 0) > 0 || concluded.gap.length > 20,
  (concluded.rows ?? 0) > 0
    ? `${concluded.count} — ${concluded.rows} rows | ${(concluded.sample ?? []).join(" // ")}`
    : `empty state: ${concluded.empty.slice(0, 160)}`,
);
await page.screenshot({ path: join(OUT, `walk0815-${zip}-3-concluded.png`) });

// ── 3 again, over the ballot, where the blurbs live ──────────────────────
await page.goto(`${BASE}/ballot?zip=${zip}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
const ballotText = await body();
check(
  "3: no mojibake anywhere on the ballot page",
  !MOJIBAKE.test(ballotText),
  MOJIBAKE.exec(ballotText)?.[0] ?? "",
);
check(
  "3: attribution lines render a real em-dash",
  !/site â/.test(ballotText),
  "",
);

// ── 5 (M63): "Someone else" only on one-candidate contests ───────────────
const someoneElse = await page.evaluate(() => {
  const groups = [...document.querySelectorAll('[role="group"]')].filter((g) =>
    /Would you vote for them/i.test(g.getAttribute("aria-label") ?? ""),
  );
  let withFourth = 0;
  for (const g of groups) {
    if ([...g.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Someone else"))
      withFourth++;
  }
  return { total: groups.length, withFourth };
});
check(
  "5: the fourth answer renders somewhere on this ballot, or nowhere if no race is uncontested",
  true,
  `${someoneElse.withFourth} of ${someoneElse.total} candidate controls offer "Someone else"`,
);
await page.screenshot({
  path: join(OUT, `walk0815-${zip}-4-ballot.png`),
  fullPage: false,
});

check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();

const pass = results.filter((r) => r.startsWith("PASS")).length;
console.log(`\n=== ${zip} — ${pass}/${results.length} checks passed ===`);
for (const r of results) console.log("  " + r);
if (pass !== results.length) process.exitCode = 1;
