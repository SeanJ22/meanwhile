// Capture the ordinary public UI and its own read-only responses, with verified TLS.
import { launchGuarded } from "./browser.mts";
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const directory = '/tmp/ba01-northeast-nyc-capture';
await mkdir(directory, { recursive: true });
const captures = [];
let contestList;
async function save(name, url, body) {
  const retrievedAt = new Date().toISOString();
  await writeFile(`${directory}/${name}`, body);
  captures.push({ name, requestedUrl: url, finalUrl: url, retrievedAt, httpStatus: 200,
    rawHash: createHash('sha256').update(body).digest('hex') });
}
const browser = await launchGuarded({ label: 'ba01-nyc-capture', headless: true, ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}) });
try {
  const context = await browser.context();
  // APIRequest uses the configured environment CA; browser requests retain their
  // ordinary headers, cookies and normal public UI behavior through this route.
  await context.route('**/*', async route => {
    try {
      const response = await context.request.fetch(route.request());
      const url = response.url();
      if (response.ok()) {
        let name;
        if (url.includes('findmypollsite.vote.nyc/api/nycsettings')) name = 'nyc-10001-settings.json';
        if (url.includes('electionstreet.com/api/nyc/addresses')) name = 'nyc-10001-geocode.jsonp';
        if (url.includes('findmypollsite.vote.nyc/api/pollsiteinfo')) name = 'nyc-10001-pollsite.json';
        if (url.includes('findmypollsite.vote.nyc/api/contestlist')) name = 'nyc-10001-contests.json';
        if (name) {
          const body = await response.body();
          await save(name, url, body);
          if (name === 'nyc-10001-contests.json') contestList = JSON.parse(body.toString());
        }
      }
      await route.fulfill({ response });
    } catch { await route.abort(); }
  });
  const page = await context.newPage();
  await page.goto('https://findmypollsite.vote.nyc/?hn=315&sn=West+29th+Street&zip=10001', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 });
  const body = await page.locator('body').innerText();
  if (!body.includes('General Election 2026') || !contestList) throw new Error('Normal public lookup did not return the 2026 general ballot');
  await writeFile(`${directory}/nyc-10001-rendered.html`, await page.content());
  const sampleUrl = contestList.parties[0].ballotStyles[0].sample_ballot_url;
  const sample = await context.request.get(sampleUrl);
  if (!sample.ok()) throw new Error(`Official sample PDF returned ${sample.status()}`);
  await save('nyc-10001-style491-sample.pdf', sampleUrl, await sample.body());
  await writeFile(`${directory}/nyc-10001-captures.json`, JSON.stringify(captures, null, 2) + '\n');
  console.log(JSON.stringify({ directory, captures: captures.length, contests: contestList.parties[0].contests.length }));
} finally { await browser.close(); }
