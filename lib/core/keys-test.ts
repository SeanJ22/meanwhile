import type { KeyService } from "./keys-model.ts";
import type { KeysStore } from "./keys-store.ts";

export interface KeyTestResult { readonly working: boolean; readonly says: string }
interface Probe { readonly url: string; readonly method?: string; readonly body?: string; readonly headers?: Readonly<Record<string, string>>; readonly accepts: (body: unknown) => boolean }
const record = (body: unknown): Record<string, unknown> => body && typeof body === "object" ? body as Record<string, unknown> : {};
const array = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

function probe(service: Exclude<KeyService, "postgres" | "signing" | "googleoauth" | "google-client">, key: string): Probe {
  const q = encodeURIComponent(key);
  switch (service) {
    case "anthropic": return { url: "https://api.anthropic.com/v1/models?limit=1", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, accepts: b => array(record(b).data) };
    case "congress": return { url: `https://api.congress.gov/v3/member?format=json&limit=1&api_key=${q}`, accepts: b => array(record(b).members) };
    case "census": return { url: `https://api.census.gov/data/2023/acs/acs5?get=NAME&for=state:04&key=${q}`, accepts: b => Array.isArray(b) && b.length === 2 && Array.isArray(b[1]) && b[1][0] === "Arizona" };
    case "fec": return { url: `https://api.open.fec.gov/v1/candidates/?per_page=1&api_key=${q}`, accepts: b => array(record(b).results) };
    case "openstates": return { url: "https://v3.openstates.org/jurisdictions?classification=state&per_page=1", headers: { "X-API-KEY": key }, accepts: b => array(record(b).results) };
    case "legiscan": return { url: `https://api.legiscan.com/?key=${q}&op=getSessionList&state=AZ`, accepts: b => record(b).status === "OK" && array(record(b).sessions) };
    case "govinfo": return { url: `https://api.govinfo.gov/collections?api_key=${q}`, accepts: b => array(record(b).collections) };
    case "lda": return { url: "https://lda.senate.gov/api/v1/filings/?filing_year=2025&page_size=1", headers: { Authorization: `Token ${key}` }, accepts: b => array(record(b).results) };
    case "socrata": return { url: "https://data.cityofnewyork.us/resource/erm2-nwe9.json?$limit=1", headers: { "X-App-Token": key }, accepts: array };
    case "civic": return { url: `https://www.googleapis.com/civicinfo/v2/elections?key=${q}`, accepts: b => Array.isArray(record(b).elections) };
    case "sam": return { url: `https://api.sam.gov/opportunities/v2/opportunities?api_key=${q}&postedFrom=10/01/2026&postedTo=10/02/2026&limit=1`, accepts: b => typeof record(b).totalRecords === "number" && Array.isArray(record(b).opportunitiesData) };
    case "brave": return { url: "https://api.search.brave.com/res/v1/web/search?q=usa.gov&count=1", headers: { "X-Subscription-Token": key }, accepts: b => array(record(record(b).web).results) };
    case "exa": return { url: "https://api.exa.ai/search", method: "POST", body: JSON.stringify({ query: "site:usa.gov government", numResults: 1, type: "fast" }), headers: { "x-api-key": key, "content-type": "application/json" }, accepts: b => array(record(b).results) };
    case "maptiler": return { url: `https://api.maptiler.com/maps/basic-v2/style.json?key=${q}`, accepts: b => record(b).version === 8 && array(record(b).layers) };
    case "netlify": return { url: "https://api.netlify.com/api/v1/user", headers: { Authorization: `Bearer ${key}` }, accepts: b => typeof record(b).id === "string" };
    case "github": return { url: "https://api.github.com/user", headers: { Authorization: `Bearer ${key}`, "User-Agent": "Meanwhile keys check", Accept: "application/vnd.github+json" }, accepts: b => typeof record(b).login === "string" };
    case "anthropic-admin": return { url: "https://api.anthropic.com/v1/organizations/me", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, accepts: b => typeof record(b).id === "string" };
    case "exa-admin": return { url: "https://admin-api.exa.ai/team-management/api-keys", headers: { "x-api-key": key }, accepts: b => Array.isArray(record(b).apiKeys) };
    case "neon": return { url: "https://console.neon.tech/api/v2/users/me", headers: { Authorization: `Bearer ${key}` }, accepts: b => typeof record(record(b).user).id === "string" };
    case "maptiler-service": return { url: "https://service.maptiler.com/v1/analytics/api_usage/timeline?period=current_billing_period&classifier=api_keys&group=request&format=json",
      headers: { Authorization: `Bearer ${key}` }, accepts: b => Array.isArray(record(b).datasets) };
  }
}

/** Response shape matters: Census can return an invalid-key HTML page with status 200. */
export async function testKey(service: KeyService, value: string, fetchImpl: typeof fetch = fetch,
  companion?: { readonly clientId?: string; readonly clientSecret?: string }): Promise<KeyTestResult> {
  try {
    if (service === "signing") {
      if (value.length < 24) return { working: false, says: "This sign-in key is too short." };
      const { signEnvelope, openEnvelope } = await import("../control-plane/admin-auth.ts");
      const signed = await signEnvelope({ check: "saved key" }, value);
      const result = await openEnvelope(signed, value);
      return result.ok ? { working: true, says: "The website can sign and verify its requests." }
        : { working: false, says: "The website could not verify a signed request." };
    }
    if (service === "googleoauth" || service === "google-client") {
      const clientId = service === "google-client" ? value : companion?.clientId;
      const clientSecret = service === "googleoauth" ? value : companion?.clientSecret;
      if (!clientId || !clientSecret) return { working: false, says: "Google sign-in is missing a saved application setting." };
      const response = await fetchImpl("https://oauth2.googleapis.com/token", { method: "POST", redirect: "error",
        headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(2_000),
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: "keys-box-invalid-code",
          grant_type: "authorization_code", redirect_uri: "https://admin.meanwhileusa.com/admin/auth/callback" }) });
      const body: unknown = await response.json();
      return record(body).error === "invalid_grant" ? { working: true, says: "Google accepted the sign-in application's credentials." }
        : { working: false, says: "Google did not confirm the sign-in application's credentials." };
    }
    if (service === "postgres") {
      const { neon } = await import("../db/client.ts");
      const sql = neon(value, { fetchOptions: { signal: AbortSignal.timeout(2_000) } });
      const rows = await sql.query("SELECT current_user AS role");
      return Array.isArray(rows) && rows.length === 1 && typeof rows[0].role === "string"
        ? { working: true, says: "The database accepted the connection." }
        : { working: false, says: "The database did not confirm the connection." };
    }
    const request = probe(service, value);
    const response = await fetchImpl(request.url, { method: request.method, body: request.body, headers: request.headers, redirect: "error", signal: AbortSignal.timeout(2_000) });
    if (response.status === 401 || response.status === 403) return { working: false, says: "The service refused this key or its access." };
    if (response.status === 429) return { working: false, says: "The service's usage limit has been reached." };
    if (!response.ok) return { working: false, says: "The service could not complete the key check." };
    const body: unknown = await response.json();
    return request.accepts(body) ? { working: true, says: "The service accepted the key and returned the expected information." }
      : { working: false, says: "The service did not return the expected information." };
  } catch { return { working: false, says: "The service could not be reached or did not finish the check." }; }
}

export async function testDueKeys(store: KeysStore, at: string, name?: string,
  check: typeof testKey = testKey): Promise<number> {
  const due = await store.claimTests(at, name);
  await Promise.all(due.map(async row => {
    let result: KeyTestResult;
    try {
      const companion = row.service === "googleoauth" || row.service === "google-client" ? {
        clientId: await store.read("GOOGLE_OAUTH_CLIENT_ID"), clientSecret: await store.read("GOOGLE_OAUTH_CLIENT_SECRET"),
      } : undefined;
      result = await check(row.service, store.open(row.name, row.locked), fetch, companion);
    }
    catch { result = { working: false, says: "The saved key could not be opened. Check the Keys box encryption setting." }; }
    await store.tested(row.name, row.version, result, at);
  }));
  return due.length;
}
