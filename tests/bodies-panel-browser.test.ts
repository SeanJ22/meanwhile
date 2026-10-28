import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";
import tailwindcss from "@tailwindcss/postcss";
import { launchGuarded } from "../scripts/browser.mts";
import { geometryFiles } from "../lib/holdings/discovery.ts";
import { resolveZip } from "../lib/geo/zcta.ts";
import { summarizeCoverage, type CoverageSummary } from "../lib/registry/coverage.ts";
import type { GeoFeature } from "../lib/registry/resolve.ts";
import type { Registry } from "../lib/registry/types.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { bodyDisplayName } from "../lib/text/reader-names.ts";
import { groupBodiesByGovernment } from "../lib/registry/body-groups.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

test("Bodies stays compact and opens the correct body with next and last meetings in AZ, NH and NJ", async () => {
  await installRegistryAuthority();
  const registry: Registry = JSON.parse(readFileSync("lib/registry/registry.json", "utf8"));
  const divisions = new Map(registry.divisions.map(division => [division.ocdId, division]));
  const features: GeoFeature[] = geometryFiles(process.cwd()).flatMap(file => JSON.parse(readFileSync(file, "utf8")).features);
  const recorded = JSON.parse(readFileSync("tests/fixtures/reader-upcoming-meetings-85701.json", "utf8")) as { meetings: Meeting[] };
  const regions: Record<string, { coverage: CoverageSummary; meetings: Meeting[] }> = {};
  const now = "2026-09-23T23:00:00.000Z";
  for (const zip of ["85701", "03255", "07960"]) {
    const resolved = resolveZip(zip);
    assert.ok(resolved.ok);
    const coverage = summarizeCoverage([resolved.centroid.lng, resolved.centroid.lat], features, divisions, registry.bodies, 0);
    assert.ok(coverage.bodies.some(body => body.bodyClass === "GOVERNING"), zip);
    if (zip !== "07960") assert.ok(coverage.bodies.some(body => body.bodyClass !== "GOVERNING"), zip);
    // Deliberately reverse the server order to exercise the government's grouping.
    coverage.bodies.reverse();
    // Controlled calendar rows exercise selection, cancellation, stale SCHEDULED
    // statuses and exact body identity for every real body resolved from each ZIP.
    const meetings: Meeting[] = coverage.bodies.flatMap(body => [
      { id: "later", startsAt: "2026-10-09T18:00:00Z", status: "SCHEDULED" as const },
      { id: "old", startsAt: "2026-09-01T18:00:00Z", status: "CONCLUDED" as const },
      { id: "canceled-next", startsAt: "2026-09-24T18:00:00Z", status: "CANCELED" as const },
      { id: "next", startsAt: "2026-09-25T18:00:00Z", status: "SCHEDULED" as const },
      { id: "canceled-last", startsAt: "2026-09-23T18:00:00Z", status: "CANCELED" as const },
      { id: "last", startsAt: "2026-09-22T18:00:00Z", status: "SCHEDULED" as const },
    ].map(row => ({ ...recorded.meetings[0], ...row, id: `${body.bodyId}:${row.id}`,
      bodyId: body.bodyId, bodyName: bodyDisplayName(body), ocdId: body.ocdId, title: row.id,
      location: null, online: undefined, timeZone: "UTC" })));
    // An unrelated body in the same division must never supply a card's meeting.
    meetings.unshift({ ...meetings[0], bodyId: "different-body", id: "wrong-body", startsAt: "2026-09-24T00:00:00Z" });
    regions[zip] = { coverage, meetings };
  }
  const output = await build({ stdin: { contents: `
    import React,{useState} from "react"; import {createRoot} from "react-dom/client";
    import {DoorOverlay} from "./components/map/door-overlay.tsx";
    import {bodySubject} from "./components/map/map-entry.tsx";
    import {EntityModal} from "./components/map/popup/entity-modal.tsx";
    import {ReaderCard} from "./components/shell/reader-card.tsx";
    import {DataProvider} from "./lib/state/data.tsx";
    const regions=${JSON.stringify(regions)}, recorded=${JSON.stringify(recorded.meetings)};
    const noop=()=>{};
    function Reader(){
      const params=new URLSearchParams(location.search);
      let original=regions[params.get("zip")||"85701"];
      if(params.get("types")==="1"){
        const parent=original.coverage.bodies.find(body=>body.bodyClass==="GOVERNING"&&body.divisionType==="place");
        const type={...parent,bodyId:parent.bodyId+":worksession",name:parent.name+" Worksession",bodyClass:"MEETING_TYPE",meetingBodyId:parent.bodyId};
        const person={id:"held-current-member",name:"Current Member",officeTitle:"Mayor",officeJurisdictionOcdId:parent.ocdId,termNote:null,partyLabel:null,websiteUrl:null,sourceUrl:"https://fixture.example.gov/roster",provenance:{sourceUrl:"https://fixture.example.gov/roster",sourceOrg:"Fixture",collectedAt:"2026-09-23",verifiedAt:null},email:null,phone:null,contactFormUrl:null,photoUrl:null,campaignUrl:null,termEnd:null,birthDate:null};
        const next=original.meetings.find(meeting=>meeting.bodyId===parent.bodyId&&meeting.id.endsWith(":next"));
        original={...original,coverage:{...original.coverage,bodies:[{...parent,meetingTypes:[type],readerRoster:{members:[person],earlierMembers:[{...person,id:"held-earlier-member",name:"Earlier Member"}],gaps:[],officePhone:null}},type]},meetings:[...original.meetings,{...next,id:"held-worksession",bodyId:type.bodyId,startsAt:"2026-09-24T17:00:00Z"}]};
      }
      const calendar=params.get("calendar");
      const region={...original,meetings:calendar==="recorded"?recorded:calendar==="none"?[]:calendar?original.meetings.filter(meeting=>meeting.id.endsWith(":"+calendar)):original.meetings};
      const [body,setBody]=useState(null);
      const [openedHolder,setOpenedHolder]=useState(null);
      const subject=body?bodySubject(body,region.meetings):null;
      const data={allMeetings:region.meetings,meetings:region.meetings,venues:[],result:null,location:null,drawnDistricts:[],dropped:0,searchFailed:false,atAddress:false,governing:null,zipPartial:null,basis:"ZIP"};
      return <DataProvider value={data}><ReaderCard key={body?.bodyId||"bodies"} viewKey={body?.bodyId||"bodies"} kicker={subject?.title||"Bodies"} backLabel={body?"Bodies":null} onBack={()=>setBody(null)} onClose={()=>setBody(null)}>
        {subject?<EntityModal subject={subject} embedded onClose={()=>setBody(null)} onOpenHolder={setOpenedHolder}/>:<DoorOverlay door="bodies" coverage={region.coverage} meetings={region.meetings} drawnDistricts={[]} districtOverlayOn={false} atAddress={false} onShowDistricts={noop} onOpenOfficial={noop} onOpenMeeting={noop} onOpenBody={setBody} onClose={noop} embedded/>}
        {openedHolder&&<output data-opened-holder={openedHolder.id}>{openedHolder.name}</output>}
      </ReaderCard></DataProvider>;
    }
    createRoot(document.getElementById("root")).render(<Reader/>);`, sourcefile: "ui-02-bodies.tsx", resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, outfile: ".scratch/ui-02-bodies.js", platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, logLevel: "silent" });
  const javascript = output.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const postcss = createRequire(import.meta.resolve("@tailwindcss/postcss"))("postcss");
  const css = (await postcss([tailwindcss()]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" })).css
    + readFileSync("app/reader.css", "utf8") + (output.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "");
  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") response.writeHead(200, { "content-type": "application/javascript; charset=utf-8" }).end(javascript);
    else if (request.url === "/fixture.css") response.writeHead(200, { "content-type": "text/css" }).end(css);
    else if (request.url?.startsWith("/api/")) response.writeHead(503, { "content-type": "application/json" }).end("{}");
    else response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "ui-02-bodies" });
    mkdirSync(".scratch/ci", { recursive: true });
    for (const width of [1024, 390]) {
      const context = await browser.context({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date(now));
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      for (const [zip, region] of Object.entries(regions)) {
        const start = Date.now();
        await page.goto(`http://127.0.0.1:${address.port}/?zip=${zip}`);
        const rows = page.locator(".door-panel li");
        await rows.first().waitFor();
        assert.ok(Date.now() - start < 3000, `${zip}: first usable list`);
        assert.equal(await rows.count(), region.coverage.bodies.length);
        assert.equal(await rows.locator("[data-meeting-row], article, details, a").count(), 0);
        const groups = groupBodiesByGovernment(region.coverage.bodies);
        const expected = groups.flatMap(section => section.governments.flatMap(government => government.rows.flatMap(row => [row.body, ...row.meetingTypes])));
        const labels = await page.locator("[data-body-row] > button > span:first-child").allTextContents();
        assert.deepEqual(labels, expected.map(bodyDisplayName));
        assert.deepEqual(await page.locator(".door-panel h3").allTextContents(), groups.map(section => section.label));
        assert.deepEqual(await page.locator(".door-panel h4").allTextContents(), groups.flatMap(section => section.governments.map(government => government.name)));
        await page.screenshot({ path: `.scratch/ci/ui-02-${zip}-${width}-list.png` });
        // Click every resolved body's row on desktop; repeat government and
        // advisory click-through on the narrow layout.
        const selected = width === 1024 ? expected : [expected[0], expected.at(-1)!];
        for (const body of selected) {
          const opened = Date.now();
          await page.locator(`[data-body-id=${JSON.stringify(body.bodyId)}] > button`).click();
          const next = page.locator('[data-meeting-row]').filter({ has: page.getByRole("heading", { name: "Next meeting", exact: true }) });
          const last = page.locator('[data-meeting-row]').filter({ has: page.getByRole("heading", { name: "Last meeting", exact: true }) });
          await next.waitFor({ state: "visible" }); await last.waitFor({ state: "visible" });
          assert.ok(Date.now() - opened < 3000, `${zip}: ${body.bodyId} click-through`);
          assert.equal(await next.getAttribute("data-meeting-id"), `${body.bodyId}:next`);
          assert.equal(await last.getAttribute("data-meeting-id"), `${body.bodyId}:last`);
          assert.equal(await page.locator('[data-meeting-id="wrong-body"]').count(), 0);
          if (body === selected[0]) {
            await page.screenshot({ path: `.scratch/ci/ui-02-${zip}-${width}-card.png` });
            await page.getByText("More meetings (4)", { exact: true }).click();
            assert.equal(await page.locator('details [data-meeting-id]').count(), 4);
          }
          await page.getByRole("button", { name: "Back to Bodies", exact: true }).click();
          await rows.first().waitFor();
          assert.equal(await rows.count(), expected.length);
        }
        console.log(`${zip}, ${width}px: ${expected.length} compact bodies, ${selected.length} body cards checked`);
      }
      // Keep the report's recorded Tucson meetings on the connected card path too.
      await page.goto(`http://127.0.0.1:${address.port}/?zip=85701&calendar=recorded`);
      const tusd = regions["85701"].coverage.bodies.find(body => body.bodyId === "ocd-division/country:us/state:az/school_district:tucson_unified_district#board")!;
      assert.ok(tusd);
      const openTusd = () => page.locator(".door-panel button").filter({ hasText: bodyDisplayName(tusd) }).click();
      await openTusd();
      const nextRow = page.locator("[data-meeting-row]").filter({ has: page.getByRole("heading", { name: "Next meeting", exact: true }) });
      const lastRow = page.locator("[data-meeting-row]").filter({ has: page.getByRole("heading", { name: "Last meeting", exact: true }) });
      await nextRow.waitFor({ state: "visible" });
      assert.equal(await nextRow.getAttribute("data-meeting-id"), "diligent:tusd1:503");
      assert.equal(await lastRow.getAttribute("data-meeting-id"), "diligent:tusd1:499");
      await page.screenshot({ path: `.scratch/ci/ui-02-85701-${width}-recorded-card.png` });
      // Missing history or future dates stay missing; neither side borrows a
      // date from the other, a canceled meeting or another body.
      for (const calendar of ["next", "last", "none"]) {
        await page.goto(`http://127.0.0.1:${address.port}/?zip=85701&calendar=${calendar}`);
        const opened = Date.now();
        await openTusd();
        const gapId = calendar === "next" ? "body:last-meeting" : calendar === "last" ? "body:next-meeting" : `body:${tusd.bodyId}:meetings`;
        const gap = page.locator(`[data-card-gap="${gapId}"]`);
        await gap.waitFor({ state: "visible", timeout: 3000 });
        if (calendar === "next") await nextRow.waitFor({ state: "visible", timeout: 3000 });
        if (calendar === "last") await lastRow.waitFor({ state: "visible", timeout: 3000 });
        assert.ok(Date.now() - opened < 3000, `${calendar}: the held meeting and coverage gap are usable`);
        assert.equal(await nextRow.count(), calendar === "next" ? 1 : 0);
        assert.equal(await lastRow.count(), calendar === "last" ? 1 : 0);
        assert.match(await gap.innerText(), /working on getting this info/);
        assert.equal(await gap.locator("[data-demand-subject]").getAttribute("data-demand-subject"), tusd.bodyId);
      }
      await page.goto(`http://127.0.0.1:${address.port}/?zip=85701&types=1`);
      const parentRow = page.locator("[data-body-row]").filter({ has: page.locator("[data-meeting-type-row]") });
      await parentRow.waitFor();
      assert.equal(await page.locator("[data-body-row]").count(), 2, "the held meeting-type id appears exactly once");
      assert.equal(await parentRow.locator("[data-meeting-type-row]").count(), 1);
      await parentRow.locator(":scope > button").click();
      await page.locator('[data-meeting-id="held-worksession"]').waitFor();
      const openedRoster = Date.now();
      await page.getByRole("button", { name: "Who sits on it 1", exact: true }).click();
      await page.locator("[data-roster-holder]").first().waitFor({ state: "visible", timeout: 3000 });
      assert.ok(Date.now() - openedRoster < 3000, "the held roster is usable");
      assert.equal(await page.locator("[data-roster-holder]").count(), 1);
      assert.equal(await page.getByRole("button", { name: "Current Member", exact: true }).count(), 1, "the mayor appears once in the member list");
      assert.equal(await page.locator("[data-earlier-roster-holder]").count(), 1);
      await page.getByText("Earlier membership records (1)", { exact: true }).click();
      await page.getByRole("button", { name: "Earlier Member", exact: true }).click();
      await page.locator('[data-opened-holder="held-earlier-member"]').waitFor();
      await page.getByRole("button", { name: "Back to Bodies", exact: true }).click();
      await page.locator("[data-meeting-type-row] > button").click();
      await page.locator('[data-meeting-id="held-worksession"]').waitFor();
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
