/**
 * R39 — one Phone pill replaces stacked numbers, everywhere.
 *
 * The walk checks the row demands, run against whatever `SHOOT_BASE_URL`
 * points at (default local):
 *
 *  - at Shaheen: ONE Phone pill, ZERO stacked phone rows, the modal's rows
 *    equal to the recorded count, every row a `tel:` link;
 *  - at a single-number official: a direct `tel:` pill and NO modal;
 *  - dismissal returns the battlecard untouched;
 *  - both viewports, both themes.
 *
 * `pnpm tsx scripts/walk-r39.mts`
 */
import { chromium, type Browser, type Page } from "playwright";
import { join } from "node:path";

import { syntheticRunHeaders } from "../lib/db/run-marker.ts";

const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";
const OUT = "C:/Users/seanj/dev/we-the-people/screenshots";
const HEADERS = syntheticRunHeaders();

const results: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function cannotRun(name: string, why: string) {
  results.push(`CANNOT-RUN ${name} — ${why}`);
}

type Size = { width: number; height: number };
const PHONE: Size = { width: 390, height: 844 };
const DESKTOP: Size = { width: 1280, height: 900 };

async function openAt(
  browser: Browser,
  zip: string,
  viewport: Size,
  theme: "dark" | "light",
): Promise<Page> {
  const context = await browser.newContext({
    extraHTTPHeaders: HEADERS,
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await context.addInitScript(
    ({ zip, theme }) => {
      try {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip, savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.tutorial_seen", "1");
        localStorage.setItem("wtp.theme", theme);
      } catch {
        /* defaults are fine */
      }
    },
    { zip, theme },
  );
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(9000);
  return page;
}

/** Open a named officeholder's battlecard from the who-governs card. */
async function openHolder(page: Page, name: string): Promise<boolean> {
  const opened = await page.evaluate(`(() => {
    const card = document.querySelector(".coverage-notice");
    if (!card) return false;
    for (const b of card.querySelectorAll("button")) {
      if (new RegExp(${JSON.stringify(name)}, "i").test(b.textContent || "")) {
        b.click();
        return true;
      }
    }
    return false;
  })()`) as boolean;
  if (opened) await page.waitForTimeout(2500);
  return opened;
}

/** What the contact row is actually showing, counted in the DOM. */
const PILL_CENSUS = `(() => {
  const row = document.querySelector(".contact-pill-row");
  if (!row) return null;
  const pills = [...row.querySelectorAll(".contact-pill")];
  return {
    total: pills.length,
    labels: pills.map((p) => (p.textContent || "").trim()),
    telLinks: pills.filter((p) => (p.getAttribute("href") || "").startsWith("tel:")).length,
    phoneButtons: pills.filter((p) => p.tagName === "BUTTON" && /Phone/.test(p.textContent || "")).length,
  };
})()`;

const MODAL_CENSUS = `(() => {
  const overlay = document.querySelector(".phone-modal-overlay");
  if (!overlay) return null;
  const rows = [...overlay.querySelectorAll(".phone-modal-row")];
  return {
    rows: rows.length,
    tel: rows.filter((r) => (r.getAttribute("href") || "").startsWith("tel:")).length,
    labels: rows.map((r) => (r.querySelector(".phone-modal-row-label") || {}).textContent || ""),
    numbers: rows.map((r) => (r.querySelector(".phone-modal-row-number") || {}).textContent || ""),
    zIndex: Number(getComputedStyle(overlay).zIndex),
    // The card underneath, whichever size it is: the small popup is
    // .popup-card, the battlecard is .account-modal. Asserting one of them by
    // name would report a working card as a missing one.
    cardStillOpen: Boolean(
      document.querySelector(".popup-card") || document.querySelector(".account-modal"),
    ),
  };
})()`;

const browser = await chromium.launch();

// ── Shaheen: the example, at both viewports and both themes ──────────────
for (const viewport of [PHONE, DESKTOP]) {
  for (const theme of ["dark", "light"] as const) {
    const tag = `${viewport.width}-${theme}`;
    const page = await openAt(browser, "03255", viewport, theme);

    if (!(await openHolder(page, "Shaheen"))) {
      cannotRun(`${tag}: Shaheen's card`, "no Shaheen row on the who-governs card");
      await page.context().close();
      continue;
    }

    const pills = (await page.evaluate(PILL_CENSUS)) as {
      total: number;
      labels: string[];
      telLinks: number;
      phoneButtons: number;
    } | null;

    if (!pills) {
      cannotRun(`${tag}: Shaheen's contact row`, "no contact pill row on the card");
      await page.context().close();
      continue;
    }

    check(
      `${tag}: Shaheen renders exactly ONE Phone pill`,
      pills.phoneButtons === 1,
      `phone pills: ${pills.phoneButtons}`,
    );
    // The defect itself: pills whose face is a number.
    const stacked = pills.labels.filter((l) => /\d{3}[).\- ]\s?\d{3}[-. ]\d{4}/.test(l));
    check(
      `${tag}: zero stacked number rows on Shaheen's card`,
      stacked.length === 0,
      `pills showing a number: ${stacked.length} of ${pills.total} — ${JSON.stringify(pills.labels)}`,
    );

    await page.evaluate(`(() => {
      const row = document.querySelector(".contact-pill-row");
      for (const p of row.querySelectorAll("button.contact-pill")) {
        if (/Phone/.test(p.textContent || "")) { p.click(); return; }
      }
    })()`);
    await page.waitForTimeout(600);

    const modal = (await page.evaluate(MODAL_CENSUS)) as {
      rows: number;
      tel: number;
      labels: string[];
      numbers: string[];
      zIndex: number;
      cardStillOpen: boolean;
    } | null;

    if (!modal) {
      cannotRun(`${tag}: Shaheen's phone modal`, "the Phone pill opened nothing");
      await page.context().close();
      continue;
    }

    // The recorded count, read from the same directory the app reads.
    const recorded = (await page.evaluate(`(async () => {
      const r = await fetch("/api/directory?member=congress:S001181");
      if (!r.ok) return null;
      const d = await r.json();
      const nums = new Set((d.districtOffices || []).map((o) => o.phone).filter(Boolean));
      return { district: nums.size };
    })()`)) as { district: number } | null;

    check(
      `${tag}: the modal's rows equal the recorded count`,
      recorded !== null && modal.rows === recorded.district + 1,
      `modal rows ${modal.rows}; recorded district numbers ${recorded?.district ?? "?"} + 1 Washington`,
    );
    check(
      `${tag}: every modal row is a tel: link`,
      modal.tel === modal.rows && modal.rows > 0,
      `${modal.tel} of ${modal.rows}`,
    );
    check(
      `${tag}: every modal row carries an office label from the record`,
      modal.labels.length === modal.rows && modal.labels.every((l) => l.trim().length > 0),
      JSON.stringify(modal.labels),
    );
    check(
      `${tag}: the modal sits over the battlecard, which is still open`,
      modal.zIndex > 1300 && modal.cardStillOpen,
      `z-index ${modal.zIndex}, card open ${modal.cardStillOpen}`,
    );
    await page.screenshot({ path: join(OUT, `r39-shaheen-modal-${tag}.png`) });

    // Dismissal returns the card untouched.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    const after = (await page.evaluate(`(() => ({
      modalGone: !document.querySelector(".phone-modal-overlay"),
      cardOpen: Boolean(
        document.querySelector(".popup-card") || document.querySelector(".account-modal"),
      ),
      pills: document.querySelectorAll(".contact-pill-row .contact-pill").length,
    }))()`)) as { modalGone: boolean; cardOpen: boolean; pills: number };
    check(
      `${tag}: Escape closes the modal and leaves the card untouched`,
      after.modalGone && after.cardOpen && after.pills === pills.total,
      `modal gone ${after.modalGone}, card open ${after.cardOpen}, pills ${after.pills} of ${pills.total}`,
    );
    await page.screenshot({ path: join(OUT, `r39-shaheen-card-${tag}.png`) });

    await page.context().close();
  }
}

// ── The LARGE card: the same one pill, on the other card size ────────────
{
  const page = await openAt(browser, "03255", DESKTOP, "dark");
  if (!(await openHolder(page, "Shaheen"))) {
    cannotRun("battlecard: Shaheen", "no Shaheen row on the who-governs card");
  } else {
    const expanded = (await page.evaluate(`(() => {
      const card = document.querySelector(".popup-card");
      if (!card) return false;
      for (const b of card.querySelectorAll("button")) {
        if (/^More/.test((b.textContent || "").trim())) { b.click(); return true; }
      }
      return false;
    })()`)) as boolean;

    if (!expanded) {
      cannotRun("battlecard: Shaheen", "no More button on the small popup");
    } else {
      await page.waitForTimeout(2500);
      const pills = (await page.evaluate(`(() => {
        const modal = document.querySelector(".account-modal");
        if (!modal) return null;
        const row = modal.querySelector(".contact-pill-row");
        if (!row) return null;
        const p = [...row.querySelectorAll(".contact-pill")];
        return {
          total: p.length,
          labels: p.map((x) => (x.textContent || "").trim()),
          phoneButtons: p.filter((x) => x.tagName === "BUTTON" && /Phone/.test(x.textContent || "")).length,
        };
      })()`)) as { total: number; labels: string[]; phoneButtons: number } | null;

      if (!pills) {
        cannotRun("battlecard: Shaheen", "no contact pill row inside the battlecard");
      } else {
        check(
          "battlecard: the large card renders exactly ONE Phone pill too",
          pills.phoneButtons === 1,
          `phone pills ${pills.phoneButtons} of ${pills.total} — ${JSON.stringify(pills.labels)}`,
        );
        const stacked = pills.labels.filter((l) =>
          /\d{3}[).\- ]\s?\d{3}[-. ]\d{4}/.test(l),
        );
        check(
          "battlecard: zero stacked number rows on the large card",
          stacked.length === 0,
          `pills showing a number: ${stacked.length} of ${pills.total}`,
        );
        await page.evaluate(`(() => {
          for (const p of document.querySelectorAll(".account-modal button.contact-pill")) {
            if (/Phone/.test(p.textContent || "")) { p.click(); return; }
          }
        })()`);
        await page.waitForTimeout(600);
        const over = (await page.evaluate(`(() => {
          const o = document.querySelector(".phone-modal-overlay");
          if (!o) return null;
          return {
            rows: o.querySelectorAll(".phone-modal-row").length,
            z: Number(getComputedStyle(o).zIndex),
            cardOpen: Boolean(document.querySelector(".account-modal")),
          };
        })()`)) as { rows: number; z: number; cardOpen: boolean } | null;
        if (!over) {
          cannotRun("battlecard: the chooser over the battlecard", "the pill opened nothing");
        } else {
          check(
            "battlecard: the chooser sits OVER the battlecard, which stays open",
            over.z > 1300 && over.cardOpen && over.rows === 7,
            `z-index ${over.z}, battlecard open ${over.cardOpen}, rows ${over.rows}`,
          );
          await page.screenshot({ path: join(OUT, "r39-battlecard-modal.png") });
        }
      }
    }
  }
  await page.context().close();
}

// ── A single-number official: a direct tel:, and NO modal ────────────────
{
  const page = await openAt(browser, "03255", PHONE, "dark");
  // New Hampshire's governor publishes one number and no office structure.
  if (!(await openHolder(page, "Ayotte"))) {
    cannotRun("single-number official", "no Ayotte row on the who-governs card");
  } else {
    const pills = (await page.evaluate(PILL_CENSUS)) as {
      total: number;
      labels: string[];
      telLinks: number;
      phoneButtons: number;
    } | null;
    if (!pills) {
      cannotRun("single-number official", "no contact pill row on the card");
    } else {
      check(
        "single-number official: the pill IS the tel: link",
        pills.telLinks >= 1 && pills.phoneButtons === 0,
        `tel: pills ${pills.telLinks}, Phone buttons ${pills.phoneButtons} — ${JSON.stringify(pills.labels)}`,
      );
      const noModal = (await page.evaluate(
        `!document.querySelector(".phone-modal-overlay")`,
      )) as boolean;
      check("single-number official: no modal exists on the card", noModal);
      await page.screenshot({ path: join(OUT, "r39-single-number.png") });
    }
  }
  await page.context().close();
}

await browser.close();

console.log(`\nR39 walk — ${BASE}\n`);
for (const line of results) console.log("  " + line);
const failed = results.filter((r) => r.startsWith("FAIL")).length;
const could = results.filter((r) => r.startsWith("CANNOT-RUN")).length;
console.log(
  `\n${results.length - failed - could} pass · ${failed} fail · ${could} could not run\n`,
);
