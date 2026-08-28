import { writeFileSync } from "node:fs";

import { launchGuarded } from "./browser.mts";

/**
 * **THE CONTROL: DOES THE READER READ?** (2026-08-28.)
 *
 * `scripts/hunt-vail-novus.mts` walked eight date windows on Vail's Novus
 * tenant. Every one of them was ACCEPTED — the portal echoed back exactly the
 * dates it was asked for, which is the thing the previous session's hand-built
 * POST could never get it to do — and every one returned zero rows.
 *
 * A zero from a query that ran is a completely different claim from a zero from
 * a query that was refused, and this project may only make the first one after
 * proving the instrument works. **A reader that returns zero because its
 * selector is wrong returns zero on every tenant in the world**, and it would
 * read, in a report, exactly like a district that publishes nothing.
 *
 * So the same code walks OTHER NovusAGENDA tenants. If a control tenant returns
 * rows, the reader reads and Vail's zero is Vail's. If every tenant returns
 * zero, the reader is broken and Vail's zero says nothing at all — and the
 * route goes back to `REQUIRES_NEW_ADAPTER` rather than to an absence.
 *
 * Permission is checked per host before anything is read.
 */

const OUT = process.argv[2] ?? "data/hunt/novus-control.json";

/**
 * Candidate tenants, on the vendor's own subdomain pattern.
 *
 * These are guesses at PUBLIC portals and are treated as such: a host that does
 * not resolve, or whose robots.txt disallows, contributes nothing and is
 * recorded as contributing nothing.
 */
const TENANTS = [
  "hillsboroughcounty",
  "cityofmesaaz",
  "pinalcountyaz",
  "cityofsanmateo",
  "brevardcounty",
];

const guarded = await launchGuarded({
  label: "novus-control",
  now: () => new Date("2026-08-28T00:00:00Z"),
});
const page = await guarded.page();

const results: Record<string, unknown>[] = [];

const readMeetings = async () =>
  (await page.evaluate(
    `Array.from(document.querySelectorAll("table")).reduce(function (acc, t) {
      var head = t.rows[0] ? (t.rows[0].textContent || "") : "";
      if (!/Meeting Date/.test(head)) return acc;
      return acc.concat(Array.prototype.slice.call(t.rows, 1).map(function (tr) {
        return (tr.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200);
      }));
    }, []).filter(function (r) { return r.length > 0; })`,
  )) as string[];

for (const tenant of TENANTS) {
  const base = `https://${tenant}.novusagenda.com/agendapublic`;
  const entry: Record<string, unknown> = { tenant, base };
  try {
    /* PERMISSION FIRST, per host, before a single page is read. */
    const robots = await page.request.get(`https://${tenant}.novusagenda.com/robots.txt`, {
      timeout: 20_000,
    });
    const robotsBody = robots.status() === 200 ? (await robots.text()).slice(0, 400) : null;
    entry.robots = { status: robots.status(), body: robotsBody };
    if (robotsBody && /Disallow:\s*\/\s*$/m.test(robotsBody)) {
      entry.skipped = "blanket disallow — not read";
      results.push(entry);
      continue;
    }

    const opened = await page.goto(`${base}/MeetingsResponsive.aspx`, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });
    entry.status = opened?.status() ?? null;
    entry.title = await page.title();
    entry.defaultRows = (await readMeetings()).length;

    await page.selectOption("#ctl00_ContentPlaceHolder1_ddlDateRange", { label: "Last Year" });
    await page.waitForTimeout(500);
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {}),
      page.click("#ctl00_ContentPlaceHolder1_btnSearch"),
    ]);
    await page.waitForTimeout(1500);

    const rows = await readMeetings();
    entry.lastYearRows = rows.length;
    entry.sample = rows.slice(0, 5);
  } catch (error) {
    entry.threw = error instanceof Error ? error.message.slice(0, 200) : String(error);
  }
  results.push(entry);
}

await guarded.close();
writeFileSync(OUT, JSON.stringify({ results }, null, 2), "utf8");
for (const r of results) {
  console.log(
    `${String(r.tenant).padEnd(18)} status=${r.status ?? "-"} default=${r.defaultRows ?? "-"} lastYear=${r.lastYearRows ?? "-"} ${r.threw ? `THREW ${String(r.threw).slice(0, 60)}` : ""}${r.skipped ? String(r.skipped) : ""}`,
  );
}
console.log(`\nwritten to ${OUT}`);
