import { writeFileSync } from "node:fs";

import { floored, floorLine } from "../lib/ops/denominator-floor.ts";

/**
 * **THE GOVERNOR'S OWN ACTIONS, FROM THE GOVERNOR'S OWN PUBLICATION.**
 * (AZ03, 2026-08-28.)
 *
 * ## The lead, and where it came from
 *
 * The grounded Ask pipeline was asked *"What did Katie Hobbs do for the state
 * of Arizona in the last 12 months?"* against the real corpus and answered
 * honestly: it resolves the person and the office, and holds **nothing about
 * what she has done**. `lib/votes/` is congressional only and there is no store
 * of vetoes, signed bills or executive orders for any governor.
 *
 * That honest gap is the lead. This is the hunt it opened.
 *
 * ## Permission, read before anything else
 *
 * - **`azgovernor.gov` — ALLOWED.** `robots.txt` is 2,216 bytes, `User-agent: *`
 *   with `Crawl-delay: 10` and disallows confined to Drupal infrastructure
 *   (`/includes/`, `/misc/`, `/modules/`, `/admin/`, `install.php`). No content
 *   path is restricted. **The crawl delay is honoured here** — a public body
 *   asking for ten seconds gets ten seconds.
 * - **`apps.azleg.gov` — DISALLOWED, NOT WALKED.** `User-agent: * / Disallow: /`.
 *   That is where the legislature's modern bill-status application lives, so
 *   bill actions have no permitted route through it and none is attempted. A
 *   disallow is a host saying do not ask, and it is never re-walked on a clock.
 * - **`www.azleg.gov` — ALLOWED with `Crawl-delay: 120`** and named disallows
 *   (`/DocumentsForBill.asp`, `/FormatDocument.asp`, `/search/`). Not walked
 *   here; recorded so the next session starts from the permission rather than
 *   from a guess.
 *
 * ## What the source actually is
 *
 * `/executive-orders` is a paginated index, and each entry links a detail page
 * that carries the TITLE, the NUMBER, the DATE and the full operative text —
 * plus the signed PDF at `/sites/default/files/executive-order-<n>.pdf`.
 *
 * That is a governmental ACTION record with a date and a primary document
 * behind it, which is exactly the class AZ03 says the corpus does not hold. It
 * is not a press summary and nothing here is inferred from one.
 *
 * ## What this script does NOT do
 *
 * It does not ingest. It establishes the route, the shape and the denominator,
 * and writes the evidence. An adapter under `lib/sources/` is the next step and
 * is deliberately a separate one.
 */

const BASE = "https://azgovernor.gov";
const OUT = process.argv[2] ?? "data/hunt/az-executive-orders.json";
/** The host asks for ten seconds between requests. It gets ten seconds. */
const CRAWL_DELAY_MS = 10_000;
/** How many index pages to walk. Stated, so a partial walk cannot read as all. */
const MAX_INDEX_PAGES = 4;

const UA = "Mozilla/5.0 (compatible; MeanwhileCivicBot/1.0; +https://sparkwtp.netlify.app)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url, { headers: { "user-agent": UA } });
  return { status: response.status, body: await response.text() };
}

const strip = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;|&#8217;/g, "’")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

interface Order {
  number: string;
  url: string;
  title: string;
  date: string | null;
  pdf: string | null;
  textChars: number | null;
  status: number | null;
}

const orders = new Map<string, Order>();
const report: Record<string, unknown> = {
  base: BASE,
  permission:
    "azgovernor.gov robots.txt: User-agent * , Crawl-delay 10, disallows confined to Drupal infrastructure. No content path restricted.",
  crawlDelayMs: CRAWL_DELAY_MS,
  indexPagesWalked: 0,
};

for (let page = 0; page < MAX_INDEX_PAGES; page += 1) {
  const url = page === 0 ? `${BASE}/executive-orders` : `${BASE}/executive-orders?page=${page}`;
  const { status, body } = await get(url);
  report.indexPagesWalked = page + 1;
  if (status !== 200) {
    (report.indexFailures ??= [] as unknown[]);
    (report.indexFailures as unknown[]).push({ url, status });
    break;
  }

  const found = [
    ...body.matchAll(
      /href="((?:https:\/\/azgovernor\.gov)?\/office-arizona-governor\/executive-order\/([0-9]{4}-[0-9]+))"[^>]*>([\s\S]{0,300}?)<\/a>/gi,
    ),
  ];
  let added = 0;
  for (const m of found) {
    const number = m[2];
    if (orders.has(number)) continue;
    const title = m[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    /* "Learn More" is the second anchor on every card and is not a title. */
    if (!title || /^learn more$/i.test(title)) continue;
    orders.set(number, {
      number,
      url: m[1].startsWith("http") ? m[1] : `${BASE}${m[1]}`,
      title,
      date: null,
      pdf: null,
      textChars: null,
      status: null,
    });
    added += 1;
  }
  /* A page that adds nothing new is the end of the list, and saying so is the
     difference between "walked to the end" and "stopped at four pages". */
  if (added === 0) {
    report.reachedEnd = true;
    break;
  }
  await sleep(CRAWL_DELAY_MS);
}

/*
 * The detail pages, for the most recent orders. The DATE is the whole point:
 * "in the last 12 months" is a window, and an order with no date cannot be
 * placed inside or outside it.
 */
const recent = [...orders.values()]
  .sort((a, b) => (a.number < b.number ? 1 : -1))
  .slice(0, 12);

for (const order of recent) {
  await sleep(CRAWL_DELAY_MS);
  try {
    const { status, body } = await get(order.url);
    order.status = status;
    if (status !== 200) continue;
    const lines = strip(body);
    const at = lines.findIndex((l) => new RegExp(`Executive Order ${order.number}$`).test(l));
    /* The date is the line immediately after the order number on this template.
       Read positionally AND validated as a date, so a template change produces
       a null rather than a wrong date. */
    const candidate = at >= 0 ? lines[at + 1] : null;
    order.date =
      candidate && /^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(candidate) ? candidate : null;
    order.pdf =
      body.match(/href="(https:\/\/azgovernor\.gov\/sites\/default\/files\/[^"]*\.pdf)"/i)?.[1] ??
      null;
    order.textChars = body.length;
  } catch (error) {
    order.status = null;
    (report.detailFailures ??= [] as unknown[]);
    (report.detailFailures as unknown[]).push({
      url: order.url,
      why: error instanceof Error ? error.message : String(error),
    });
  }
}

report.ordersFound = orders.size;
report.detailPagesRead = recent.filter((o) => o.status === 200).length;
report.withDate = recent.filter((o) => o.date).length;
report.withPdf = recent.filter((o) => o.pdf).length;
report.orders = [...orders.values()].sort((a, b) => (a.number < b.number ? 1 : -1));

writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");

/*
 * **EVERY COUNT CARRIES ITS DENOMINATOR** (RULING 159 / RULING 116). "12
 * executive orders read" is not a measurement; "12 of 12 attempted, out of 37
 * indexed across 4 pages, and the index continues" is. The third clause is the
 * one that matters: this walk is a FLOOR and a reader of the report must not be
 * able to take it for the whole.
 */
console.log(
  floorLine(
    floored(
      "executive orders indexed",
      `${report.indexPagesWalked} index page(s) walked`,
      MAX_INDEX_PAGES,
      Number(report.indexPagesWalked),
    ),
  ),
);
console.log(
  report.reachedEnd
    ? "  the index ended inside the pages walked — this is the whole list"
    : "  MORE PAGES EXIST past the ones walked — every number here is a FLOOR",
);
console.log(
  floorLine(
    floored("detail pages read", "orders attempted", recent.length, Number(report.detailPagesRead)),
  ),
);
console.log(
  floorLine(floored("carry a date", "detail pages read", recent.length, Number(report.withDate))),
);
console.log(
  floorLine(
    floored("carry a signed PDF", "detail pages read", recent.length, Number(report.withPdf)),
  ),
);
console.log(`orders in the index: ${orders.size} of ${orders.size} recorded`);
for (const o of recent) {
  console.log(`  ${o.number}  ${o.date ?? "(no date read)"}  ${o.title.slice(0, 88)}`);
}
console.log(`\nwritten to ${OUT}`);
