import { writeFileSync } from "node:fs";

import { launchGuarded } from "./browser.mts";

/**
 * **THE VAIL AGENDA HUNT — rung 6, the branch the last session named and could
 * not walk.** (2026-08-28.)
 *
 * ## Where this picks up
 *
 * `data/method/knowledge.json` route `novusagenda-public-portal-viewstate-search`
 * records exactly what was tried and exactly how it failed: a bare viewstate
 * POST to `MeetingsResponsive.aspx` carrying `__VIEWSTATE`,
 * `__VIEWSTATEGENERATOR`, `__EVENTVALIDATION`, the session cookie, `btnSearch`
 * and a 2015-2026 window returned HTTP 200, 35,442 bytes, **zero MeetingID
 * links, and a date range reset to the portal's own defaults**.
 *
 * The reset is the diagnosis and it is why that was recorded as a FAILED
 * extraction rather than as an empty portal (RULING 100): the parameters were
 * never applied, so the search never ran over the window that was asked for. A
 * zero-row result from a query that did not accept its own query is not
 * evidence about what a government publishes.
 *
 * ## What reading the page rather than assuming it produced
 *
 * The date TEXT BOXES are `disabled` - Playwright refused to click one, which
 * is exactly why the hand-built POST could set `hfFromDate` and watch it be
 * ignored. The control a person actually uses is a `<select>`:
 *
 * ```
 *   ctl00$ContentPlaceHolder1$ddlDateRange
 *     Last Month - Last 6 Months - Last Year - Next Month - Next 6 Months
 *     Next Year - 6 Month Span - 12 Month Span - Custom Date Range
 * ```
 *
 * The window is chosen by NAME and the server computes the dates. The hidden
 * fields are OUTPUTS of that dropdown rather than inputs to the search, which
 * is the whole reason setting them did nothing.
 *
 * ## Permission
 *
 * `vailschools.novusagenda.com/robots.txt` is HTTP 404. A 404 is the host
 * publishing NO restriction, which is a definite permission answer rather than
 * a `CANNOT_TELL`. Nothing here circumvents anything: it opens the public
 * portal the district's own website links to and operates the controls a
 * member of the public operates. The two vendors that DO disallow - Highbond
 * and BoardDocs - are not touched by this script and must not be.
 *
 * ## What it writes
 *
 * A JSON report. It ingests nothing on its own: a route that works becomes an
 * adapter under `lib/sources/`, which is a separate and deliberate step.
 */

const BASE = "https://vailschools.novusagenda.com/agendapublic";
const OUT = process.argv[2] ?? "data/hunt/vail-novus.json";
/** Supplied, never guessed - an agent does not know today's date. */
const STAMP = process.argv[3] ?? "unstamped";

/**
 * Every window the dropdown offers, walked in turn.
 *
 * All of them rather than the widest, because *"the widest returned nothing"*
 * and *"every window returned nothing"* are different findings and only the
 * second is worth anything. If a narrow window returns rows where a wide one
 * does not, that is a portal defect worth recording rather than an absence
 * worth believing.
 */
const WINDOWS = [
  "Last Year",
  "Next Year",
  "12 Month Span",
  "Last 6 Months",
  "Next 6 Months",
  "6 Month Span",
  "Last Month",
  "Next Month",
];

const guarded = await launchGuarded({
  label: "vail-novus-hunt",
  now: () => new Date("2026-08-28T00:00:00Z"),
});
const page = await guarded.page();

const report: Record<string, unknown> = { stamp: STAMP, base: BASE, windows: [] };
const walked = report.windows as Record<string, unknown>[];

const readWindow = () =>
  page.evaluate(
    `({
      from: (document.getElementById("ctl00_ContentPlaceHolder1_hfFromDate") || {}).value || null,
      to: (document.getElementById("ctl00_ContentPlaceHolder1_hfToDate") || {}).value || null,
      selected: (document.getElementById("ctl00_ContentPlaceHolder1_ddlDateRange") || {}).value || null
    })`,
  );

/**
 * The meetings table's data rows.
 *
 * Through `evaluate` with an EXPRESSION rather than a named function: `tsx`
 * wraps named functions in an esbuild `__name` helper the page does not have,
 * so a callback that reads fine here throws in the browser.
 */
const readMeetings = async () =>
  (await page.evaluate(
    `Array.from(document.querySelectorAll("table")).reduce(function (acc, t) {
      var head = t.rows[0] ? (t.rows[0].textContent || "") : "";
      if (!/Meeting Date/.test(head)) return acc;
      return acc.concat(Array.prototype.slice.call(t.rows, 1).map(function (tr) {
        return {
          text: (tr.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 300),
          links: Array.prototype.slice.call(tr.querySelectorAll("a"))
            .map(function (a) { return a.getAttribute("href"); })
            .filter(Boolean)
        };
      }));
    }, []).filter(function (r) { return r.text.length > 0; })`,
  )) as { text: string; links: string[] }[];

try {
  const opened = await page.goto(`${BASE}/MeetingsResponsive.aspx`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  report.opened = { status: opened?.status() ?? null, title: await page.title() };

  /* The portal's OWN default window, before anything is asked of it. */
  report.defaultWindow = await readWindow();
  report.defaultGrid = await readMeetings();

  for (const label of WINDOWS) {
    try {
      await page.selectOption("#ctl00_ContentPlaceHolder1_ddlDateRange", { label });
      await page.waitForTimeout(600);
      await Promise.all([
        page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {}),
        page.click("#ctl00_ContentPlaceHolder1_btnSearch"),
      ]);
      await page.waitForTimeout(1500);

      const rows = await readMeetings();
      const anchors = (await page.evaluate(
        `Array.prototype.slice.call(document.querySelectorAll("a[href]"))
          .map(function (a) { return a.getAttribute("href"); })
          .filter(function (h) { return h && /MeetingID|Agenda|Minutes/i.test(h); })
          .slice(0, 40)`,
      )) as string[];

      walked.push({
        window: label,
        /* The ECHOED window, because the last attempt's whole finding was that
           the portal reset it. Reporting what came back is what distinguishes
           an empty portal from a refused query. */
        echoed: await readWindow(),
        rowCount: rows.length,
        rows,
        anchors,
      });
    } catch (error) {
      /* One window that throws is one window that threw. It is recorded and the
         walk continues - a single failure never ends a hunt. */
      walked.push({
        window: label,
        threw: error instanceof Error ? error.message : String(error),
      });
    }
  }
} catch (error) {
  report.threw = error instanceof Error ? error.message : String(error);
} finally {
  await guarded.close();
}

writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
console.log(`written to ${OUT}`);
