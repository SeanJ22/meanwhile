import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { parse } from "yaml";
import tailwindcss from "@tailwindcss/postcss";
import { launchGuarded } from "../scripts/browser.mts";
import { normalizeCongressDirectory } from "../lib/officials/congress-normalize.ts";
import { indexByOfficeholderId } from "../lib/officials/lookup.ts";
import { groupByVenue, placelessSittingsOfVenueBodies } from "../lib/meetings/venues.ts";
import type { Meeting } from "../lib/sources/types.ts";

const tusd = "ocd-division/country:us/state:az/school_district:tucson_unified_district";
const recorded = JSON.parse(readFileSync("tests/fixtures/ui-01-tusd-reader-promotion.json", "utf8")) as { generatedAt: string; meetings: Meeting[]; commentAccess: unknown[] };
const meetings = recorded.meetings.filter(meeting => meeting.ocdId === tusd);
const venue = groupByVenue(meetings).find(row => row.name === "Duffy Community Center, Multipurpose Room")!;
const placeless = placelessSittingsOfVenueBodies(venue, meetings);
const shown = [...venue.meetings, ...placeless];
const congress = JSON.parse(readFileSync("tests/fixtures/ui-01-congress-legislators-hinson.json", "utf8")) as {
  revision: string; retrievedAt: string; yaml: Record<string, string>;
};
const projection = normalizeCongressDirectory(Object.fromEntries(Object.entries(congress.yaml).map(([file, yaml]) => [file, parse(yaml)])), congress.revision, congress.retrievedAt);
const holder = indexByOfficeholderId([projection.roster]).get("congress:H001091")!;
const midnightSource = recorded.meetings.find(meeting => meeting.provenance.collectedAt === "2026-09-24T05:55:08.378Z")!.provenance;

test("real held venue and congress cards keep missing info in sections and sources at the foot", async () => {
  // Preserve the observed 41/21 production response; do not manufacture the
  // earlier 42/19 sample. Use the same venue and placeless grouping as the map.
  assert.equal(meetings.length, 41);
  assert.equal(meetings.filter(meeting => meeting.agendaUrl === null).length, 21);
  assert.equal(shown.length, 36);
  assert.equal(shown.filter(meeting => meeting.agendaUrl === null).length, 18);
  assert.equal(shown.filter(meeting => meeting.online && !meeting.online.joinUrl).length, 19);
  assert.equal(holder.provenance?.verifiedAt, null);
  assert.ok(holder.fieldSources?.districtOffices);
  const output = await build({
    stdin: { contents: `
      import React from "react"; import {createRoot} from "react-dom/client";
      import {ReaderCard} from "./components/shell/reader-card.tsx";
      import {MeetingPanel} from "./components/map/meeting-panel.tsx";
      import {OfficialModal} from "./components/map/popup/official-modal.tsx";
      import {DataProvider} from "./lib/state/data.tsx";
      import {CardSourcesList} from "./components/officials/card-sources-list.tsx";
      const meetings=${JSON.stringify(meetings)}, venue=${JSON.stringify(venue)}, placeless=${JSON.stringify(placeless)}, holder=${JSON.stringify(holder)};
      const official=location.pathname==="/official";
      const data={allMeetings:meetings, meetings, venues:[venue], result:null, location:null, drawnDistricts:[], dropped:0, searchFailed:false, atAddress:false, governing:new Set([${JSON.stringify(tusd)}]), zipPartial:null, basis:"ZIP", commentAccess:${JSON.stringify(recorded.commentAccess)}};
      const noop=()=>{};
      createRoot(document.getElementById("root")).render(location.pathname==="/source-clock"
        ? <CardSourcesList sources={[{what:"Meeting calendar",provenance:${JSON.stringify(midnightSource)}}]} />
        : <DataProvider value={data}>
        <ReaderCard viewKey={official?holder.id:venue.key} kicker={official?holder.name:"Tucson Unified School District"} backLabel={null} onBack={noop} onClose={noop}>
          {official ? <OfficialModal holder={holder} tier="national" seatLabel="IA-2" reactionContext={null} onClose={noop} embedded />
            : <MeetingPanel venue={venue} placeless={placeless} onClose={noop} embedded />}
        </ReaderCard>
      </DataProvider>);`, resolveDir: process.cwd(), sourcefile: "ui-01-card-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, outfile: ".scratch/ui-01-card-fixture.js", platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, logLevel: "silent",
  });
  const javascript = output.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const postcss = createRequire(import.meta.resolve("@tailwindcss/postcss"))("postcss");
  const globalStyles = await postcss([tailwindcss()]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" });
  const stylesheet = globalStyles.css + readFileSync("app/reader.css", "utf8") + (output.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "");
  const writes: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    const json = (value: unknown) => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
    if (request.url === "/fixture.js") response.writeHead(200, { "content-type": "application/javascript" }).end(javascript);
    else if (request.url === "/fixture.css") response.writeHead(200, { "content-type": "text/css" }).end(stylesheet);
    else if (request.url === "/venue" || request.url === "/official" || request.url === "/source-clock") response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
    else if (request.url?.startsWith("/api/directory?")) json({ ...projection.directory.byMember.H001091, source: projection.directory.source });
    else if (request.url === "/api/demand-signal") {
      let body = "";
      for await (const chunk of request) body += chunk;
      writes.push(JSON.parse(body));
      response.writeHead(204).end();
    // The fixture holds the directory only. Other optional holdings are
    // unavailable, exercising their actual missing-data paths without faking facts.
    } else response.writeHead(503, { "content-type": "application/json" }).end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "ui-01-real-source-cards" });
    const context = await browser.context({ viewport: { width: 900, height: 900 }, timezoneId: "America/New_York" });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => { errors.push(error.message); console.error(error.stack); });
    // Freeze the source response's date so its upcoming and past sections stay reproducible.
    await page.clock.setFixedTime(new Date(recorded.generatedAt));
    for (const mode of ["venue", "official"] as const) {
      const statementsResponse = mode === "official" ? page.waitForResponse(response => new URL(response.url()).pathname === `/api/profile/${encodeURIComponent(holder.id)}`) : null;
      await page.goto(`http://127.0.0.1:${address.port}/${mode}`);
      const card = page.locator("[data-reader-card]");
      await card.waitFor({ state: "visible" });
      for (const header of await card.locator(".card-section-header").all()) {
        if (await header.getAttribute("aria-expanded") === "false") await header.click();
        const pane = card.locator(`[id="${await header.getAttribute("aria-controls")}"]`);
        assert.ok((await pane.innerText()).trim(), `opening ${await header.innerText()} must reveal content`);
      }
      await card.locator("[data-card-gap]").first().waitFor({ state: "visible" });
      assert.ok(await card.getByText(/We[’']re working on getting this info/, { exact: true }).count() > 0);
      assert.ok(await card.getByRole("button", { name: "Want us to get this sooner?", exact: true }).count() > 0);
      assert.equal(await card.locator("[data-card-footer] [data-card-gap]").count(), 0, "missing facts stay out of the source footer");
      assert.equal(await card.locator("[data-card-sources]").count(), 1);
      assert.equal(await card.getByRole("button", { name: /^Sources/ }).count(), 1);
      assert.equal(await card.locator("[data-card-footer]").evaluate(footer => footer === footer.parentElement?.lastElementChild), true, "the shared footer follows every card section");
      assert.equal(await card.locator("[data-card-sources]").evaluate(source => source === source.parentElement?.lastElementChild), true, "Sources is the final footer section");
      assert.doesNotMatch(await card.innerText(), /Still gathering|committee-to-person|Roster term or appointment note/);
      if (mode === "venue") {
        assert.equal(await card.locator("[data-meeting-row]").count(), 36);
        assert.equal(await card.locator("[data-meeting-row] [data-card-gap]").count(), 0, "missing fields contribute once to the surrounding meeting section");
        const sectionCounts = await card.locator(".card-section, [data-meeting-section]").evaluateAll(sections => sections.map(section =>
          [...section.querySelectorAll("[data-card-gap]")].filter(gap => gap.closest(".card-section, [data-meeting-section]") === section && /working on getting this info/.test(gap.textContent ?? "")).length));
        assert.ok(sectionCounts.every(count => count <= 1), "each section has at most one working-on-it line");
        const clockMeeting = meetings.find(meeting => meeting.id === "diligent:tusd1:2026-10-19T1800-alternative-education-advisory")!;
        const row = card.locator(`[data-meeting-id="${clockMeeting.id}"]`);
        assert.equal(await row.locator("time").nth(1).innerText(), new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York", hour: "numeric", minute: "2-digit", timeZoneName: "short",
        }).format(new Date(clockMeeting.startsAt)), "the browser's Eastern clock displays the held Arizona meeting");
        assert.equal(await row.locator('[data-meeting-where="online"]').innerText(), "Online · Via Zoom Webinar");
        assert.equal(await row.getByRole("link", { name: "Meeting page", exact: true }).getAttribute("href"), "https://tusd1-schooldesk.community.diligentoneplatform.com/Portal/MeetingInformation.aspx?Org=Cal&Id=512");
        assert.ok(await card.locator(".how-to-be-heard").count() > 0);
        assert.equal(await card.locator(".how-to-be-heard [data-card-sources]").count(), 0);
        assert.equal(await card.locator("[data-meeting-row] [data-card-sources]").count(), 0);
        assert.ok(await row.locator("xpath=ancestor::section[1]").getByRole("button", { name: "Want us to get this sooner?", exact: true }).count() > 0);
      }
      if (mode === "official") {
        assert.equal((await statementsResponse!).status(), 503, "exercise the failed public-statements response");
        const statementsHeader = card.getByRole("button", { name: "Public statements", exact: true });
        const statementsGap = card.locator(`[id="${await statementsHeader.getAttribute("aria-controls")}"] [data-card-gap]`);
        await statementsGap.waitFor({ state: "visible" });
        assert.equal(await card.getByRole("button", { name: "Public statements", exact: true }).count(), 1, "the section stays present after the request fails");
        assert.equal(await statementsGap.evaluate(gap => gap.closest(".card-section")?.querySelector(".card-section-title")?.textContent), "Public statements", "the failed request belongs inside its section");
        assert.match(await statementsGap.innerText(), /working on getting this info/);
        assert.equal(await statementsGap.locator("[data-demand-subject]").getAttribute("data-demand-subject"), holder.id);
        for (const title of ["Committees", "Campaign money", "Voting record"]) {
          const header = card.getByRole("button", { name: title, exact: true });
          await header.waitFor({ state: "visible" });
          const pane = card.locator(`[id="${await header.getAttribute("aria-controls")}"]`);
          assert.match(await pane.innerText(), /working on getting this info/);
          assert.ok(await pane.getByRole("button", { name: "Want us to get this sooner?", exact: true }).count() > 0);
        }
        const offices = card.getByRole("button", { name: "Offices near you", exact: true });
        await card.getByText("Waterloo, IA", { exact: true }).waitFor({ state: "visible" });
        const officePane = card.locator(`[id="${await offices.getAttribute("aria-controls")}"]`);
        assert.equal(await officePane.locator("[data-card-gap]").count(), 0, "held offices never claim their facts are missing");
        assert.equal(await card.locator("[data-card-sources]").count(), 1);
      }
      const sourceHeader = card.getByRole("button", { name: /^Sources/ });
      if (await sourceHeader.getAttribute("aria-expanded") === "false") await sourceHeader.click();
      const sources = card.locator("[data-card-sources]");
      assert.doesNotMatch(await sources.innerText(), /Other\s*·|districtOffices|and \d+ more from this source|not yet|no published page|working on|Want us/i);
      if (mode === "official") {
        assert.match(await sources.innerText(), /District offices/);
        assert.doesNotMatch(await sources.innerText(), /official accounts|committee seats/i);
        assert.doesNotMatch(await sources.innerText(), /Verified/i);
        assert.match(await sources.innerText(), /Published by/i);
        assert.match(await sources.innerText(), /Read from/i);
        assert.match(await sources.innerText(), /Last checked/i);
        const urls = await sources.locator("a[href]").evaluateAll(links => links.map(link => link.getAttribute("href")));
        assert.equal(urls.length, 2, "identity and district offices cite their two native source files");
        assert.equal(new Set(urls).size, urls.length, "each held source URL appears once");
      }
      const pending = page.waitForResponse(response => response.url().endsWith("/api/demand-signal"));
      await card.getByRole("button", { name: "Want us to get this sooner?", exact: true }).first().click();
      await pending;
      await card.getByText("Noted.", { exact: true }).waitFor({ state: "visible" });
      assert.equal(writes.length, mode === "venue" ? 1 : 2);
      assert.equal(writes.at(-1)?.signal, "WANT_THIS_SOONER");
      assert.equal(writes.at(-1)?.subjectType, mode === "venue" ? "BODY" : "CANDIDATE");
      assert.equal(writes.at(-1)?.subjectId, mode === "venue" ? venue.meetings[0].bodyId : holder.id);
      assert.equal(typeof writes.at(-1)?.continuityKey, "string");
      assert.equal(typeof writes.at(-1)?.eventId, "string");
      mkdirSync(".scratch/ci", { recursive: true });
      await card.locator("[data-card-gap]").first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `.scratch/ci/ui-01-${mode}-sources.png` });
    }
    assert.deepEqual(errors, []);
    await context.close();
    const phoenix = await browser.context({ viewport: { width: 390, height: 844 }, timezoneId: "America/Phoenix" });
    const clockPage = await phoenix.newPage();
    await clockPage.goto(`http://127.0.0.1:${address.port}/source-clock`);
    const checked = clockPage.locator("[data-source-list] .popup-row").filter({ hasText: "Last checked" });
    await checked.waitFor({ state: "visible" });
    assert.equal(await checked.locator(".pv").innerText(), "September 23, 2026", "the actual saved 05:55 UTC source check falls on the reader's previous day in Phoenix");
    assert.equal(midnightSource.collectedAt, "2026-09-24T05:55:08.378Z", "the native source timestamp remains untouched");
    await phoenix.close();
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
