/**
 * One-off capture of the three interactive phone states the responsive gate
 * cares about: the first-run welcome card, the sidebar drawer, and the
 * meeting-panel bottom sheet. Same headless approach as shoot.mts (occluded
 * tabs stop getting rAF, so an attached browser lies); kept as its own
 * script because shoot captures a URL, and these are *states* reached by
 * tapping.
 *
 *   corepack pnpm tsx scripts/phone-states.mts
 */
import { chromium } from "playwright";

const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  // 1 — first run: no stored zip, the welcome card is the landing state.
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "screenshots/phone-welcome.png" });
  console.log(
    "welcome:",
    await page.evaluate(() => ({
      cardVisible: !!document.querySelector(".welcome-overlay:not(.hidden)"),
      quickLabels: [...document.querySelectorAll(".welcome-team-btn")].map(
        (b) => b.textContent?.trim(),
      ),
    })),
  );

  // 2 — pick Tucson, wait for pins, open the drawer.
  await page.click(".welcome-team-btn");
  await page.waitForTimeout(6000);
  await page.click(".sidebar-toggle");
  await page.waitForTimeout(600);
  await page.screenshot({ path: "screenshots/phone-drawer.png" });
  console.log(
    "drawer:",
    await page.evaluate(() => ({
      open: !!document.querySelector(".sidebar.sidebar-open"),
      backdrop: !!document.querySelector(".sidebar-backdrop"),
    })),
  );

  // 3 — close the drawer (tap the exposed sliver of backdrop right of the
  // drawer, as a thumb would), tap the first pin, expect the bottom sheet.
  await page.mouse.click(378, 420);
  await page.waitForTimeout(600);
  await page.click(".wtp-pin");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "screenshots/phone-sheet.png" });
  console.log(
    "sheet:",
    await page.evaluate(() => {
      const sheet = document.querySelector(".bottom-sheet");
      const rect = sheet?.getBoundingClientRect();
      return {
        present: !!sheet,
        pinnedToBottom: rect ? Math.abs(rect.bottom - innerHeight) < 2 : false,
        heightPx: rect ? Math.round(rect.height) : 0,
      };
    }),
  );

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
