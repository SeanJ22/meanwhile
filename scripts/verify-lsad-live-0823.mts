/**
 * **THE ELEVEN THE LSAD SWAP MISLABELLED, READ OFF THE LIVE PAGE.**
 * (`NH106` session, 2026-08-23, item 2.)
 *
 * ## The claim this serves
 *
 * `classKeyFor` had Census LSAD 43 and 44 reversed, so New Jersey's TOWNSHIP
 * definition rendered on **Morristown, Kearny, Dover, Newton, Boonton,
 * Westfield, Clinton, Hackettstown, Phillipsburg, Harrison and Belvidere**.
 * None is a township. The fix shipped in `9399a69`.
 *
 * ## Why this drives a browser instead of asking an API
 *
 * There is no endpoint that serves a class definition.
 * `/api/representation/...` returns SEAT HOLDERS, and asking it about
 * Morristown returns `{"ocdId":null,"holders":[]}` — which a check written
 * against a status code would have read as a healthy answer to a question it
 * never asked. The definition exists only on the rendered card, so the
 * rendered card is what gets read.
 *
 * A local check against `definitionsForBody` was run first and passed 11 of 11
 * (RULING 77: verify locally, ship once). **That is a different claim from
 * this one** and does not stand in for it: it proves the resolver is right,
 * and this proves the deployed build is serving what the resolver says.
 *
 * ## What it asks each page, and the first version that was WRONG about it
 *
 * The definition is not on the entry surface. It lives on the body's own card,
 * behind two interactions: click the municipality in the who-governs list,
 * then open its **What this body does** tab.
 *
 * The first version of this script never did either. It read the entry
 * surface, found no `This is a New Jersey <form>` string anywhere, and
 * reported **OK for six municipalities on the grounds that none of them was
 * called a township** — which was true and worthless, because no definition
 * rendered on that surface at all. That is a check reading like a pass while
 * never reaching its subject, which is the failure this repo names most often,
 * and it was caught only because the output said `(none rendered)` next to the
 * word OK.
 *
 * So the subject is opened. A municipality whose card cannot be reached is
 * `CANNOT RUN` and is counted apart from a pass and apart from a failure
 * (RULING 24).
 *
 * ONE ZIP PER MUNICIPALITY, because the card follows the reader. Each zip is
 * asserted to have actually resolved to the municipality being tested — a zip
 * that quietly resolved somewhere else would produce a green line about the
 * wrong government, which is the enumeration failure RULING 67 names. The
 * button match is anchored (`^Morristown`) so `Morris township`, which sits
 * three rows above it in the same list, cannot answer for it.
 */
import { launchGuarded } from "./browser.mts";

const BASE = process.env.WTP_BASE ?? "https://sparkwtp.netlify.app";

/**
 * **THE PLANT — a real township, which MUST read as one.**
 *
 * Not one of the eleven, and not counted with them. It is here because a
 * detector that cannot find the thing it is looking for reports green about
 * nothing, and this one already did exactly that once: it searched only for
 * `This is a New Jersey <form>`, which the township definition does not say.
 *
 * Rockaway township at 07866 is a genuine New Jersey township. If this row
 * ever stops being detected as one, the detector has gone blind and every OK
 * above it is worthless.
 */
const PLANT = { name: "Rockaway township", zip: "07866" };

/** Municipality, its own zip, and the form the page must NOT call it. */
const ELEVEN: { name: string; zip: string }[] = [
  { name: "Morristown", zip: "07960" },
  { name: "Kearny", zip: "07032" },
  { name: "Dover", zip: "07801" },
  { name: "Newton", zip: "07860" },
  { name: "Boonton", zip: "07005" },
  { name: "Westfield", zip: "07090" },
  { name: "Clinton", zip: "08809" },
  { name: "Hackettstown", zip: "07840" },
  { name: "Phillipsburg", zip: "08865" },
  { name: "Harrison", zip: "07029" },
  { name: "Belvidere", zip: "07823" },
];

/**
 * **WHICH DEFINITION A CARD IS CARRYING — BY EACH ONE'S OWN OPENING WORDS.**
 *
 * The second thing this script got wrong, and it is RULING 110 pointed at the
 * instrument rather than at the world. The first working version searched for
 * `This is a New Jersey (\w+)` and asked whether the captured word was
 * `township`.
 *
 * **The township definition does not use that sentence.** It opens *"In New
 * Jersey a township is a TYPE of municipality, not a form of government"* —
 * deliberately, because that distinction is the point of it. So the detector
 * could not match a township at all: a municipality still carrying the wrong
 * definition would have come back as `CANNOT RUN`, never as `WRONG`.
 *
 * **A sweep that cannot find the defect it was written for is a sweep
 * reporting green about nothing.** It was caught by capturing Rockaway
 * township — a real township, which must read as one — and seeing the script
 * say `(no definition)` about a card whose definition was plainly on screen in
 * the photograph.
 *
 * Each form is now recognised by ITS OWN opening words, and the township one
 * is proven against the live Rockaway township card rather than assumed.
 */
function whichDefinition(text: string): string | null {
  if (/In New Jersey a township is a TYPE of municipality/.test(text)) return "township";
  const m = /This is a New Jersey (\w+)/.exec(text);
  return m === null ? null : m[1];
}

const browser = await launchGuarded({ label: "verify-lsad-0823" });
console.log(`LSAD verification against ${BASE}\n`);

let correct = 0;
let wrong = 0;
let couldNotRun = 0;

let plantDetected = false;

for (const target of [...ELEVEN, PLANT]) {
  const isPlant = target === PLANT;
  const context = await browser.context({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  await context.addInitScript(
    ({ zip }) => {
      try {
        sessionStorage.setItem(
          "wtp.approximate_location",
          JSON.stringify({ zip, savedAt: new Date().toISOString() }),
        );
        localStorage.setItem("wtp.tutorial_seen", "1");
      } catch {
        /* The walk types the zip instead. */
      }
    },
    { zip: target.zip },
  );
  const page = await context.newPage();
  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(9_000);

    /* Anchored, so `Morris township` cannot answer for `Morristown`. */
    const row = page.getByRole("button", { name: new RegExp(`^${target.name}`) }).first();
    if ((await page.getByRole("button", { name: new RegExp(`^${target.name}`) }).count()) === 0) {
      couldNotRun += 1;
      console.log(
        `CANNOT RUN  ${target.name.padEnd(14)} ${target.zip} — no who-governs row for it, so its ` +
          "card cannot be opened. Not a pass and not a failure.",
      );
      await context.close();
      continue;
    }
    await row.click();
    await page.waitForTimeout(4_000);

    const tab = page.getByRole("button", { name: /What this body does/ }).first();
    if ((await page.getByRole("button", { name: /What this body does/ }).count()) === 0) {
      couldNotRun += 1;
      console.log(
        `CANNOT RUN  ${target.name.padEnd(14)} ${target.zip} — the card opened but carries no ` +
          "'What this body does' tab, so there is no definition to read.",
      );
      await context.close();
      continue;
    }
    await tab.click();
    await page.waitForTimeout(2_500);

    const text = await page.locator("body").innerText();
    const carried = whichDefinition(text);

    if (carried === null) {
      couldNotRun += 1;
      console.log(
        `CANNOT RUN  ${target.name.padEnd(14)} ${target.zip} — the tab opened and rendered NO ` +
          "definition this script knows how to recognise. Reporting this as a pass is what the " +
          "first version of this script did.",
      );
      await context.close();
      continue;
    }

    if (isPlant) {
      /* The plant is not scored with the eleven — it measures the INSTRUMENT. */
      plantDetected = carried === "township";
      console.log(
        `${plantDetected ? "PLANT OK   " : "PLANT BLIND"} ${target.name.padEnd(14)} ${target.zip} — ` +
          `a real township; the detector read its card as "${carried}"`,
      );
      await context.close();
      continue;
    }

    if (carried === "township") {
      wrong += 1;
      console.log(
        `WRONG       ${target.name.padEnd(14)} ${target.zip} — its card carries the TOWNSHIP definition`,
      );
    } else {
      correct += 1;
      console.log(`OK          ${target.name.padEnd(14)} ${target.zip} — its card carries the ${carried} definition`);
    }
  } catch (e) {
    couldNotRun += 1;
    console.log(`CANNOT RUN  ${target.name.padEnd(14)} ${target.zip} — ${(e as Error).message.slice(0, 90)}`);
  }
  await context.close();
}

await browser.close();

console.log(
  `\n  correct ${correct} of ${ELEVEN.length} · wrong ${wrong} · could not run ${couldNotRun}`,
);
console.log(
  "  A CANNOT RUN is reported apart from a failure (RULING 24) — an unreachable subject is not a defect in the fix.",
);
console.log(
  `  plant: a real township ${plantDetected ? "WAS" : "was NOT"} detected as one — ` +
    "without this line every OK above is a detector that may simply be blind.",
);
process.exitCode = wrong === 0 && plantDetected ? 0 : 1;
