/** Cold built reader check against production, one fresh server and guarded browser per state.
 * NODE_USE_ENV_PROXY=1 PLAYWRIGHT_BROWSERS_PATH=/tmp/rs02-playwright node \
 *   --env-file=/tmp/rs02-production.env --experimental-strip-types scripts/rs-02-browser-check.mjs
 * --states=AZ,CA limits a diagnostic run; --out=<directory> keeps separate first-run evidence.
 * Chromium reads app HTML/assets/APIs directly from localhost with Next compression,
 * and the configured external boundary archive natively. Only Netlify-only public
 * reads and the relative boundary API fallback use the GET bridge, preserving paths
 * and Range headers. With a configured session proxy, this isolated public read-only
 * context accepts its known CA, which Node independently verifies; otherwise TLS is strict.
 * Requires an existing production build. Never builds, warms reader APIs, or writes production data.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { neon } from '@neondatabase/serverless';
import { launchGuarded, seedZip } from './browser.mts';

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const output = resolve(arg('out') ?? '.scratch/rs02/browser');
const appTransport = 'Native Chromium localhost HTTP with Next compression';
const productionOrigin = 'https://meanwhileusa.com';
const proxyAddress = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
const proxyUrl = proxyAddress ? new URL(proxyAddress) : null;
const sessionProxy = proxyUrl ? { server: `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`,
  bypass: 'localhost,127.0.0.1', ...(proxyUrl.username ? { username: decodeURIComponent(proxyUrl.username), password: decodeURIComponent(proxyUrl.password) } : {}) } : undefined;
const boundaryTransport = sessionProxy ? 'Native Chromium primary archive through managed session proxy' : 'Native Chromium primary archive with strict TLS';
const boundaryFallback = 'Only the relative localhost /api/boundaries path is bridged to the identical production path and Range; the configured external primary archive is native.';
const proxyCaException = sessionProxy ? 'Isolated public read-only browser context; Node probes verify the configured proxy CA' : null;
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
if (arg('follow-up') === '1') probes.push({ ...allProbes.find(probe => probe.state === 'AZ'), followUp: true });
await mkdir(output, { recursive: true });
const results = [];
const safeError = error => String(error).split(connection).join('[production readonly connection]');
const isBoundaryArchive = url => url.pathname.startsWith('/api/boundaries/') ||
  (url.origin === 'https://tiles.meanwhilemaps.com' && url.pathname === '/us-2025.pmtiles');
const save = () => writeFile(`${output}/summary.json`, JSON.stringify({ checkedAt: new Date().toISOString(), buildId,
  productionReadonly: true, freshServerAndBrowserPerState: true, basemapProviderAccess: false,
  appTransport, boundaryTransport, boundaryFallback, proxyCaException, results }, null, 2));

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

async function closeReaderCards(page) {
  for (let depth = 0; depth < 8; depth++) {
    const close = page.locator('[data-reader-card]:visible [data-mw="card-close"]');
    if (!(await close.count())) return;
    await close.click();
  }
  throw Error('Reader cards did not close through their visible Close controls');
}

async function followReader(page, output, evidence) {
  const { offices, navigation } = evidence;
  const people = arg('actions') === 'navigation' ? [] : [{ name: 'Adelita', offices: 1 }, { name: 'Mark Kelly', offices: 2 }, { name: 'Ruben Gallego', offices: 2 }, { name: 'Adelita', offices: 1 }];
  if (people.length) await page.locator('[data-stat="officials"]').click();
  for (const person of people) {
    const button = page.locator('[data-reader-card="door:officials"]').getByRole('button', { name: new RegExp(person.name) }).first();
    await button.evaluate(element => {
      window.rs02Contact = { click: 0 };
      element.addEventListener('click', () => { window.rs02Contact.click = performance.now(); }, { once: true });
    });
    await button.click();
    await page.locator('[data-person-identity]:visible').filter({ hasText: person.name }).waitFor();
    await page.getByRole('button', { name: /^Offices near you/ }).click();
    await page.waitForFunction(expected => [...document.querySelectorAll('[data-directory-office]')].filter(element => element.getClientRects().length).length === expected, person.offices);
    const contact = await page.evaluate(async () => {
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      return { ms: performance.now() - window.rs02Contact.click,
        offices: [...document.querySelectorAll('[data-directory-office]')].filter(element => element.getClientRects().length).map(element => ({
          text: element.textContent, phone: element.querySelector('a[href^="tel:"]')?.textContent,
          address: element.querySelector('a[title^="Directions to"]')?.textContent,
        })) };
    });
    offices.push({ name: person.name, ...contact });
    if (!(contact.ms < 3000)) throw Error(`${person.name}'s office card did not finish below three seconds`);
    if (contact.offices.some(office => !office.address || !office.phone)) throw Error(`${person.name}'s office address or phone is absent`);
    await page.screenshot({ path: `${output}/AZ-contact-${offices.length}.png`, fullPage: true });
    await page.getByRole('button', { name: /Back to Officials/ }).click();
  }
  await closeReaderCards(page);
  for (const zip of ['85701', '85003', '85701']) {
    await closeReaderCards(page);
    await page.locator('.mw-nav-zip:visible').click();
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: /^zip code$/i }) });
    await dialog.getByRole('textbox', { name: /^zip code$/i }).fill(zip);
    const go = dialog.getByRole('button', { name: 'Go', exact: true });
    await go.evaluate((element, zip) => {
      window.rs02.action = { zip, clicked: 0 };
      element.addEventListener('click', () => { window.rs02.action.clicked = performance.now(); }, { once: true });
    }, zip);
    await go.click();
    let action;
    try {
      await page.waitForFunction(() => window.rs02.action.paintMs, null, { timeout: 20000 });
    } finally {
      // Retain the failed action's transport evidence before propagating either
      // its timeout or the unchanged three-second acceptance check below.
      action = await page.evaluate(() => {
        const current = window.rs02.action;
        const relative = ms => ms - current.clicked;
        const kinds = { '/api/reader/state': 'state', '/api/meetings': 'place', '/api/location/zip': 'location' };
        const responseParses = window.rs02.responseReads.filter(read => read.zip === current.zip && read.parsedMs >= current.clicked)
          .map(read => ({ ...read, parsedAfterClickMs: relative(read.parsedMs) }));
        const requests = performance.getEntriesByType('resource').filter(entry => {
          const url = new URL(entry.name);
          return kinds[url.pathname] && url.searchParams.get('zip') === current.zip && entry.startTime >= current.clicked;
        }).map(entry => {
          const url = new URL(entry.name);
          return { url: entry.name, kind: kinds[url.pathname], zip: current.zip,
            startMs: entry.startTime, startAfterClickMs: relative(entry.startTime),
            requestStartMs: entry.requestStart, responseStartMs: entry.responseStart, responseEndMs: entry.responseEnd,
            durationMs: entry.duration, transferBytes: entry.transferSize, encodedBytes: entry.encodedBodySize, decodedBytes: entry.decodedBodySize,
            serverTiming: responseParses.find(read => read.url === entry.name)?.serverTiming ?? null,
            serverTimingEntries: (entry.serverTiming ?? []).map(timing => ({ name: timing.name, duration: timing.duration, description: timing.description })),
          };
        });
        return { ...current, requests, responseParses };
      });
      navigation.push(action);
    }
    if (!(action.paintMs < 3000)) throw Error(`Changing ZIP to ${zip} did not finish below three seconds`);
  }
  return { offices, navigation };
}

async function followContent(page, output, evidence) {
  const selected = arg('content') === 'remaining'
    ? ['legistar-insite:pima:1381579', 'diligent:tusd1:2026-10-22T1730-bond-oversight']
    : ['onbase:tucson:1961', 'legistar-insite:pima:1381579', 'diligent:tusd1:2026-10-22T1730-bond-oversight'];
  const ids = arg('meeting') ? selected.filter(id => id === arg('meeting')) : selected;
  if (!ids.length) throw Error('The requested held meeting is not one of the original browser probes');
  evidence.failures = [];
  const clicked = async button => {
    await button.evaluate(element => element.addEventListener('click', () => { window.rs02.contentClick = performance.now(); }, { once: true }));
    await button.click();
  };
  const paint = () => page.evaluate(async () => {
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    return performance.now() - window.rs02.contentClick;
  });
  for (const id of ids) {
    await closeReaderCards(page);
    await page.locator('[data-stat="meetings"]').click();
    await page.getByRole('combobox', { name: 'Group by' }).selectOption('none');
    const row = page.locator(`.al-overlay:visible [data-meeting-id="${id}"]`);
    await row.waitFor();
    const meeting = await page.evaluate(id => window.rs02.payloads.place.meetings.find(meeting => meeting.id === id), id);
    if (!meeting) throw Error(`Selected held meeting ${id} disappeared from the place response`);
    await clicked(row.locator('h3 button'));
    await page.locator(`[data-meeting-card="${id}"]:visible`).waitFor();
    await page.waitForFunction(id => window.rs02.agendaReads?.some(read => read.meetingId === id), id);
    const agenda = await page.evaluate(id => window.rs02.agendaReads.find(read => read.meetingId === id), id);
    if (agenda.status !== 200) throw Error(`The opened meeting agenda returned HTTP ${agenda.status}`);
    const preservation = [];
    const normalizedComparisonFields = [];
    if (arg('agenda-before')) {
      const before = JSON.parse(await readFile(resolve(arg('agenda-before'), `${encodeURIComponent(id)}.json`), 'utf8'));
      for (const key of ['documents', 'documentCount', 'documentAccounting', 'holdingStatus', 'supportingHoldingStatus', 'unavailableAuthorities', 'records', 'publication', 'listingIdentity']) {
        let oldValue = before[key], newValue = agenda.payload[key];
        if (key === 'publication' && oldValue && newValue) {
          for (const [label, value] of [['before', oldValue.recheckDueAt], ['after', newValue.recheckDueAt]]) {
            if (value != null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) evidence.failures.push(`Held agenda ${id} has an invalid ${label} publication.recheckDueAt`);
          }
          // This deadline is computed from the current request time. Preserve
          // its presence and validity; compare every other publication field.
          if (typeof oldValue.recheckDueAt === 'string' && typeof newValue.recheckDueAt === 'string') {
            oldValue = { ...oldValue, recheckDueAt: '[valid dynamic recheck timestamp]' };
            newValue = { ...newValue, recheckDueAt: '[valid dynamic recheck timestamp]' };
            normalizedComparisonFields.push('publication.recheckDueAt');
          }
        }
        if (!isDeepStrictEqual(oldValue, newValue)) evidence.failures.push(`Held agenda ${id} changed ${key}`);
        else preservation.push(key);
      }
    }
    if (agenda.payload.records?.status === 'HELD') await page.locator(`[data-meeting-records="${id}"]`).waitFor();
    const snippet = agenda.payload.documents?.[0]?.text?.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (snippet && agenda.payload.publication?.acquisition !== 'ACQUIRED_IS_PUBLICATION_INDEX') {
      await page.waitForFunction(({ id, snippet }) => document.querySelector(`[data-meeting-card="${id}"]`)?.textContent.replace(/\s+/g, ' ').includes(snippet), { id, snippet });
    }
    const ms = await paint();
    const rendered = await page.locator(`[data-meeting-card="${id}"]`).innerText();
    const network = await page.evaluate(id => performance.getEntriesByType('resource').filter(entry => entry.name.includes('/api/agenda?') && new URL(entry.name).searchParams.get('meetingId') === id).map(entry => ({
      name: entry.name, startMs: entry.startTime, requestStartMs: entry.requestStart, responseStartMs: entry.responseStart,
      responseEndMs: entry.responseEnd, durationMs: entry.duration, transferBytes: entry.transferSize, decodedBytes: entry.decodedBodySize,
    })), id);
    evidence.meetings.push({ id, title: meeting.title, bodyId: meeting.bodyId, ms, rendered, agenda, network, preservedFields: preservation, normalizedComparisonFields });
    await page.screenshot({ path: `${output}/AZ-meeting-${evidence.meetings.length}.png`, fullPage: true });
    if (!(ms < 3000)) evidence.failures.push(`Held meeting and agenda ${id} did not finish below three seconds`);
    if (id === ids[0] && arg('body') !== '0') {
      const heldBy = page.getByRole('button').filter({ has: page.locator('.mw-row-link-label').filter({ hasText: /^Held by$/ }) });
      await clicked(heldBy);
      await page.locator('.mw-entity:visible .account-modal-title').filter({ hasText: meeting.bodyName }).waitFor();
      const bodyMs = await paint();
      evidence.bodies.push({ bodyId: meeting.bodyId, ms: bodyMs, rendered: await page.locator('.mw-entity:visible').innerText() });
      await page.screenshot({ path: `${output}/AZ-body.png`, fullPage: true });
      if (!(bodyMs < 3000)) evidence.failures.push('The held body card did not finish below three seconds');
    }
    await closeReaderCards(page);
  }
  if (!evidence.meetings.some(meeting => meeting.agenda.payload.documents?.length > 0)) evidence.failures.push('No held agenda document was exercised by the meeting clicks');
  if (evidence.failures.length) throw Error(evidence.failures.join('; '));
}

async function followVenue(page, output, evidence) {
  await closeReaderCards(page);
  const selected = await page.evaluate(() => {
    const meetings = window.rs02.payloads.place.meetings;
    const pins = [...document.querySelectorAll('.wtp-pin[data-venue-kind="PHYSICAL"]')]
      .filter(pin => pin.dataset.hidden !== 'true' && pin.getClientRects().length)
      .map(pin => ({ pin, rect: pin.getBoundingClientRect(), ids: JSON.parse(pin.dataset.meetingIds) }));
    const candidates = pins.flatMap(({ pin, rect, ids }) => {
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      if (ids.length < 2 || x <= 0 || y <= 0 || x >= innerWidth || y >= innerHeight || document.elementFromPoint(x, y)?.closest('.wtp-pin') !== pin) return [];
      if (pins.some(other => other.pin !== pin && Math.hypot(x - other.rect.x - other.rect.width / 2, y - other.rect.y - other.rect.height / 2) < 60)) return [];
      const first = meetings.find(meeting => meeting.id === ids[0]);
      if (!first?.location) return [];
      const physical = meetings.filter(meeting => meeting.location
        && meeting.location.lat.toFixed(4) === first.location.lat.toFixed(4)
        && meeting.location.lng.toFixed(4) === first.location.lng.toFixed(4));
      if (JSON.stringify(physical.map(meeting => meeting.id).sort()) !== JSON.stringify([...ids].sort())) return [];
      const bodies = new Set(physical.flatMap(meeting => meeting.bodyId ?? []));
      const placeless = meetings.filter(meeting => meeting.location === null && bodies.has(meeting.bodyId) && !ids.includes(meeting.id));
      return [{ pin, ids, physical, placeless }];
    }).sort((a, b) => a.placeless.length - b.placeless.length || b.ids.length - a.ids.length);
    const choice = candidates[0];
    if (!choice) return null;
    choice.pin.dataset.rs02VenueTarget = 'true';
    return { pinLabel: choice.pin.getAttribute('aria-label'), physicalIds: choice.ids, placelessIds: choice.placeless.map(meeting => meeting.id),
      expectedMeetings: [...choice.physical, ...choice.placeless].map(meeting => ({ id: meeting.id, bodyId: meeting.bodyId, bodyName: meeting.bodyName,
        title: meeting.title, startsAt: meeting.startsAt, timeZone: meeting.timeZone, startPrecision: meeting.startPrecision,
        location: meeting.location, agendaUrl: meeting.agendaUrl ?? meeting.provenance.sourceUrl })) };
  });
  if (!selected) throw Error('No isolated visible held physical venue with multiple meetings was available for the docket check');
  Object.assign(evidence, selected);
  const pin = page.locator('.wtp-pin[data-rs02-venue-target="true"]');
  await pin.evaluate(element => element.addEventListener('click', () => { window.rs02.venueClick = performance.now(); }, { capture: true, once: true }));
  await pin.click();
  await page.locator('.mw-venue:visible').waitFor();
  await page.waitForFunction(expected => {
    const panel = document.querySelector('.mw-venue');
    if (!panel?.getClientRects().length || Number(panel.querySelector('[data-venue-panel-count]')?.getAttribute('data-venue-panel-count')) !== expected.length) return false;
    const ids = [...panel.querySelectorAll('[data-meeting-row]')].map(row => row.getAttribute('data-meeting-id')).sort();
    return JSON.stringify(ids) === JSON.stringify([...expected].sort());
  }, selected.expectedMeetings.map(meeting => meeting.id));
  Object.assign(evidence, await page.evaluate(async expected => {
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    const ms = performance.now() - window.rs02.venueClick, panel = document.querySelector('.mw-venue');
    const normalized = value => String(value ?? '').replace(/\s+/g, ' ').trim();
    const rows = [...panel.querySelectorAll('[data-meeting-row]')];
    const failures = [], checked = [];
    for (const meeting of expected) {
      const row = rows.find(element => element.getAttribute('data-meeting-id') === meeting.id), text = normalized(row.textContent);
      const date = new Date(meeting.startsAt), zone = { timeZone: meeting.timeZone };
      const month = new Intl.DateTimeFormat('en-US', { ...zone, month: 'long' }).format(date);
      const day = new Intl.DateTimeFormat('en-US', { ...zone, day: 'numeric' }).format(date);
      const year = new Intl.DateTimeFormat('en-US', { ...zone, year: 'numeric' }).format(date);
      const time = meeting.startPrecision === 'DAY' ? 'Time not posted' : normalized(new Intl.DateTimeFormat('en-US', { ...zone, hour: 'numeric', minute: '2-digit' }).format(date));
      const agenda = [...row.querySelectorAll('a')].some(link => link.getAttribute('href') === meeting.agendaUrl);
      if (!normalized(row.querySelector('h3')?.textContent)) failures.push(`${meeting.id}: missing title`);
      if (meeting.bodyName && !normalized(panel.textContent).includes(normalized(meeting.bodyName))) failures.push(`${meeting.id}: missing body name`);
      if (!text.includes(`${month} ${day}`) || !text.includes(year) || !text.includes(time)) failures.push(`${meeting.id}: held date or time missing`);
      for (const value of [meeting.location?.name, meeting.location?.address].filter(Boolean)) {
        if (!text.includes(normalized(value))) failures.push(`${meeting.id}: held venue field missing`);
      }
      if (meeting.agendaUrl && !agenda) failures.push(`${meeting.id}: held agenda or publisher link missing`);
      checked.push({ id: meeting.id, title: normalized(row.querySelector('h3')?.textContent), date: `${month} ${day}, ${year}`, time, agendaLink: meeting.agendaUrl, text });
    }
    return { ms, renderedCount: rows.length, checked, failures, resources: performance.getEntriesByType('resource')
      .filter(entry => entry.startTime >= window.rs02.venueClick).map(entry => ({ name: entry.name, startAfterClickMs: entry.startTime - window.rs02.venueClick,
        durationMs: entry.duration, encodedBytes: entry.encodedBodySize, decodedBytes: entry.decodedBodySize })),
      agendaReadsAfterClick: (window.rs02.agendaReads ?? []).filter(read => read.parsedMs >= window.rs02.venueClick).length };
  }, selected.expectedMeetings));
  await page.screenshot({ path: `${output}/AZ-venue-panel.png`, fullPage: true });
  await page.locator('[data-reader-card^="venue:"]:visible [data-mw="card-close"]').click();
  await page.locator('.mw-venue:visible').waitFor({ state: 'hidden' });
  evidence.closed = true;
  if (evidence.failures.length) throw Error(evidence.failures.join('; '));
  if (evidence.agendaReadsAfterClick) throw Error('Opening a venue docket unexpectedly read an individual agenda');
  if (!(evidence.ms < 3000)) throw Error('The full held venue docket did not finish below three seconds');
}

for (const probe of probes) {
  const tag = `${probe.state}${probe.followUp ? '-followup' : ''}`;
  const errors = [], blocked = [], boundaryRequests = [], bridgeFailures = [], abortedReads = [];
  const result = { state: probe.state, zip: probe.zip, followUp: Boolean(probe.followUp), appTransport, boundaryTransport, boundaryFallback, proxyCaException, errors, boundaryRequests, bridgeFailures, abortedReads };
  let server, browser, page;
  try {
    const port = Number(arg('port') ?? 3260);
    const appOrigin = `http://localhost:${port}`;
    server = await startServer(port);
    browser = await launchGuarded({ label: `rs-02-cold-${probe.state}`, headless: true, blockWrites: true,
      ...(sessionProxy ? { proxy: sessionProxy } : {}),
      args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
    page = await browser.page({ viewport: { width: 1440, height: 1000 }, ...(sessionProxy ? { ignoreHTTPSErrors: true } : {}) });
    const context = page.context();
    // A context-wide marker makes Chrome preflight cross-origin tiles before
    // confinement can strip it. Add it only to our local origin at the route;
    // the shared write/provider/confinement guards remain installed.
    await context.setExtraHTTPHeaders({});
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    const requests = new Map();
    let navigationStarted;
    cdp.on('Network.requestWillBeSent', event => {
      if (event.type === 'Document' && new URL(event.request.url).origin === appOrigin) navigationStarted ??= event.timestamp;
      if (isBoundaryArchive(new URL(event.request.url))) requests.set(event.requestId, {
        url: event.request.url, range: event.request.headers.Range ?? event.request.headers.range ?? null, started: event.timestamp,
        startMs: navigationStarted === undefined ? null : (event.timestamp - navigationStarted) * 1000,
      });
    });
    cdp.on('Network.responseReceived', event => {
      const request = requests.get(event.requestId);
      if (request) Object.assign(request, { status: event.response.status, protocol: event.response.protocol,
        bytes: Number(event.response.headers['content-length'] ?? event.response.headers['Content-Length']),
        connectionId: event.response.connectionId, connectionReused: event.response.connectionReused, timing: event.response.timing,
        responseHeaders: Object.fromEntries(Object.entries(event.response.headers).filter(([key]) => /^(age|cache-control|cache-status|cf-cache-status|etag|server-timing|content-range)$/i.test(key))),
      });
    });
    cdp.on('Network.loadingFinished', event => {
      const request = requests.get(event.requestId);
      if (request) { const { started, ...record } = request; boundaryRequests.push({ ...record, ms: Math.round((event.timestamp - started) * 1000) }); }
    });
    page.on('pageerror', error => errors.push(safeError(error)));
    page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
    page.on('requestfailed', request => {
      const url = new URL(request.url());
      if (request.failure()?.errorText === 'net::ERR_ABORTED' && !['/api/meetings', '/api/reader/state', '/api/agenda'].includes(url.pathname)) {
        abortedReads.push({ path: url.pathname, error: request.failure().errorText });
        return;
      }
      if (['GET', 'HEAD'].includes(request.method()) && (url.origin.startsWith('http://localhost:') || url.origin === productionOrigin) && url.pathname.startsWith('/api/')) errors.push(`GET failed ${url.pathname}: ${request.failure()?.errorText ?? 'unknown'}`);
    });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (!['GET', 'HEAD'].includes(request.method())) { blocked.push(url.pathname); return route.abort('blockedbyclient'); }
      const boundary = url.origin === appOrigin && url.pathname.startsWith('/api/boundaries/');
      const publicOnly = (url.origin === appOrigin || url.origin === productionOrigin)
        && (url.pathname === '/api/reader/settings' || url.pathname === '/api/reader/link-health' || url.pathname.startsWith('/api/portraits/'));
      if (url.origin === appOrigin && !boundary && !publicOnly) return route.fallback({ headers: {
        ...request.headers(), 'x-wtp-synthetic-run': browser.runId,
      } });
      if (!boundary && !publicOnly) return route.fallback();
      const productionUrl = `${productionOrigin}${url.pathname}${url.search}`;
      const started = performance.now();
      try {
        const response = await fetch(productionUrl, { signal: AbortSignal.timeout(15000), headers: {
          'x-wtp-synthetic-run': browser.runId,
          ...(request.headers().range ? { Range: request.headers().range } : {}),
        } });
        const body = Buffer.from(await response.arrayBuffer());
        const record = { url: productionUrl, range: request.headers().range ?? null, status: response.status, bytes: body.length, ms: Math.round(performance.now() - started), transport: 'Netlify-only public GET bridge' };
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
      const evidence = window.rs02 = { reads: [], renders: [], payloads: {}, payloadsByZip: {}, responseReads: [] };
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
        const action = evidence.action;
        const held = action && evidence.payloadsByZip[action.zip];
        if (action?.clicked && !action.paintMs && !action.pending && held?.state?.coverage && held?.place?.coverage) {
          const bodies = new Set([...held.state.coverage.bodies, ...held.place.coverage.bodies].map(body => body.bodyId)).size;
          const link = document.querySelector(`.mw-nav-ballot[href*="${action.zip}"]`);
          if (link?.getClientRects().length && row.officials > 0 && row.meetings === held.place.meetings.length && row.bodies === bodies) {
            action.pending = true;
            requestAnimationFrame(() => requestAnimationFrame(() => { action.paintMs = now() - action.clicked; }));
          }
        }
      };
      new MutationObserver(observe).observe(document, { childList: true, subtree: true, characterData: true });
      const original = Response.prototype.json;
      Response.prototype.json = async function () {
        const data = await original.call(this), url = this.url;
        const parsedUrl = new URL(url, location.href);
        const kind = { '/api/reader/state': 'state', '/api/meetings': 'place', '/api/location/zip': 'location' }[parsedUrl.pathname];
        if (kind) evidence.responseReads.push({ url, kind, zip: parsedUrl.searchParams.get('zip'), status: this.status,
          parsedMs: now(), serverTiming: this.headers.get('server-timing') });
        if (url.includes('/api/agenda?')) (evidence.agendaReads ??= []).push({ meetingId: new URL(url).searchParams.get('meetingId'), status: this.status, parsedMs: now(), serverTiming: this.headers.get('server-timing'), payload: data });
        if (url.includes('/api/meetings?') || url.includes('/api/reader/state?')) {
          const kind = url.includes('/api/meetings?') ? 'place' : 'state';
          const zip = new URL(url).searchParams.get('zip');
          if (zip) (evidence.payloadsByZip[zip] ??= {})[kind] = data;
          if (!evidence.payloads[kind]) {
            evidence.payloads[kind] = data;
            evidence.reads.push({ url, kind, status: this.status, ms: now(), serverTiming: this.headers.get('server-timing') });
            observe();
          }
          observe();
        }
        return data;
      };
    });
    await page.goto(`${appOrigin}/?zip=${probe.zip}`, { waitUntil: 'commit' });
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
    Object.assign(result, measured, { runId: browser.runId, usableMs: measured.informationMs && measured.boundaryMs ? Math.max(measured.informationMs, measured.boundaryMs) : null });
    if (!(measured.informationMs > 0 && measured.informationMs < 3000)) errors.push('Cold usable information did not finish below three seconds');
    if (!measured.boundaryMs || !(measured.dom.districts > 0)) errors.push('No district lines were rendered');
    else if (!(measured.boundaryMs < 3000)) errors.push('Cold district lines did not finish below three seconds');
    if (!boundaryRequests.some(request => request.status === 200 || request.status === 206)) errors.push('No successful request reached the existing boundary archive');
    if (measured.reads.length !== 2 || measured.reads.some(read => read.status !== 200)) errors.push('Both requested information endpoints must return HTTP 200');
    for (const path of ['/api/reader/state', '/api/meetings']) {
      if (measured.resources.filter(resource => new URL(resource.name).pathname === path).length !== 1) errors.push(`${path} must be fetched exactly once on the cold visit`);
    }
    const placeParsedMs = measured.reads.find(read => read.kind === 'place')?.ms;
    if (measured.resources.some(resource => new URL(resource.name).pathname === '/ballot' && (!placeParsedMs || resource.start < placeParsedMs))) errors.push('Ballot prefetched before the requested place was parsed');
    if (measured.resources.some(resource => { const path = new URL(resource.name).pathname; return path.startsWith('/geo/') && path !== '/geo/state-outlines.geojson'; })) errors.push('A boundary GeoJSON outside the existing state outlines was requested');
    if (bridgeFailures.length) errors.push('A public production GET bridge failed');
    // A cold boundary miss remains a failure; it must not suppress independent
    // click-path evidence when both held information responses succeeded.
    const informationAvailable = measured.reads.length === 2 && measured.reads.every(read => read.status === 200) && measured.informationMs > 0;
    if ((probe.followUp || arg('actions')) && informationAvailable) {
      await page.screenshot({ path: `${output}/${tag}-cold.png`, fullPage: true });
      result.readerActions = { offices: [], navigation: [] };
      await followReader(page, output, result.readerActions);
    }
    if (arg('content') && informationAvailable) {
      result.readerContent = { meetings: [], bodies: [] };
      await followContent(page, output, result.readerContent);
    }
    if (arg('venue') === '1' && informationAvailable) {
      result.readerVenue = {};
      await followVenue(page, output, result.readerVenue);
    }
  } catch (error) { errors.push(safeError(error)); }
  finally {
    if (page) await page.screenshot({ path: `${output}/${tag}-${probe.zip}.png`, fullPage: true }).catch(error => errors.push(`Screenshot failed: ${safeError(error)}`));
    if (browser) {
      result.writesBlocked = browser.writesBlocked.count + blocked.length;
      result.blockedPaths = [...new Set([...browser.writesBlocked.paths, ...blocked])];
      result.providerRequests = { spent: browser.provider.spent, blocked: browser.provider.blocked };
      await browser.close().catch(error => errors.push(safeError(error)));
    }
    await stopServer(server);
    if (server) await writeFile(`${output}/${tag}-server.log`, server.log());
    results.push(result);
    await writeFile(`${output}/${tag}.json`, JSON.stringify(result, null, 2));
    await save();
    console.log(`${probe.state} ${probe.zip}: information ${result.informationMs?.toFixed(0) ?? 'missing'} ms; boundaries ${result.boundaryMs?.toFixed(0) ?? 'missing'} ms; ${errors.join('; ') || 'PASS'}`);
  }
}
for (const field of ['usableMs', 'informationMs', 'boundaryMs']) {
  const slowest = results.filter(result => Number.isFinite(result[field])).sort((a, b) => b[field] - a[field])[0];
  if (slowest) console.log(`Slowest ${field}: ${slowest.state} ${slowest.zip}, ${slowest[field].toFixed(0)} ms`);
}
if (results.length !== probes.length || results.some(result => result.errors.length)) process.exitCode = 1;
