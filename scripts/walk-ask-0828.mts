import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { launchGuarded } from "./browser.mts";

/**
 * **READING WHAT THE READER READS — the Ask surfaces, desktop and phone.**
 * (PR #212 follow-up, 2026-08-28.)
 *
 * ## Why this exists rather than one more API assertion
 *
 * The route tests already prove the server. They proved the server in PR #212
 * too, and the map Ask box still called a different endpoint — so a correct
 * server reply that no client renders is a product defect with a green suite
 * standing next to it. The previous session found the same class twice by
 * reading the SENTENCE rather than the DOM: a ballot reply whose `answer` was
 * null rendered an empty panel back at a reader who had just typed a question,
 * and every earlier check passed.
 *
 * So this types into the real input, presses the real button, and records the
 * LITERAL VISIBLE TEXT of the panel. Nothing here reads a data attribute in
 * place of a sentence.
 *
 * ## What it targets
 *
 * A LOCAL PRODUCTION BUILD, on the port given in `ASK_WALK_BASE`. Local,
 * because this exercises the branch that has to be right before it ships, and
 * because a walk of production would be a walk of the code this session is
 * replacing.
 *
 * Every context comes from `launchGuarded`, so every request declares itself
 * synthetic and no beacon can leak an undeclared row into the sold store.
 */

const BASE = (process.env.ASK_WALK_BASE ?? "http://127.0.0.1:3111").replace(/\/$/, "");
const OUT = process.argv[2] ?? "data/hunt/ask-walk-0828";
const ZIP = "85641";

const PHONE = { width: 430, height: 932 };
const DESKTOP = { width: 1440, height: 900 };

/** The questions the brief names, plus the ones that must REFUSE. */
const MAP_QUESTIONS = [
  "What's on the Vail school district agenda?",
  "What did Vail discuss at its last meeting?",
  "What did Katie Hobbs do for the state of Arizona in the last 12 months?",
];

const BALLOT_QUESTIONS = [
  "What has Katie Hobbs done?",
  "What do we know about Andy Biggs?",
  "What does Prop 423 do?",
  "Who is running for Governor?",
  "What's on the Cienega school district agenda?",
];

mkdirSync(OUT, { recursive: true });

const guarded = await launchGuarded({
  label: "ask-walk-0828",
  now: () => new Date("2026-08-28T00:00:00Z"),
});

interface Capture {
  surface: string;
  viewport: string;
  question: string;
  mode: string | null;
  subject: string | null;
  visibleText: string;
  contacts: number;
  shot: string;
}

const captures: Capture[] = [];

async function walkMap(viewport: { width: number; height: number }, label: string) {
  const context = await guarded.context({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await context.addInitScript(
    ({ zip }) => {
      try {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip, savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.tutorial_seen", "1");
        /* The reader TYPED this zip, which is what makes the row a
           self-declared home zip rather than a demonstration chip. */
        sessionStorage.setItem(
          "wtp.location_origin",
          JSON.stringify({ zip, origin: "TYPED_ZIP" }),
        );
      } catch {
        /* A browser refusing storage still gets the product; the walk just
           lands on the welcome card and the read below fails honestly. */
      }
    },
    { zip: ZIP },
  );
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(5000);

  /*
   * The Ask panel lives behind a pill on the map shell, exactly as
   * `scripts/walk-all.mts` reaches it. A walk that could not find the input
   * was measuring its own selector rather than the product.
   */
  if ((await page.locator("[data-ask-panel]").count()) === 0) {
    const pill = page.locator("[data-ask-pill]").first();
    if ((await pill.count()) > 0) {
      await pill.click();
      await page.waitForTimeout(1500);
    }
  }

  for (const [index, question] of MAP_QUESTIONS.entries()) {
    const input = await page.$("[data-ask-box]");
    if (!input) {
      captures.push({
        surface: "MAP",
        viewport: label,
        question,
        mode: null,
        subject: null,
        visibleText: "ASK INPUT NOT FOUND — the panel did not render",
        contacts: 0,
        shot: "",
      });
      break;
    }
    await input.click();
    await input.fill(question);
    await input.press("Enter");
    /* The panel holds a drawn 2.4-3.1s presentation beat before it renders, so
       this waits past the ceiling rather than racing it. */
    await page.waitForTimeout(14000);

    const read = (await page.evaluate(
      `(function () {
        var g = document.querySelector("[data-ask-grounded]");
        return {
          mode: g ? g.getAttribute("data-ask-grounded-mode") : null,
          subject: g ? g.getAttribute("data-ask-grounded-subject") : null,
          text: g ? (g.innerText || "").trim() : "",
          contacts: g ? (g.querySelectorAll("[data-ask-contacts] li").length) : 0,
          panel: (function () {
            var p = document.querySelector("[data-ask-panel]");
            return p ? (p.innerText || "").trim().slice(0, 2500) : "";
          })()
        };
      })()`,
    )) as { mode: string | null; subject: string | null; text: string; contacts: number; panel: string };

    const shot = join(OUT, `map-${label}-${index}.png`);
    const panel = await page.$("[data-ask-panel]");
    if (panel) await panel.screenshot({ path: shot });
    else await page.screenshot({ path: shot });

    captures.push({
      surface: "MAP",
      viewport: label,
      question,
      mode: read.mode,
      subject: read.subject,
      visibleText: read.text || read.panel,
      contacts: read.contacts,
      shot,
    });
  }
  await context.close();
}

async function walkBallot(viewport: { width: number; height: number }, label: string) {
  const context = await guarded.context({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(`${BASE}/ballot?zip=${ZIP}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(2500);

  for (const [index, question] of BALLOT_QUESTIONS.entries()) {
    const input = await page.$("[data-ballot-ask] [data-ask-input]");
    if (!input) {
      captures.push({
        surface: "BALLOT",
        viewport: label,
        question,
        mode: null,
        subject: null,
        visibleText: "BALLOT ASK INPUT NOT FOUND",
        contacts: 0,
        shot: "",
      });
      break;
    }
    await input.click();
    await input.fill(question);
    await page.click("[data-ballot-ask] [data-ask-submit]");
    await page.waitForTimeout(12000);

    const read = (await page.evaluate(
      `(function () {
        var s = document.querySelector("[data-ballot-ask]");
        var m = s ? s.querySelector("[data-ask-mode]") : null;
        return {
          mode: m ? m.getAttribute("data-ask-mode") : null,
          text: s ? (s.innerText || "").trim() : "",
          contacts: s ? s.querySelectorAll("[data-ask-contacts] li").length : 0
        };
      })()`,
    )) as { mode: string | null; text: string; contacts: number };

    const shot = join(OUT, `ballot-${label}-${index}.png`);
    const section = await page.$("[data-ballot-ask]");
    if (section) await section.screenshot({ path: shot });

    captures.push({
      surface: "BALLOT",
      viewport: label,
      question,
      mode: read.mode,
      subject: null,
      visibleText: read.text,
      contacts: read.contacts,
      shot,
    });
  }
  await context.close();
}

try {
  await walkMap(DESKTOP, "desktop");
  await walkMap(PHONE, "phone");
  await walkBallot(DESKTOP, "desktop");
  await walkBallot(PHONE, "phone");
} finally {
  await guarded.close();
}

writeFileSync(join(OUT, "captures.json"), JSON.stringify(captures, null, 2), "utf8");
for (const c of captures) {
  console.log(`\n=== ${c.surface} · ${c.viewport} · ${c.question}`);
  console.log(`    mode=${c.mode ?? "-"} subject=${c.subject ?? "-"} contacts=${c.contacts}`);
  console.log(
    c.visibleText
      .split("\n")
      .map((l) => `    | ${l}`)
      .join("\n"),
  );
}
console.log(`\nwritten to ${OUT}`);
