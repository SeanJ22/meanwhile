/** Cold built reader check against production, one fresh server and guarded browser per state.
 * NODE_USE_ENV_PROXY=1 PLAYWRIGHT_BROWSERS_PATH=/tmp/rs02-playwright node \
 *   --env-file=/tmp/rs02-production.env --experimental-strip-types scripts/rs-02-browser-check.mjs
 * --states=AZ,CA limits a diagnostic run; --out=<directory> keeps separate first-run evidence.
 * Requires an existing production build. Never builds, warms reader APIs, or writes production data.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { launchGuarded, seedZip } from './browser.mts';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const output = resolve(arg('out') ?? '.scratch/rs02/browser');
const connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
if (!connection) throw Error('The existing production readonly connection is required');
const target = new URL(connection);
if (target.username !== 'readonly' || !target.hostname.replace(/-pooler(?=\.)/, '').startsWith('ep-dry-river-axwtolzc.')) throw Error('Expected the production readonly endpoint');
const buildId = (await readFile('.next/BUILD_ID', 'utf8')).trim();
const sql = neon(connection);
const [[identity]] = await sql.transaction([sql.query(`SELECT current_user AS role, current_setting('transaction_read_only') AS read_only,
 EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT,UPDATE,DELETE')) AS can_write`, [])], { readOnly: true });
if (identity.role !== 'readonly' || identity.read_only !== 'on' || identity.can_write) throw Error('The database did not prove read-only access');
const checker = await readFile('scripts/rs-02-check.mts', 'utf8');
const raw = checker.match(/const PROBES: Probe\[\] = (\[[\s\S]*?\n\]);/)?.[1];
if (!raw) throw Error('The existing fifty-state probes were not found');
const allProbes = JSON.parse(raw.replace(/,\s*\]$/, ']'));
const requested = arg('states')?.toUpperCase().split(',');
const probes = allProbes.filter(probe => !requested || requested.includes(probe.state));
if (!probes.length || (!requested && new Set(probes.map(probe => probe.state)).size !== 50)) throw Error('Expected one probe in every state');
await mkdir(output, { recursive: true });
const results = [];
const safeError = error => String(error).split(connection).join('[production readonly connection]');
const save = () => writeFile(`${output}/summary.json`, JSON.stringify({ checkedAt: new Date().toISOString(), buildId,
  productionReadonly: true, freshServerAndBrowserPerState: true, basemapProviderAccess: false, results }, null, 2));

async function startServer(port) {
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port)], {
    env: { ...process.env, DATABASE_URL: connection, WTP_DB_ROLE: 'production', WTP_VITAL_SIGNS_REPORT: '1', NODE_USE_ENV_PROXY: '1', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', data => { log += data; });
  child.stderr.on('data', data => { log += data; });
  try {
    await new Promise((ready, fail) => {
      const timer = setTimeout(() => fail(Error('Server startup timed out')), 20000);
      child.stdout.on('data', () => { if (log.includes('Ready in')) { clearTimeout(timer); ready(); } });
      child.once('exit', code => { clearTimeout(timer); fail(Error(`Server exited before readiness (${code})`)); });
    });
  } catch (error) { child.kill('SIGKILL'); throw error; }
  return { child, log: () => safeError(log) };
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
  const stopped = once(server.child, 'close');
  server.child.kill('SIGTERM');
  const timer = setTimeout(() => server.child.kill('SIGKILL'), 2000);
  await stopped;
  clearTimeout(timer);
}

for (const probe of probes) {
  const errors = [], blocked = [], boundaryRequests = [], bridgeFailures = [];
  const result = { state: probe.state, zip: probe.zip, errors, boundaryRequests, bridgeFailures };
  let server, browser, page;
  try {
    const port = Number(arg('port') ?? 3260);
    server = await startServer(port);
    browser = await launchGuarded({ label: `rs-02-cold-${probe.state}`, headless: true, blockWrites: true,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
    page = await browser.page({ viewport: { width: 1440, height: 1000 } });
    const context = page.context();
    page.on('pageerror', error => errors.push(safeError(error)));
    page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
    page.on('requestfailed', request => {
      const url = new URL(request.url());
      if (['GET', 'HEAD'].includes(request.method()) && url.origin.startsWith('http://localhost:') && url.pathname.startsWith('/api/')) errors.push(`GET failed ${url.pathname}: ${request.failure()?.errorText ?? 'unknown'}`);
    });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (!['GET', 'HEAD'].includes(request.method())) { blocked.push(url.pathname); return route.abort('blockedbyclient'); }
      const boundary = url.pathname.startsWith('/api/boundaries/');
      const bridge = boundary || url.pathname === '/api/reader/settings' || url.pathname === '/api/reader/link-health' || url.pathname.startsWith('/api/portraits/');
      if (!bridge) return route.fallback();
      const productionUrl = `https://meanwhileusa.com${url.pathname}${url.search}`;
      const started = performance.now();
      try {
        const response = await fetch(productionUrl, { signal: AbortSignal.timeout(15000), headers: {
          'x-wtp-synthetic-run': browser.runId,
          ...(request.headers().range ? { Range: request.headers().range } : {}),
        } });
        const body = Buffer.from(await response.arrayBuffer());
        const record = { url: productionUrl, range: request.headers().range ?? null, status: response.status, bytes: body.length, ms: Math.round(performance.now() - started) };
        if (boundary) boundaryRequests.push(record);
        if (!response.ok) bridgeFailures.push(record);
        const headers = Object.fromEntries([...response.headers].filter(([key]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(key)));
        return route.fulfill({ status: response.status, headers, body });
      } catch (error) {
        bridgeFailures.push({ url: productionUrl, error: safeError(error), ms: Math.round(performance.now() - started) });
        return route.abort('failed');
      }
    });
    await seedZip(page, probe.zip);
    await page.addInitScript(() => {
      const evidence = window.rs02 = { reads: [], renders: [], payloads: {} };
      const now = () => performance.now();
      const number = key => {
        const value = document.querySelector(`[data-stat="${key}"] .num`)?.textContent;
        return value && /^\d+$/.test(value) ? Number(value) : null;
      };
      const paint = kind => {
        if (evidence[`${kind}Paint`] || evidence[`${kind}Pending`]) return;
        evidence[`${kind}Pending`] = true;
        requestAnimationFrame(() => requestAnimationFrame(() => { evidence[`${kind}Paint`] = now(); }));
      };
      const observe = () => {
        const row = { ms: now(), meetings: number('meetings'), bodies: number('bodies here'), officials: number('officials'), districts: number('districts in view') };
        const previous = evidence.renders.at(-1);
        if (!previous || ['meetings', 'bodies', 'officials', 'districts'].some(key => previous[key] !== row[key])) evidence.renders.push(row);
        if (row.officials > 0 && evidence.payloads.state) paint('state');
        const { state, place } = evidence.payloads;
        if (state?.coverage && place?.coverage) {
          const bodies = new Set([...state.coverage.bodies, ...place.coverage.bodies].map(body => body.bodyId)).size;
          evidence.expected = { meetings: place.meetings.length, bodies };
          if (row.officials > 0 && row.meetings === place.meetings.length && row.bodies === bodies) paint('information');
        }
        if (row.districts > 0) paint('boundary');
      };
      new MutationObserver(observe).observe(document, { childList: true, subtree: true, characterData: true });
      const original = Response.prototype.json;
      Response.prototype.json = async function () {
        const data = await original.call(this), url = this.url;
        if (url.includes('/api/meetings?') || url.includes('/api/reader/state?')) {
          const kind = url.includes('/api/meetings?') ? 'place' : 'state';
          if (!evidence.payloads[kind]) {
            evidence.payloads[kind] = data;
            evidence.reads.push({ url, kind, status: this.status, ms: now(), serverTiming: this.headers.get('server-timing') });
            observe();
          }
        }
        return data;
      };
    });
    await page.goto(`http://localhost:${port}/?zip=${probe.zip}`, { waitUntil: 'commit' });
    try { await page.waitForFunction(() => window.rs02?.informationPaint && window.rs02?.boundaryPaint, null, { timeout: 20000 }); }
    catch (error) { errors.push(`Information or boundary paint did not finish: ${safeError(error)}`); }
    const measured = await page.evaluate(() => {
      const evidence = window.rs02;
      return { stateMs: evidence.statePaint ?? null, informationMs: evidence.informationPaint ?? null, boundaryMs: evidence.boundaryPaint ?? null,
        reads: evidence.reads, renders: evidence.renders, expected: evidence.expected ?? null,
        dom: { meetings: Number(document.querySelector('[data-stat="meetings"] .num')?.textContent), bodies: Number(document.querySelector('[data-stat="bodies here"] .num')?.textContent),
          officials: Number(document.querySelector('[data-stat="officials"] .num')?.textContent), districts: Number(document.querySelector('[data-stat="districts in view"] .num')?.textContent) },
        resources: performance.getEntriesByType('resource').map(resource => ({ name: resource.name, start: resource.startTime, duration: resource.duration, bytes: resource.encodedBodySize })),
        body: document.body.innerText };
    });
    Object.assign(result, measured, { runId: browser.runId });
    if (!(measured.informationMs > 0 && measured.informationMs < 3000)) errors.push('Cold usable information did not finish below three seconds');
    if (!measured.boundaryMs || !(measured.dom.districts > 0)) errors.push('No district lines were rendered');
    if (!boundaryRequests.some(request => request.status === 200 || request.status === 206)) errors.push('No successful request reached the existing boundary archive');
    if (measured.reads.length !== 2 || measured.reads.some(read => read.status !== 200)) errors.push('Both requested information endpoints must return HTTP 200');
    const placeParsedMs = measured.reads.find(read => read.kind === 'place')?.ms;
    if (measured.resources.some(resource => new URL(resource.name).pathname === '/ballot' && (!placeParsedMs || resource.start < placeParsedMs))) errors.push('Ballot prefetched before the requested place was parsed');
    if (measured.resources.some(resource => { const path = new URL(resource.name).pathname; return path.startsWith('/geo/') && path !== '/geo/state-outlines.geojson'; })) errors.push('A boundary GeoJSON outside the existing state outlines was requested');
    if (bridgeFailures.length) errors.push('A public production GET bridge failed');
  } catch (error) { errors.push(safeError(error)); }
  finally {
    if (page) await page.screenshot({ path: `${output}/${probe.state}-${probe.zip}.png`, fullPage: true }).catch(error => errors.push(`Screenshot failed: ${safeError(error)}`));
    if (browser) {
      result.writesBlocked = browser.writesBlocked.count + blocked.length;
      result.blockedPaths = [...new Set([...browser.writesBlocked.paths, ...blocked])];
      result.providerRequests = { spent: browser.provider.spent, blocked: browser.provider.blocked };
      await browser.close().catch(error => errors.push(safeError(error)));
    }
    await stopServer(server);
    if (server) await writeFile(`${output}/${probe.state}-server.log`, server.log());
    results.push(result);
    await writeFile(`${output}/${probe.state}.json`, JSON.stringify(result, null, 2));
    await save();
    console.log(`${probe.state} ${probe.zip}: information ${result.informationMs?.toFixed(0) ?? 'missing'} ms; boundaries ${result.boundaryMs?.toFixed(0) ?? 'missing'} ms; ${errors.join('; ') || 'PASS'}`);
  }
}
for (const field of ['informationMs', 'boundaryMs']) {
  const slowest = results.filter(result => Number.isFinite(result[field])).sort((a, b) => b[field] - a[field])[0];
  if (slowest) console.log(`Slowest ${field}: ${slowest.state} ${slowest.zip}, ${slowest[field].toFixed(0)} ms`);
}
if (results.length !== probes.length || results.some(result => result.errors.length)) process.exitCode = 1;
