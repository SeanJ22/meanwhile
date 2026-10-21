// Fetch the official public export with browser form state, while Node verifies HTTPS normally.
// The download contains filed mailing addresses. Keep it out of reader data and console output.
// node --use-env-proxy --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/ba01-west-fetch-montana.mjs /tmp/candidate-list.csv
import { launchGuarded } from "./browser.mts";
import { resolve } from "node:path";

const output = process.argv[2];
if (!output) throw new Error("Pass an output path for the original official CSV.");
const browser = await launchGuarded({ label: "ba01-montana-candidate-export", executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.page();
  await page.route("**/*", async route => {
    const request = route.request(), url = request.url();
    if (!url.startsWith("https://candidatefiling.mt.gov/")) return route.abort();
    const headers = { ...request.headers() };
    for (const name of ["host", "connection", "content-length"]) delete headers[name];
    try {
      const response = await fetch(url, { method: request.method(), headers,
        body: request.postDataBuffer() ?? undefined, signal: AbortSignal.timeout(35_000) });
      const body = Buffer.from(await response.arrayBuffer()), responseHeaders = Object.fromEntries(response.headers);
      for (const name of ["content-encoding", "content-length", "transfer-encoding"]) delete responseHeaders[name];
      await route.fulfill({ status: response.status, headers: responseHeaders, body });
    } catch { await route.abort(); }
  });
  await page.goto("https://candidatefiling.mt.gov/candidatefiling/CandidateList.aspx?e=450002987",
    { waitUntil: "domcontentloaded", timeout: 45_000 });
  const pending = page.waitForEvent("download", { timeout: 25_000 });
  await page.locator('input[title="Export to CSV"]').click();
  const download = await pending;
  if (await download.failure()) throw new Error("Official CSV download failed.");
  await download.saveAs(resolve(output));
  console.log("Saved official Montana candidate CSV.");
} finally { await browser.close(); }
