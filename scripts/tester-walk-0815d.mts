/**
 * The money-story walk (session 0815d) — 390x844, the phone the tester uses.
 *
 * What it proves, in pixels rather than in a passing unit test:
 *  - the funding section sorted by money, grouped by kind, transfers folded;
 *  - one "Give me the tea" expansion, end to end;
 *  - the Nicholson-class raw sentence in place of a percentage;
 *  - the polling-place pointer, per state.
 *
 * Screenshots land in scripts/shots-0815d/. Every check prints PASS/FAIL
 * with what it looked for, so a silent pass is impossible.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.WALK_BASE ?? "http://localhost:3000";
const OUT = "scripts/shots-0815d";
mkdirSync(OUT, { recursive: true });

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});

console.log(`\n=== the ballot page, ${BASE} ===`);
await page.goto(`${BASE}/ballot?zip=07866`, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(1500);

const body = await page.evaluate(() => document.body.innerText);

// --- item 6: the polling-place pointer ------------------------------------
check(
  "item 6: the polling-place pointer renders",
  body.includes("Find your polling place"),
);
check(
  "item 6: it says what the tool will ask for",
  /name, date of birth and county|driver's licence|Search by address/i.test(body),
);

// --- item 2: the funding section, sorted and grouped ----------------------
const funding = await page.evaluate(() => {
  const heads = [...document.querySelectorAll("p")].filter((p) =>
    /Largest reported contributions/.test(p.textContent ?? ""),
  );
  if (heads.length === 0) return null;
  const block = heads[0].closest("div")!;
  const groups = [...block.querySelectorAll("[data-contributor-group]")].map((g) => ({
    title: g.getAttribute("data-contributor-group"),
    amounts: [...g.querySelectorAll("[data-contributor-amount]")].map((li) =>
      Number(li.getAttribute("data-contributor-amount")),
    ),
  }));
  const folded = [...block.querySelectorAll("[data-collapsed-filings]")].map((d) =>
    (d.querySelector("summary")?.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
  const tea = [...block.querySelectorAll("[data-second-hop]")].length;
  return { groups, folded, tea, text: block.innerText.slice(0, 400) };
});

if (!funding) {
  check("item 2: a funding section is on the page", false, "no section found");
} else {
  check("item 2: both money columns render", funding.groups.length === 2,
    funding.groups.map((g) => g.title).join(" + "));
  for (const g of funding.groups) {
    const sorted = g.amounts.every((v, i, a) => i === 0 || a[i - 1] >= v);
    check(`item 2: ${g.title} sorted by amount descending`, sorted,
      g.amounts.slice(0, 4).map((a) => `$${a.toLocaleString()}`).join(" > "));
  }
  check("item 2: repeated filings fold into a counted row", funding.folded.length > 0,
    funding.folded[0] ?? "none");
  check("item 3: a 'Give me the tea' expander exists", funding.tea > 0,
    `${funding.tea} committee row(s)`);
}

// --- item 3: open the tea, end to end -------------------------------------
const teaHandle = await page.$("[data-second-hop] summary");
if (teaHandle) {
  await teaHandle.click();
  await page.waitForTimeout(500);
  const opened = await page.evaluate(() => {
    const d = document.querySelector("[data-second-hop][open]");
    return d ? (d as HTMLElement).innerText.replace(/\s+/g, " ").slice(0, 300) : null;
  });
  check("item 3: the tea opens and names the FUND, not the campaign",
    !!opened && /Who gives to/.test(opened), opened?.slice(0, 90) ?? "did not open");
  check("item 3: the panel says whose donors these are not",
    !!opened && /not this campaign/.test(opened));
  const el = await page.$("[data-second-hop][open]");
  if (el) await el.screenshot({ path: `${OUT}/tea-expanded.png` });
} else {
  check("item 3: a tea expander was clickable", false, "no summary found");
}

const section = await page.$("p:has-text('Largest reported contributions')");
if (section) {
  const card = await page.evaluateHandle(
    (p) => (p as HTMLElement).closest("div"),
    section,
  );
  await (card.asElement() as never as { screenshot: (o: unknown) => Promise<void> })
    .screenshot({ path: `${OUT}/funding-sorted.png` });
}

// --- item 4: the honesty floor --------------------------------------------
console.log(`\n=== the honesty floor, NH-02 ===`);
await page.goto(`${BASE}/ballot?zip=03255`, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(1500);
const nh = await page.evaluate(() => document.body.innerText);
check(
  "item 4: the raw sentence renders for a tiny raise",
  /came from small unitemized gifts/.test(nh),
);
const nicholsonPct = /Dan Nicholson[\s\S]{0,900}?% of the money came from small donors/.test(nh);
check("item 4: no percentage on the tiny-raise card", !nicholsonPct);
check(
  "item 4: a real raise keeps its percentage",
  /% of the money came from small donors/.test(nh),
);
await page.screenshot({ path: `${OUT}/nh-ballot.png`, fullPage: false });

await browser.close();
console.log(`\n${pass} passed, ${fail} failed. Shots in ${OUT}/`);
process.exit(fail > 0 ? 1 : 0);
