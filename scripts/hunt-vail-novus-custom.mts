import { writeFileSync } from "node:fs";

import { launchGuarded } from "./browser.mts";

/**
 * **THE CONTROL, RUN ON VAIL'S OWN TENANT.** (2026-08-28.)
 *
 * Eight preset windows on `vailschools.novusagenda.com` were ACCEPTED — the
 * portal echoed back exactly the dates asked for, which the previous session's
 * hand-built POST could never make it do — and all eight returned zero rows.
 *
 * That is only worth something if the reader can read. Five candidate control
 * tenants were tried and all five are wildcard hosts answering *"Error: An HTTP
 * error occurred"* with no search form at all, so they proved nothing in either
 * direction and are recorded as proving nothing.
 *
 * The control that IS available is on this tenant: **Custom Date Range**, which
 * enables the disabled text boxes and lets the window go back far enough to
 * cover anything the portal has ever held. NH229 claimed this portal "carries
 * everything before 2017-03-14"; that claim is UNVERIFIED and this is the walk
 * that either verifies it or leaves it unverified.
 *
 * Two outcomes, and they are different claims:
 *
 * - **Rows over a wide historical window.** The reader reads. The recent zero
 *   is then a fact about what the district has published to THIS vendor, and
 *   the route stops being `REQUIRES_NEW_ADAPTER`.
 * - **Zero everywhere.** The reader is unproven, the recent zero says nothing,
 *   and the route stays open. An unproven instrument's zero is never written
 *   down as an absence.
 */

const BASE = "https://vailschools.novusagenda.com/agendapublic";
const OUT = process.argv[2] ?? "data/hunt/vail-novus-custom.json";

const guarded = await launchGuarded({
  label: "vail-novus-custom",
  now: () => new Date("2026-08-28T00:00:00Z"),
});
const page = await guarded.page();

const report: Record<string, unknown> = { base: BASE, attempts: [] };
const attempts = report.attempts as Record<string, unknown>[];

const readMeetings = async () =>
  (await page.evaluate(
    `Array.from(document.querySelectorAll("table")).reduce(function (acc, t) {
      var head = t.rows[0] ? (t.rows[0].textContent || "") : "";
      if (!/Meeting Date/.test(head)) return acc;
      return acc.concat(Array.prototype.slice.call(t.rows, 1).map(function (tr) {
        return (tr.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 240);
      }));
    }, []).filter(function (r) { return r.length > 0; })`,
  )) as string[];

const readItems = async () =>
  (await page.evaluate(
    `Array.from(document.querySelectorAll("table")).reduce(function (acc, t) {
      var head = t.rows[0] ? (t.rows[0].textContent || "") : "";
      if (!/Date\\s*Title\\s*Item/.test(head.replace(/\\s+/g, " "))) return acc;
      return acc.concat(Array.prototype.slice.call(t.rows, 1).map(function (tr) {
        return (tr.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 240);
      }));
    }, []).filter(function (r) { return r.length > 0; })`,
  )) as string[];

try {
  await page.goto(`${BASE}/MeetingsResponsive.aspx`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });

  /* ── Custom Date Range, which is what enables the text boxes ─────────── */
  await page.selectOption("#ctl00_ContentPlaceHolder1_ddlDateRange", { label: "Custom Date Range" });
  await page.waitForTimeout(1200);

  const enabled = (await page.evaluate(
    `({
      from: !document.getElementById("ctl00_ContentPlaceHolder1_txtCalendarFrom").disabled,
      to: !document.getElementById("ctl00_ContentPlaceHolder1_txtCalendarTo").disabled
    })`,
  )) as { from: boolean; to: boolean };
  attempts.push({ step: "Custom Date Range selected", inputsEnabled: enabled });

  for (const [from, to] of [
    ["1/1/2010", "12/31/2027"],
    ["1/1/2015", "12/31/2017"],
    ["1/1/2024", "12/31/2026"],
  ]) {
    try {
      await page.fill("#ctl00_ContentPlaceHolder1_txtCalendarFrom", "");
      await page.fill("#ctl00_ContentPlaceHolder1_txtCalendarFrom", from);
      await page.press("#ctl00_ContentPlaceHolder1_txtCalendarFrom", "Tab");
      await page.fill("#ctl00_ContentPlaceHolder1_txtCalendarTo", "");
      await page.fill("#ctl00_ContentPlaceHolder1_txtCalendarTo", to);
      await page.press("#ctl00_ContentPlaceHolder1_txtCalendarTo", "Tab");
      await page.waitForTimeout(400);

      await Promise.all([
        page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {}),
        page.click("#ctl00_ContentPlaceHolder1_btnSearch"),
      ]);
      await page.waitForTimeout(2000);

      const echoed = await page.evaluate(
        `({
          from: (document.getElementById("ctl00_ContentPlaceHolder1_hfFromDate") || {}).value || null,
          to: (document.getElementById("ctl00_ContentPlaceHolder1_hfToDate") || {}).value || null
        })`,
      );
      const meetings = await readMeetings();
      const items = await readItems();
      attempts.push({
        step: `custom ${from} - ${to}`,
        echoed,
        meetingRows: meetings.length,
        meetings: meetings.slice(0, 20),
        itemRows: items.length,
        items: items.slice(0, 10),
      });
    } catch (error) {
      attempts.push({
        step: `custom ${from} - ${to}`,
        threw: error instanceof Error ? error.message.slice(0, 300) : String(error),
      });
    }
  }

  /* The page's own words at the end, because "No records to display" is the
     portal telling us something and it belongs in the record verbatim. */
  report.finalText = String(await page.evaluate(`document.body.innerText`)).slice(0, 1500);
} catch (error) {
  report.threw = error instanceof Error ? error.message : String(error);
} finally {
  await guarded.close();
}

writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2).slice(0, 5000));
