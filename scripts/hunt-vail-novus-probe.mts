import { writeFileSync } from "node:fs";

import { launchGuarded } from "./browser.mts";

/**
 * **WHAT THE NOVUS SEARCH PAGE ACTUALLY IS, read rather than assumed.**
 * (2026-08-28.)
 *
 * The first browser attempt found the date inputs and could not click one:
 * *"element is not enabled"*. That is a finding, not a wall — a Telerik date
 * picker renders a read-only text input driven by a calendar popup, so the
 * control a person uses is not the input a selector finds first.
 *
 * This dumps the form's real shape — every input with its id, type, disabled
 * and readonly state, every button, and the grid's own markup — so the next
 * step is chosen from what the page IS rather than from what an ASP.NET page
 * usually is. Reading the page's own data before guessing at its prose is the
 * lesson the Vail superintendent's name already taught this project once.
 */

const BASE = "https://vailschools.novusagenda.com/agendapublic";
const OUT = process.argv[2] ?? "data/hunt/vail-novus-probe.json";

const guarded = await launchGuarded({
  label: "vail-novus-probe",
  now: () => new Date("2026-08-28T00:00:00Z"),
});
const page = await guarded.page();

const report: Record<string, unknown> = {};
try {
  await page.goto(`${BASE}/MeetingsResponsive.aspx`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });

  report.controls = await page.evaluate(
    `Array.from(document.querySelectorAll("input, select, button, a[id]")).map((el) => ({
      tag: el.tagName,
      id: el.id || null,
      name: el.getAttribute("name"),
      type: el.getAttribute("type"),
      value: el.getAttribute("value"),
      disabled: el.hasAttribute("disabled"),
      readonly: el.hasAttribute("readonly"),
      visible: !!(el.offsetWidth || el.offsetHeight),
      text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60),
    })).filter((c) => c.id || c.name)`,
  );

  report.grids = await page.evaluate(
    `Array.from(document.querySelectorAll("table")).map((t) => ({
      id: t.id || null,
      rows: t.rows.length,
      firstRow: t.rows[0] ? (t.rows[0].textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200) : null,
    }))`,
  );

  report.bodyText = String(await page.evaluate(`document.body.innerText`)).slice(0, 3000);
  report.anchors = await page.evaluate(
    `Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href")).filter((h) => h && !h.startsWith("javascript") && !h.includes("WebResource")).slice(0, 60)`,
  );
} catch (error) {
  report.threw = error instanceof Error ? error.message : String(error);
} finally {
  await guarded.close();
}

writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
console.log(`written to ${OUT}`);
