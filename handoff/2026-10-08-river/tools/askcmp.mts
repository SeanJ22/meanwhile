/* Ask the same questions at the same places and record what renders and how long the answer took. */
import { writeFileSync } from "node:fs";
import { launchGuarded } from "../scripts/browser.mts";
import { askAndRead, openAskAt } from "../scripts/ask-harness.mts";

const BASE = process.env.ASKCMP_BASE ?? "http://localhost:3000";
const OUT = process.env.ASKCMP_OUT!;
const ZIPS = ["02916", "07432", "17032", "22749", "38879", "46052", "54947", "55310", "96731", "99020", "85701", "03301"];
const QUESTIONS = [
  "Who represents me in Congress?",
  "When is the next public meeting near me?",
  "What did the school board decide at its last meeting?",
];

const browser = await launchGuarded({ label: "askcmp", executablePath: "/opt/pw-browsers/chromium" } as never);
const rows: unknown[] = [];
for (const zip of ZIPS) {
  const page = await openAskAt(browser, `${BASE}/?zip=${zip}`, zip);
  const timings: number[] = [];
  page.on("requestfinished", (request) => {
    if (!request.url().includes("/api/ask/grounded")) return;
    const t = request.timing();
    timings.push(Math.round(t.responseEnd));
  });
  for (const question of QUESTIONS) {
    const before = timings.length;
    const seen = await askAndRead(page, question);
    rows.push({
      zip, question, serverMs: timings.length > before ? timings[timings.length - 1] : null,
      settledMs: seen.elapsedMs, wall: seen.wall,
      mode: seen.answer.mode, subject: seen.answer.subjectName, answer: seen.answer.answerText,
      records: seen.answer.recordTexts.length, gaps: seen.answer.gapStatements, sources: seen.answer.sourceCount,
    });
    console.log(JSON.stringify(rows.at(-1)).slice(0, 220));
  }
  await page.context().close();
}
await browser.close();
writeFileSync(OUT, JSON.stringify(rows, null, 2));
