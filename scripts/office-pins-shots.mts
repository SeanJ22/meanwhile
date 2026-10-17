/**
 * Office pins against a local build, at phone and desktop sizes, for ZIP 85701 and ZIP 08628 (a House district
 * office and a state senator's office in one Ewing building). The reader routes that need a database are served
 * from committed fixtures: the recorded 85701 meetings, congress-legislators office rows and Open States rows.
 * The geocoder is the app's own route. Screenshots of rest, hover, cluster, fan and modal go to
 * docs/design/office-pins/, with the counts in results.json.
 *
 *   pnpm build && pnpm start &
 *   SHOOT_BASE_URL=http://localhost:3000 pnpm exec tsx scripts/office-pins-shots.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";
import type { Page } from "playwright";

import { launchGuarded, seedZip } from "./browser.mts";
import { normalizeCongressDirectory } from "../lib/officials/congress-normalize.ts";
import { indexByOfficeholderId, type SeatHolder } from "../lib/officials/lookup.ts";
import { OPEN_STATES_ORG, openStatesUrl, parseOfficeAddress } from "../lib/officials/member-offices.ts";

const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";
const OUT = "docs/design/office-pins";
mkdirSync(OUT, { recursive: true });

const congress = JSON.parse(readFileSync("tests/fixtures/office-pins/congress-legislators.json", "utf8")) as {
  revision: string; retrievedAt: string; yaml: Record<string, string>;
};
const projection = normalizeCongressDirectory(
  Object.fromEntries(Object.entries(congress.yaml).map(([file, yaml]) => [file, parse(yaml)])),
  congress.revision, congress.retrievedAt,
);
const federal = indexByOfficeholderId([projection.roster]);
const member = (bioguide: string) => {
  const holder = federal.get(`congress:${bioguide}`);
  if (!holder) throw new Error(`no congress-legislators row for ${bioguide}`);
  return holder;
};

const openStates = JSON.parse(readFileSync("tests/fixtures/office-pins/openstates-legislators.json", "utf8")) as {
  retrievedAt: string; rows: Record<string, Record<string, string>[]>;
};
const legislators = Object.entries(openStates.rows).flatMap(([state, rows]) => rows.map(row => ({ state, row })));
const legislator = (state: string, chamber: "upper" | "lower"): SeatHolder[] =>
  legislators.filter(entry => entry.state === state && entry.row.current_chamber === chamber).map(({ row }) => ({
    id: row.id, personId: row.id, name: row.name,
    officeTitle: chamber === "upper" ? "State Senator" : state === "nj" ? "Member of the General Assembly" : "State Representative",
    partyLabel: row.current_party || null, termEnd: null, birthDate: null, websiteUrl: null,
    sourceUrl: openStatesUrl(state), provenance: { sourceOrg: OPEN_STATES_ORG, sourceUrl: openStatesUrl(state), collectedAt: openStates.retrievedAt, verifiedAt: null },
    email: row.email || null, phone: row.district_voice || null, contactFormUrl: null, photoUrl: null, campaignUrl: null,
    state: state.toUpperCase(), chamber,
  }));

/** The /api/directory body for one member, in the shape the route serves. */
function directoryFor(memberId: string) {
  if (memberId.startsWith("congress:")) {
    const entry = projection.directory.byMember[memberId.slice(9)];
    return entry ? { ...entry, source: projection.directory.source } : { source: projection.directory.source, districtOffices: [], committees: [] };
  }
  const found = legislators.find(entry => entry.row.id === memberId);
  const address = found?.row.district_address ?? "";
  const offices = address ? [{ ...parseOfficeAddress(address), phone: found!.row.district_voice || null, lat: null, lng: null }] : [];
  return {
    source: null, districtOffices: offices, committees: [],
    officeDetails: offices.map(() => ({ officeKind: "DISTRICT", sourceUrl: openStatesUrl(found!.state), sourceOrg: OPEN_STATES_ORG, collectedAt: openStates.retrievedAt, official: false })),
  };
}

const recorded = JSON.parse(readFileSync("tests/fixtures/reader-upcoming-meetings-85701.json", "utf8")) as {
  recordedAt: string; listingIdentity: unknown; coverage: { bodies: unknown[] }; meetings: unknown[];
};

interface Place {
  zip: string; center: { lat: number; lng: number }; meetings: unknown[]; bodies: unknown[]; listingIdentity: unknown;
  seats: { ocdId: string; label: string; divisionType: string; tier: "national" | "state"; representatives: SeatHolder[] }[];
  senators: SeatHolder[];
  /** Where the overlapping offices sit, and a zoom at which they merge (MapLibre's 512px tiles). */
  cluster: { lat: number; lng: number; zoom: number };
  clock: string | null;
}

const PLACES: Place[] = [
  {
    zip: "85701", center: { lat: 32.21696, lng: -110.971 }, meetings: recorded.meetings, bodies: recorded.coverage.bodies,
    listingIdentity: recorded.listingIdentity,
    seats: [
      { ocdId: "ocd-division/country:us/state:az/cd:7", label: "Congressional District 7", divisionType: "cd", tier: "national", representatives: [member("G000606")] },
      { ocdId: "ocd-division/country:us/state:az/sldu:20", label: "Legislative District 20", divisionType: "sldu", tier: "state", representatives: legislator("az", "upper") },
      { ocdId: "ocd-division/country:us/state:az/sldl:20", label: "Legislative District 20", divisionType: "sldl", tier: "state", representatives: legislator("az", "lower") },
    ],
    senators: [member("K000377"), member("G000574")],
    // Kelly (100 N Stone Ave) and Gallego (20 E Ochoa St) are about 350 m apart downtown.
    cluster: { lat: 32.2216, lng: -110.9735, zoom: 12 },
    // The recorded meetings are shown around the day they were recorded.
    clock: recorded.recordedAt,
  },
  {
    zip: "08628", center: { lat: 40.26442, lng: -74.82705 }, meetings: [], bodies: [],
    listingIdentity: { recordCount: 0, sourceListingCount: 0, groups: [], unresolvedBodySourceIds: [], unresolvedTimeSourceIds: [], duplicateNativeIds: [] },
    seats: [
      { ocdId: "ocd-division/country:us/state:nj/cd:12", label: "Congressional District 12", divisionType: "cd", tier: "national", representatives: [member("W000822")] },
      { ocdId: "ocd-division/country:us/state:nj/sldu:15", label: "Legislative District 15", divisionType: "sldu", tier: "state", representatives: legislator("nj", "upper") },
      { ocdId: "ocd-division/country:us/state:nj/sldl:15", label: "Legislative District 15", divisionType: "sldl", tier: "state", representatives: legislator("nj", "lower") },
    ],
    senators: [member("B001288"), member("K000394")],
    // Watson Coleman (Suite 201) and Turner (Suite 101), 850 Bear Tavern Road.
    cluster: { lat: 40.279, lng: -74.8307, zoom: 14 },
    clock: null,
  },
];

function meetingsResponse(place: Place) {
  const seats = place.seats.map(seat => ({ ...seat }));
  return {
    meetings: place.meetings, listingIdentity: place.listingIdentity, tier: "exact", radiusKm: 8,
    center: place.center, governingOcdIds: null, partialOcdIds: null,
    coverage: {
      state: place.meetings.length > 0 ? "MEETINGS" : "NONE_SCHEDULED", bodies: place.bodies, seats, senators: place.senators,
      statewideExecutives: [], stateLegislatorAuthorities: [],
      divisions: seats.map(seat => ({ ocdId: seat.ocdId, label: seat.label, divisionType: seat.divisionType, tier: seat.tier })),
      unincorporated: false,
      counts: { total: place.bodies.length, withSource: place.bodies.length, withoutSource: 0, lookedAt: 0, governing: { total: 0, withSource: 0 } },
      seatCounts: { total: seats.length, named: seats.filter(seat => seat.representatives.length > 0).length },
    },
  };
}

const VIEWPORTS = [
  { name: "phone", options: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  { name: "desktop", options: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
] as const;

/** What the map draws: one count per office, not per marker. */
async function counts(page: Page) {
  return page.evaluate(() => {
    const singles = document.querySelectorAll(".mw-office-pin:not(.mw-office-fan-item)").length;
    const hubs = [...document.querySelectorAll(".mw-office-hub__count")].map(node => Number(node.textContent));
    const pinCount = (window as unknown as { __wtpPinCount?: () => number }).__wtpPinCount;
    return {
      officePins: singles + hubs.reduce((sum, n) => sum + n, 0),
      officeMarkers: singles + hubs.length,
      clusters: hubs,
      meetingPins: pinCount ? pinCount() : null,
      legacyOfficeMarkers: document.querySelectorAll(".wtp-office-pin").length,
    };
  });
}

/** Ring colours, glyph shape, and the touch hit area of every office control on screen. */
async function inspect(page: Page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const token = (name: string) => root.getPropertyValue(name).trim();
    return {
      tokens: { state: token("--accent-state"), national: token("--accent-national"), mark: token("--mark"), ring: token("--ring") },
      controls: [...document.querySelectorAll<HTMLElement>(".mw-office-pin, .mw-office-hub")].filter(el => getComputedStyle(el).visibility !== "hidden").map(el => {
        const style = getComputedStyle(el);
        const before = getComputedStyle(el, "::before");
        const box = el.getBoundingClientRect();
        return {
          kind: el.classList.contains("mw-office-hub") ? "hub" : el.classList.contains("mw-office-fan-item") ? "fan" : "single",
          tier: el.dataset.tier ?? null, label: el.getAttribute("aria-label"),
          width: Math.round(box.width), height: Math.round(box.height), radius: style.borderRadius,
          boxShadow: style.boxShadow, background: style.backgroundImage === "none" ? style.backgroundColor : style.backgroundImage,
          hitWidth: before.content === "none" ? Math.round(box.width) : Math.round(parseFloat(before.width)),
          hitHeight: before.content === "none" ? Math.round(box.height) : Math.round(parseFloat(before.height)),
        };
      }),
    };
  });
}

async function openMap(page: Page, place: Place) {
  await page.route("**/api/meetings?**", route => route.fulfill({ json: meetingsResponse(place) }));
  await page.route("**/api/directory?**", route => {
    const id = new URL(route.request().url()).searchParams.get("member") ?? "";
    return route.fulfill({ json: directoryFor(id) });
  });
  if (place.clock) await page.clock.install({ time: new Date(place.clock) });
  await seedZip(page, place.zip);
  const trace: string[] = [];
  page.on("console", message => trace.push(`console.${message.type()}: ${message.text()}`));
  page.on("response", response => { if (response.url().includes("/api/")) trace.push(`${response.status()} ${response.url()}`); });
  const started = Date.now();
  const meetingPin = place.meetings.length > 0
    ? page.waitForSelector(".wtp-pin", { timeout: 20_000 }).then(() => Date.now() - started, () => null)
    : Promise.resolve(null);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForSelector(".mw-office-pin, .mw-office-hub", { timeout: 20_000 });
  } catch (error) {
    await page.screenshot({ path: `${OUT}/${place.zip}-no-office-pins.png` });
    console.error(trace.slice(0, 80).join("\n"));
    throw error;
  }
  const firstOfficePinMs = Date.now() - started;
  const firstMeetingPinMs = await meetingPin;
  // Every owner's directory and geocode settle; the count stops changing.
  let last = -1;
  for (let i = 0; i < 20; i += 1) {
    const now = (await counts(page)).officePins;
    if (now === last) break;
    last = now;
    await page.waitForTimeout(500);
  }
  return { firstOfficePinMs, firstMeetingPinMs };
}

async function jump(page: Page, at: { lat: number; lng: number; zoom: number }) {
  await page.evaluate(({ lat, lng, zoom }) => {
    const map = (window as unknown as { __wtpMap: { jumpTo(o: unknown): void } }).__wtpMap;
    map.jumpTo({ center: [lng, lat], zoom });
  }, at);
  await page.waitForTimeout(900);
}

/**
 * The three-second rule on a phone: a mid-range phone's CPU (4x slower) on Fast 4G, from navigation until the map
 * shows its office and meeting pins. Local server, so this measures the page's own work, not the production edge.
 */
async function throttledPhoneTiming(place: Place) {
  const context = await browser.context({ ...VIEWPORTS[0].options });
  await context.addInitScript({ content: "window.__name = (fn) => fn;" });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
  const timing = await openMap(page, place);
  const shown = await counts(page);
  await context.close();
  return { ...timing, officePins: shown.officePins, meetingPins: shown.meetingPins };
}

/** The light theme: rings resolve from the light accents, and the fill stays neutral. */
async function lightTheme(place: Place) {
  const context = await browser.context({ ...VIEWPORTS[1].options });
  await context.addInitScript({ content: "window.__name = (fn) => fn; try { localStorage.setItem('wtp.theme', 'light'); } catch {}" });
  const page = await context.newPage();
  await openMap(page, place);
  const found = await inspect(page);
  await page.screenshot({ path: `${OUT}/${place.zip}-desktop-rest-light.png` });
  await context.close();
  return { theme: "light", tokens: found.tokens, controls: found.controls.map(c => ({ kind: c.kind, tier: c.tier, boxShadow: c.boxShadow, background: c.background })) };
}

/** Reduced motion collapses every office-pin transition. */
async function reducedMotion(place: Place) {
  const context = await browser.context({ ...VIEWPORTS[1].options, reducedMotion: "reduce" });
  await context.addInitScript({ content: "window.__name = (fn) => fn;" });
  const page = await context.newPage();
  await openMap(page, place);
  const durations = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".mw-office-marker *")]
    .map(el => getComputedStyle(el).transitionDuration).filter(value => value.split(",").some(part => parseFloat(part) > 0.001)));
  await context.close();
  return { transitionsLongerThan1ms: durations.length };
}

const results: Record<string, unknown> = {};
const browser = await launchGuarded({ label: "office-pins-shots" });
try {
  for (const place of PLACES) {
    for (const vp of VIEWPORTS) {
      const touch = vp.name === "phone";
      const context = await browser.context({ ...vp.options, reducedMotion: "no-preference" });
      // tsx names the arrow functions it compiles; the page needs the helper those names call.
      await context.addInitScript({ content: "window.__name = (fn) => fn;" });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      const shot = (state: string) => page.screenshot({ path: `${OUT}/${place.zip}-${vp.name}-${state}.png` });
      const row: Record<string, unknown> = {};
      row.timing = await openMap(page, place);
      row.atRest = await counts(page);
      row.restInspect = await inspect(page);
      await shot("rest");

      if (!touch) {
        const single = page.locator(".mw-office-pin:not(.mw-office-fan-item)").first();
        if (await single.count()) {
          await single.hover();
          await page.waitForTimeout(600);
          await shot("hover");
        }
      }

      await jump(page, place.cluster);
      row.clusterView = await counts(page);
      await shot("cluster");
      const hub = page.locator(".mw-office-hub").first();
      if (await hub.count()) {
        if (!touch) {
          await hub.hover();
          await page.waitForTimeout(600);
          await shot("cluster-hover");
        }
        await (touch ? hub.tap() : hub.click());
        await page.waitForTimeout(700);
        row.fanExpanded = await hub.getAttribute("aria-expanded");
        row.fanInspect = await inspect(page);
        await shot("fan");
        const capsule = page.locator(".mw-office-fan-item").first();
        await (touch ? capsule.tap() : capsule.click());
        await page.waitForSelector("[data-reader-card]", { timeout: 10_000 });
        await page.waitForTimeout(800);
        row.modal = await page.evaluate(() => {
          const card = document.querySelector<HTMLElement>("[data-reader-card]")!;
          const head = card.querySelector(".mw-card-head")!;
          const body = card.querySelector<HTMLElement>(".mw-card-body")!;
          const box = card.getBoundingClientRect();
          return {
            kicker: card.querySelector(".mw-card-kicker")?.textContent ?? null,
            title: card.querySelector("h2, h3")?.textContent ?? null,
            districtOffice: card.querySelector(".mw-district-office__address")?.textContent ?? null,
            contactPills: card.querySelectorAll(".contact-pill").length,
            bodyPadding: getComputedStyle(body).padding,
            headPadding: getComputedStyle(head).padding,
            cardBox: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
            officeFirst: (() => {
              const contact = card.querySelector("[data-person-contact]");
              return contact?.firstElementChild?.classList.contains("mw-district-office") ?? false;
            })(),
          };
        });
        await shot("modal");
        await page.locator("[data-mw='card-close']").click();
        await page.waitForTimeout(700);
        row.fanAfterClose = await hub.getAttribute("aria-expanded");
        await shot("after-close");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(600);
        row.fanAfterEscape = await hub.getAttribute("aria-expanded");
        row.focusAfterEscape = await page.evaluate(() => document.activeElement?.className ?? null);
      }
      row.errors = errors;
      if (touch) row.throttledPhone = await throttledPhoneTiming(place);
      else {
        row.light = await lightTheme(place);
        row.reducedMotion = await reducedMotion(place);
      }
      results[`${place.zip}-${vp.name}`] = row;
      console.log(place.zip, vp.name, JSON.stringify({ ...row, restInspect: undefined, fanInspect: undefined }));
      await context.close();
    }
  }
} finally {
  writeFileSync(`${OUT}/results.json`, `${JSON.stringify(results, null, 2)}\n`);
  await browser.close();
}
