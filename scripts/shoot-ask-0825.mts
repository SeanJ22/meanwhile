/**
 * **ASK-9 / ASK-10 / ASK-11 / ASK-8 VERIFICATION, 2026-08-25.**
 *
 * Committed under RULING 76. Runs against a LOCAL PRODUCTION BUILD (RULING
 * 125).
 *
 * **RULING 153 — the reader's route, walked.** Not a call into `resolveRouting`
 * with a fixture: the reader types a question into the box on the map and reads
 * what comes back, so that is what this does. A unit test over the resolver
 * would have passed against either version of `peopleFor`.
 *
 * The two cases are the author's own, from his 8/25 walk:
 *
 *   85701 (`08-58-52`) — ONE district. Six names were boxed in red. The
 *                        superintendent stays, described as running it day to
 *                        day; the five board members go to the card.
 *   07866 (`09-22-18`) — FOUR districts, correctly named, with ONE of their
 *                        rosters printed underneath as though it answered for
 *                        all four. No person may be named here at all.
 *
 * In both cases the STATE REPRESENTATIVES stay: they are the answer to who
 * votes on the law, and the author said to keep them.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Page } from "playwright";

import { launchGuarded } from "./browser.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "screenshots", "visual-0825");
const BASE = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";

mkdirSync(OUT, { recursive: true });

const findings: { id: string; what: string; value: string }[] = [];
const record = (id: string, what: string, value: unknown): void => {
  findings.push({ id, what, value: String(value) });
  console.log(`  ${id.padEnd(10)} ${what}: ${String(value)}`);
};

async function seedZip(page: Page, zip: string): Promise<void> {
  await page.addInitScript(
    ({ zip: z }: { zip: string }) => {
      try {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip: z, savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.tutorial_seen", "1");
      } catch {
        /* the capture will show it */
      }
    },
    { zip },
  );
}

async function main(): Promise<void> {
  const browser = await launchGuarded({ label: "shoot-ask-0825" });
  console.log(`run id: ${browser.runId}`);
  try {
    for (const [zip, expectBodies] of [
      ["85701", 1],
      ["07866", 4],
    ] as const) {
      console.log(`\n--- ${zip} ---`);
      const page = await browser.page({ viewport: { width: 1440, height: 1100 } });
      await seedZip(page, zip);
      await page.goto(BASE, { waitUntil: "networkidle" });
      await page.waitForTimeout(2600);

      // The reader's route: click the ask line, type, press Ask.
      const opener = page.locator(".ask-pill").first();
      await opener.click().catch(() => undefined);
      await page.waitForTimeout(500);
      const input = page.locator(".ask-expansion input").first();
      await input.fill("when does school start").catch(() => undefined);
      await page.keyboard.press("Enter");
      /*
       * The ask-beat acknowledgment ("Let me grab that…") is drawn from a
       * fixed pool while the answer resolves, and the first run of this script
       * PHOTOGRAPHED IT — 316 characters at 85701, one click target, and every
       * name check reporting false about an answer that had not arrived. A
       * capture of a loading state passes a "no board members named" assertion
       * perfectly. So the wait is for the ANSWER, not for a duration, and the
       * timeout is the fallback rather than the mechanism.
       */
      await page
        .locator(".ask-expansion")
        .filter({ hasText: "THE ANSWER" })
        .first()
        .waitFor({ timeout: 20_000 })
        .catch(() => undefined);
      await page.waitForTimeout(1200);

      await page.screenshot({ path: join(OUT, `ask-${zip}.png`) });
      console.log(`  captured ask-${zip}.png`);

      const answer = await page.evaluate(() => {
        const root = document.querySelector(".ask-expansion");
        if (!root) return null;
        const text = (root as HTMLElement).innerText;
        return {
          text,
          // Every clickable name in the answer — bodies and people alike.
          buttons: [...root.querySelectorAll("button")]
            .map((b) => (b.textContent ?? "").trim())
            .filter(Boolean),
          // Anything leaving the product from inside an answer (ASK-8).
          externalLinks: [...root.querySelectorAll("a[href^='http']")].map(
            (a) => (a as HTMLAnchorElement).href,
          ),
        };
      });

      if (!answer) {
        record(zip, "the ask box was reachable", false);
        await page.close();
        continue;
      }

      record(zip, "answer characters rendered", answer.text.length);
      record(zip, "click targets in the answer", answer.buttons.length);
      record(
        zip,
        "external links inside the answer (ASK-8, must be 0)",
        answer.externalLinks.length,
      );

      /*
       * The five Tucson board members and the seven Rockaway ones, by name.
       * Named rather than counted: a count would pass if the list were
       * replaced by five DIFFERENT people, and these are the exact names the
       * author boxed.
       */
      const boardMembers = [
        "Natalie Luna Rose",
        "Jennifer Eckstrom",
        "Val Romero",
        "Sadie Shaw",
        "Dr. Ravi Shah",
        "Alison McGeary",
        "Noël Anderson",
        "Lisa Mezik",
        "Jacalyn Richardson",
        "Jemila Ann Tourne",
        "Jamie Gorman",
        "Rachael Brookes",
      ].filter((name) => answer.text.includes(name));
      record(zip, "board members still named (must be none)", boardMembers.join(", ") || "none");

      record(
        zip,
        "the superintendent is named",
        answer.text.includes("Trujillo"),
      );
      record(
        zip,
        `expected ${expectBodies} district(s) named`,
        expectBodies === 1
          ? answer.text.includes("Tucson Unified District")
          : [
              "Morris Hills Regional School District",
              "Rockaway Township School District",
              "Denville Township School District",
              "Rockaway Borough School District",
            ].filter((d) => answer.text.includes(d)).length,
      );

      // The representatives stay, and ASK-11's spelling is the reader's.
      record(
        zip,
        "state representatives still named",
        ["Alma Hernández", "Betty Villegas", "Aura Dunn", "Marisa Sweeney"].filter((n) =>
          answer.text.includes(n),
        ).join(", ") || "none",
      );
      record(
        zip,
        "ASK-11 run-together title still rendered (must be false)",
        /Assemblymember|Councilmember/.test(answer.text),
      );
      record(
        zip,
        "ASK-11 reader spelling rendered",
        /Assembly member|Council member/.test(answer.text),
      );

      await page.close();
    }

    writeFileSync(
      join(OUT, "ask-findings.json"),
      `${JSON.stringify(findings, null, 2)}\n`,
      "utf8",
    );
    console.log(`\nwrote ${findings.length} finding(s)`);
  } finally {
    await browser.close();
  }
}

await main();
