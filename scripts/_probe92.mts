import { launchGuarded } from "./browser.mts";

const BASE = "http://localhost:3000";

const guarded = await launchGuarded({ label: "f01-probe" });
const page = await guarded.page({ viewport: { width: 1440, height: 900 } });
page.on("console", (m) => { if (m.type() === "error") console.log("PAGE ERROR:", m.text().slice(0, 200)); });

await page.goto(`${BASE}/?zip=85701`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);

const shot = await page.evaluate(() => {
  const tiles = [...document.querySelectorAll(".stats-bar [data-stat], .stats-bar button, .stats-bar div")]
    .map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 0 && t.length < 60);
  return {
    storage: window.localStorage.getItem("wtp.show_districts"),
    statsText: [...new Set(tiles)].slice(0, 14),
    districtLayers: (window as unknown as { __map?: { getStyle: () => { layers: { id: string }[] } } }).__map
      ? "map-exposed"
      : "no-__map",
    bodyHasDistrictLabel: /District/.test(document.body.textContent ?? ""),
  };
});
console.log(JSON.stringify(shot, null, 1));
await guarded.close();
