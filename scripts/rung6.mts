/**
 * Rung 6 as a command: the live browser with JavaScript executed and content
 * awaited, walked deliberately whatever rung 2 said (a JS-rendered page can
 * answer rung 2 with HTTP 200 and an empty detail region).
 *
 * ```
 * pnpm rung6 <url> [--out <file>] [--wait <ms>] [--selector <css>] [--html]
 * ```
 *
 * Reports the rendered text, bytes before script ran against bytes after, and
 * the contacts in the rendered DOM including those only in an `href`. The
 * browser is opened through `scripts/browser.mts`, so the run declares itself.
 */
import { writeFileSync } from "node:fs";

import { launchGuarded } from "./browser.mts";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const url = process.argv[2];
if (!url || url.startsWith("--")) {
  console.error("usage: pnpm rung6 <url> [--out <file>] [--wait <ms>] [--selector <css>] [--html]");
  process.exit(2);
}

const waitMs = Number(arg("--wait") ?? 4000);
const selector = arg("--selector");
const wantHtml = process.argv.includes("--html");
const out = arg("--out");

const UA = "we-the-people civic data (contact: seanj22@gmail.com)";

/* Rung 2 first, so the run can state what the browser actually ADDED. */
let beforeBytes = 0;
let beforeStatus = 0;
try {
  const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
  beforeStatus = res.status;
  beforeBytes = (await res.text()).length;
} catch {
  beforeStatus = 0;
}

const browser = await launchGuarded({ label: "rung6" });
const page = await browser.page();
let renderedHtml = "";
let text = "";
let title = "";
let finalUrl = url;
let error: string | null = null;

try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  if (selector) {
    await page.waitForSelector(selector, { timeout: 30_000 }).catch(() => {});
  }
  await page.waitForTimeout(waitMs);
  renderedHtml = await page.content();
  title = await page.title();
  finalUrl = page.url();
  text = await page.evaluate("document.body ? document.body.innerText : ''");
} catch (err) {
  error = String(err);
} finally {
  await browser.close();
}

const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE = /\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g;
const NOISE = /sentry|wixpress|@example|noreply|no-reply|revize|\.png|\.jpg|\.gif|@2x|sentry\.io/i;

const inText = {
  emails: [...new Set(text.match(EMAIL) ?? [])].filter((e) => !NOISE.test(e)),
  phones: [...new Set(text.match(PHONE) ?? [])],
};
/* A contact can be in the href and not in the cell. */
const inHref = {
  emails: [
    ...new Set(
      [...renderedHtml.matchAll(/href="mailto:([^"?]+)/gi)].map((m) => m[1]!.trim()),
    ),
  ].filter((e) => !NOISE.test(e)),
  phones: [
    ...new Set([...renderedHtml.matchAll(/href="tel:([^"]+)/gi)].map((m) => m[1]!.trim())),
  ],
};

console.log(`\nRUNG 6 — ${url}`);
if (finalUrl !== url) console.log(`  redirected to  ${finalUrl}`);
if (error) console.log(`  ERROR  ${error}`);
console.log(`  title          ${title || "(none)"}`);
console.log(`  rung 2         HTTP ${beforeStatus}, ${beforeBytes} bytes`);
console.log(`  rung 6         ${renderedHtml.length} bytes rendered, ${text.length} chars of text`);

/* A refusal at rung 6 (a WAF blocking the browser) is not "the browser added nothing". */
const blocked = /error 40[13]|web page blocked|access denied|attack id|are you human|just a moment/i.test(
  `${title} ${text.slice(0, 600)}`,
);
const grew = renderedHtml.length - beforeBytes;
console.log(
  `  the browser    ${
    blocked
      ? 'was REFUSED — this host walls rung 6 while answering rung 2. A wall, never an absence; escalate to rung 5 or read the index page instead.'
      : grew > 0
        ? `ADDED ${grew} bytes — rung 2 was a false miss on this page`
        : `added nothing (${grew}) — this page is not JS-rendered, and rung 2 was honest`
  }`,
);
console.log(`  emails         text ${inText.emails.length} · href ${inHref.emails.length}`);
for (const e of new Set([...inText.emails, ...inHref.emails])) console.log(`      ${e}`);
console.log(`  phones         text ${inText.phones.length} · href ${inHref.phones.length}`);
for (const p of new Set([...inText.phones, ...inHref.phones])) console.log(`      ${p}`);

const hrefOnly = inHref.emails.filter((e) => !inText.emails.includes(e));
if (hrefOnly.length > 0) {
  console.log(
    `  NOTE           ${hrefOnly.length} email(s) exist ONLY in an href and are invisible to a text read`,
  );
}

if (out) {
  writeFileSync(out, wantHtml ? renderedHtml : text, "utf8");
  console.log(`  written        ${out} (${wantHtml ? "rendered html" : "rendered text"})`);
} else if (!wantHtml) {
  console.log(`\n${text.slice(0, 4000)}`);
}
console.log("");
