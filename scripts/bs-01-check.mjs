/** Read-only cold Ballot measurement. Run Node with --experimental-strip-types for the shared browser guard.
 * Both directories must already contain production builds.
 * DATABASE_URL must have no write privileges. BS01_BASELINE_ROOT identifies the before build.
 * BS01_BEFORE_HTTP_FILE reuses an explicitly selected 51-response capture and its
 * .metadata.json sidecar after verifying its bytes, states, status and build identity.
 * BS01_OUTPUT selects the results directory. Each Ballot request gets a fresh server process.
 */
import { launchGuarded, runIdFor } from './browser.mts';
import { syntheticRunHeaders } from '../lib/db/run-marker.ts';
import { PUBLIC_SITE_ORIGIN } from '../lib/ops/origins.ts';
import { neon } from '@neondatabase/serverless';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import http from 'node:http';

const root = process.cwd();
const runId = runIdFor('bs-01-cold');
process.env.WTP_RUN_ID = runId;
const runHeaders = syntheticRunHeaders({ WTP_RUN_ID: runId });
const beforeRoot = process.env.BS01_BASELINE_ROOT && resolve(process.env.BS01_BASELINE_ROOT);
const beforeFile = process.env.BS01_BEFORE_HTTP_FILE && resolve(process.env.BS01_BEFORE_HTTP_FILE);
const output = resolve(process.env.BS01_OUTPUT ?? '.scratch/bs01-measurement');
if ((!beforeRoot && !beforeFile) || !process.env.DATABASE_URL) throw Error('A baseline build or explicit HTTP capture and a production read-only DATABASE_URL are required');
const sql = neon(process.env.DATABASE_URL);
const [[role]] = await sql.transaction([sql.query(`SELECT current_user AS role, current_setting('transaction_read_only') AS read_only,
  EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT,UPDATE,DELETE')) AS can_write`)], { readOnly: true });
if (role.read_only !== 'on' || role.can_write !== false) throw Error('Production connection is not read-only');
const zips = { AL:'36104',AK:'99801',AZ:'85701',AR:'72201',CA:'95814',CO:'80203',CT:'06103',DE:'19901',FL:'32301',GA:'30303',HI:'96813',ID:'83702',IL:'62701',IN:'46204',IA:'50309',KS:'66603',KY:'40601',LA:'70802',ME:'04330',MD:'21401',MA:'02108',MI:'48933',MN:'55102',MS:'39201',MO:'65101',MT:'59601',NE:'68508',NV:'89701',NH:'03301',NJ:'08608',NM:'87501',NY:'12207',NC:'27601',ND:'58501',OH:'43215',OK:'73102',OR:'97301',PA:'17101',RI:'02903',SC:'29201',SD:'57501',TN:'37219',TX:'78701',UT:'84111',VT:'05602',VA:'23219',WA:'98501',WV:'25301',WI:'53703',WY:'82001',DC:'20001' };
const places = Object.entries(zips);
await mkdir(output, { recursive: true });
const save = (name, value) => writeFile(`${output}/${name}.json`, JSON.stringify(value, null, 2));
const measuredBuildId = (await readFile(`${root}/.next/BUILD_ID`, 'utf8')).trim();
await save('measurement-context', { startedAt: new Date().toISOString(), buildId: measuredBuildId, runId, role });
const message = error => String(error).split(process.env.DATABASE_URL).join('[read-only connection]');
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

async function start(directory, port) {
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port)], {
    cwd: directory, env: { ...process.env, WTP_VITAL_SIGNS_REPORT: '1', WTP_DB_ROLE: 'production' }, stdio: ['ignore','pipe','pipe'],
  });
  let log = '';
  try {
    await new Promise((ready, fail) => {
      const timer = setTimeout(() => fail(Error('Server startup timed out')), 30000);
      child.stdout.on('data', chunk => { log += chunk; if (log.includes('Ready')) { clearTimeout(timer); ready(); } });
      child.stderr.on('data', chunk => { log += chunk; });
      child.once('exit', () => { clearTimeout(timer); fail(Error('Server exited before readiness')); });
    });
    return child;
  } catch (error) { child.kill('SIGKILL'); throw error; }
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
  await exited;
  clearTimeout(timer);
}

async function responseSweep(directory, name) {
  const rows = [];
  // Measure one cold action at a time; its independent data reads still run together.
  for (const [state, zip] of places) {
    const port = 3210;
    const server = await start(directory, port);
    try {
      const start = performance.now();
      const response = await fetch(`http://127.0.0.1:${port}/ballot?zip=${zip}`, { signal: AbortSignal.timeout(30000), headers: runHeaders });
      const firstMs = performance.now() - start;
      const html = await response.text(), fullMs = performance.now() - start;
      const ids = [...new Set([...html.matchAll(/data-contest-id="([^"]+)"/g)].map(match => match[1]))];
      rows.push({ state, zip, status: response.status, firstMs, fullMs, ids,
        candidates: [...html.matchAll(/data-candidate-target="([^"]+)"/g)].length,
        fundingSections: [...html.matchAll(/data-candidate-funding(?:=|[ >])/g)].length,
        holdingGaps: html.includes('data-ballot-canonical-holding-gaps'), error: html.includes('Something went wrong') });
    } catch (error) { rows.push({ state, zip, error: message(error) }); }
    finally { await stop(server); await save(name, rows); console.log(JSON.stringify({ phase: name, ...rows.find(row => row.state === state), ids: undefined })); }
  }
  return rows;
}

let before, beforeSource;
if (beforeFile) {
  const bytes = await readFile(beforeFile);
  before = JSON.parse(bytes);
  beforeSource = JSON.parse(await readFile(`${beforeFile}.metadata.json`, 'utf8'));
  const validIdentity = /^[a-f0-9]{40}$/.test(beforeSource.sourceSha ?? '') &&
    typeof beforeSource.sourceBuildId === 'string' && beforeSource.sourceBuildId.length > 0 && beforeSource.readonlyRole === 'readonly';
  const validRows = Array.isArray(before) && before.length === places.length && new Set(before.map(row => row.state)).size === places.length &&
    places.every(([state, zip]) => before.some(row => row.state === state && row.zip === zip && row.status === 200 && !row.error &&
      Array.isArray(row.ids) && row.ids.every(id => typeof id === 'string') && Number.isFinite(row.fullMs) && row.fullMs > 0 &&
      Number.isInteger(row.candidates) && row.candidates >= 0 && Number.isInteger(row.fundingSections) && row.fundingSections >= 0));
  if (!validIdentity || !validRows || beforeSource.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw Error('The selected before capture failed state/status/build/hash validation');
  if (resolve(beforeFile) !== `${output}/before-http.json`) await writeFile(`${output}/before-http.json`, bytes);
  beforeSource = { ...beforeSource, reusedFrom: beforeFile, reuseCheckedAt: new Date().toISOString() };
  console.log(JSON.stringify({ phase: 'before-http-reused', places: before.length, sourceSha: beforeSource.sourceSha, sourceBuildId: beforeSource.sourceBuildId }));
} else {
  before = await responseSweep(beforeRoot, 'before-http');
  const bytes = await readFile(`${output}/before-http.json`);
  beforeSource = { capturedAt: new Date().toISOString(), sourceRoot: beforeRoot,
    sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: beforeRoot, encoding: 'utf8' }).trim(),
    sourceBuildId: (await readFile(`${beforeRoot}/.next/BUILD_ID`, 'utf8')).trim(), readonlyRole: role.role,
    rows: before.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
await writeFile(`${output}/before-http.json.metadata.json`, JSON.stringify(beforeSource, null, 2));
const after = await responseSweep(root, 'after-http');
const failures = [];
for (const row of after) {
  const original = before.find(held => held.state === row.state);
  if (row.status !== 200 || row.error || row.holdingGaps || !(row.fullMs < 3000)) failures.push(`${row.state}: cold full response failed`);
  if (!original?.ids || !same(row.ids ?? [], original.ids)) failures.push(`${row.state}: contest IDs differ from before`);
  if (row.candidates !== original?.candidates || row.fundingSections < original?.fundingSections) failures.push(`${row.state}: candidate or funding sections were lost`);
}

// The map uses another process. Every Ballot server below has empty state, place and ballot caches.
const settingsResponse = await fetch(`${PUBLIC_SITE_ORIGIN}/api/reader/settings`, { signal: AbortSignal.timeout(15000), headers: runHeaders });
if (!settingsResponse.ok) throw Error('Public reader settings could not be read');
const settings = Buffer.from(await settingsResponse.arrayBuffer());
const map = await start(root, 3221), browser = await launchGuarded({ label: 'bs-01-cold', blockWrites: true, headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
let ballotRequests = [];
const proxy = http.createServer((request, response) => {
  if (request.url.startsWith('/ballot')) ballotRequests.push(Date.now());
  const upstream = http.request({ host: '127.0.0.1', port: request.url.startsWith('/ballot') ? 3222 : 3221,
    path: request.url, method: request.method, headers: request.headers }, incoming => { response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response); });
  upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
  response.on('close', () => upstream.destroy()); request.pipe(upstream);
});
await new Promise(ready => proxy.listen(3220, '127.0.0.1', ready));
const painted = [];
try {
  for (const [state, zip] of places) {
    ballotRequests = [];
    const server = await start(root, 3222), context = await browser.context({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors = []; let clicked = false;
    page.on('pageerror', error => errors.push(message(error)));
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (!['GET','HEAD'].includes(request.method()) || (!clicked && url.pathname === '/ballot')) return route.abort();
      if (url.pathname === '/ballot' && (request.headers()['next-router-prefetch'] || request.headers()['next-router-segment-prefetch'])) return route.abort();
      if (url.pathname === '/api/reader/settings') return route.fulfill({ status: 200, contentType: 'application/json', body: settings });
      if (url.pathname.startsWith('/api/boundaries/')) return route.abort();
      return route.fallback();
    });
    try {
      await page.goto(`http://127.0.0.1:3220/?zip=${zip}`, { waitUntil: 'domcontentloaded' });
      await page.locator(`.mw-nav-ballot[href*="${zip}"]:visible`).waitFor({ timeout: 30000 });
      // A resident must dismiss first-visit dialogs before the map's Ballot link is clickable.
      // A DOM click behind the native tour modal measures its opening layout as navigation.
      await page.getByRole('button', { name: 'Skip the tour', exact: true }).click({ timeout: 30000 });
      const keepView = page.getByRole('button', { name: 'Keep current view', exact: true });
      if (await keepView.isVisible()) await keepView.click();
      await page.waitForFunction(() => Number(document.querySelector('[data-stat="officials"] .num')?.textContent) > 0, null, { timeout: 30000 });
      const wanted = after.find(row => row.state === state);
      if (!wanted.ids?.length) throw Error('No complete reference ballot');
      await page.locator(`.mw-nav-ballot[href*="${zip}"]:visible`).hover();
      clicked = true;
      await page.evaluate(wanted => {
        const link = [...document.querySelectorAll('.mw-nav-ballot')].find(element => element.getClientRects().length);
        window.bs01 = { click: 0 };
        const complete = () => wanted.ids.every(id => [...document.querySelectorAll('[data-contest-id]')].some(element => element.getAttribute('data-contest-id') === id && element.getClientRects().length))
          && document.querySelectorAll('[data-candidate-target]').length === wanted.candidates
          && document.querySelectorAll('[data-candidate-funding]').length === wanted.fundingSections;
        new MutationObserver(() => {
          const state = window.bs01; if (!state.click) return;
          if (!state.reactionMs && (document.querySelector('.mw-route-body') || link.textContent.includes('Opening')))
            requestAnimationFrame(() => { state.reactionMs ??= performance.now() - state.click; });
          if (!state.fullMs && !state.paintPending && complete()) {
            state.paintPending = true;
            requestAnimationFrame(() => requestAnimationFrame(() => { if (complete()) state.fullMs = performance.now() - state.click; else state.paintPending = false; }));
          }
        }).observe(document.body, { subtree: true, childList: true, characterData: true });
        link.addEventListener('click', () => { window.bs01.click = performance.now(); window.bs01.clickEpoch = Date.now(); }, { once: true });
      }, wanted);
      await page.locator(`.mw-nav-ballot[href*="${zip}"]:visible`).click();
      await page.waitForFunction(() => window.bs01.fullMs, null, { timeout: 20000 });
      const result = await page.evaluate(() => ({ ...window.bs01,
        ids: [...new Set([...document.querySelectorAll('[data-contest-id]')].map(element => element.getAttribute('data-contest-id')))],
        candidates: document.querySelectorAll('[data-candidate-target]').length,
        fundingSections: document.querySelectorAll('[data-candidate-funding]').length,
        holdingGaps: Boolean(document.querySelector('[data-ballot-canonical-holding-gaps]')),
        missingFamilies: [...document.querySelectorAll('[data-ballot-canonical-holding-gaps] li')].map(element => element.textContent) }));
      if (!same(result.ids, wanted.ids) || result.holdingGaps) errors.push('Complete held ballot was not rendered');
      if (!ballotRequests.length || ballotRequests.some(at => at < result.clickEpoch)) errors.push('Ballot server received a request before the click');
      if (!(result.reactionMs < 100)) errors.push('Click reaction reached 100 ms');
      if (!(result.fullMs < 3000)) errors.push('Cold complete ballot reached 3000 ms');
      painted.push({ state, zip, ...result, firstBallotRequestMs: ballotRequests[0] - result.clickEpoch, ids: undefined, errors });
      if (state === 'AZ') await page.screenshot({ path: `${output}/85701.png` });
    } catch (error) { painted.push({ state, zip, errors: [...errors, message(error)] }); }
    finally { await context.close(); await stop(server); await save('browser', painted); console.log(JSON.stringify({ phase: 'browser', ...painted.at(-1) })); }
  }
} finally { await browser.close(); proxy.closeAllConnections(); await new Promise(done => proxy.close(done)); await stop(map); }
for (const row of painted) if (row.errors.length) failures.push(`${row.state}: ${row.errors.join('; ')}`);
const slowest = (rows, field) => rows.filter(row => Number.isFinite(row[field])).sort((a, b) => b[field] - a[field])[0];
const report = { sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), role,
  buildId: measuredBuildId,
  beforeSource,
  places: places.length, before: slowest(before, 'fullMs'), after: slowest(after, 'fullMs'),
  browser: slowest(painted, 'fullMs'), reaction: slowest(painted, 'reactionMs'), failures };
await save('summary', report); console.log(JSON.stringify(report, null, 2));
if (failures.length || before.length !== 51 || after.length !== 51 || painted.length !== 51) process.exitCode = 1;
