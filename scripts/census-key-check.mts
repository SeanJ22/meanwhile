/**
 * **IS THE CENSUS CREDENTIAL ANSWERING?**
 * (NJ Hunt 6, 2026-08-22. Serves `NS06`, and RULING 91: a key is only known to
 * work by calling it.)
 *
 * ```
 * pnpm census:key
 * ```
 *
 * ## Why this is a committed tool and not a one-off probe
 *
 * `NS06` is open and only the author can close it. He will replace the
 * credential and want to know, in one command, whether the replacement works —
 * and the answer is not readable from any file in this repo. NJ Hunt 5 found the
 * previous key invalid **only by calling it**; NJ Hunt 6 found its replacement
 * invalid the same way.
 *
 * ## The check is DID THE BODY PARSE AS DATA, never DID THE CALL SUCCEED
 *
 * The host's failure mode changed between the two sessions, and a check written
 * against either symptom would now be wrong:
 *
 * | | NJ Hunt 5 | NJ Hunt 6 |
 * | --- | --- | --- |
 * | Status | `302` to `invalid_key.html` | **`200`** |
 * | Header | `X-DataWebAPI-KeyError: 1` | **absent** |
 * | Body | an HTML error page | an HTML error page, `<title>Invalid Key</title>` |
 *
 * A status check reads today's dead credential as healthy. A header check reads
 * it as healthy too. **Only asking whether the response is the DATA that was
 * requested survives both**, which is the same rule as everywhere else in this
 * product: a 200 whose content is not about the thing asked for is not a
 * document.
 *
 * ## The control the diagnosis turns on
 *
 * Three calls, because one cannot separate a bad key from a bad request:
 *
 * 1. the endpoint WITH the key,
 * 2. the same endpoint WITHOUT it — if this says *Missing Key*, the endpoint
 *    requires one and the request shape is fine,
 * 3. an endpoint needing no key at all — if this returns real data, the host is
 *    up and reachable and the credential is the only thing being refused.
 */

import { readFileSync } from "node:fs";

const UA =
  "we-the-people/1.0 (civic data for a public-records product; contact: hello@wethepeople.vote)";

const key = (() => {
  try {
    const line = /^CENSUS_API_KEY=(.*)$/m.exec(readFileSync(".env.local", "utf8"))?.[1] ?? "";
    return line.trim().replace(/^["']|["']$/g, "");
  } catch {
    return "";
  }
})();

/** Morris County, New Jersey — a value checkable against the Census's own profile. */
const ACS = "https://api.census.gov/data/2023/acs/acs5?get=NAME,B01003_001E&for=county:027&in=state:34";
const KEYLESS_CONTROL = "https://api.census.gov/data/2023/acs/acs5/variables/B01003_001E.json";

interface Probe {
  label: string;
  url: string;
  redacted: string;
}

const probes: Probe[] = [
  { label: "the ACS endpoint WITH the key", url: `${ACS}&key=${key}`, redacted: `${ACS}&key=<KEY>` },
  { label: "the same endpoint WITHOUT a key", url: ACS, redacted: ACS },
  { label: "an endpoint needing no key (the control)", url: KEYLESS_CONTROL, redacted: KEYLESS_CONTROL },
];

console.log(
  `CENSUS_API_KEY present: ${key.length > 0} (${key.length} chars` +
    `${key.length > 0 ? `, ${/^[0-9a-f]+$/i.test(key) ? "hex" : "NOT hex — check for a stray character"}` : ""})`,
);

const results: { label: string; status: number; isData: boolean; title: string | null }[] = [];

for (const probe of probes) {
  let status = 0;
  let body = "";
  try {
    const res = await fetch(probe.url, { headers: { "User-Agent": UA }, redirect: "follow" });
    status = res.status;
    body = await res.text();
  } catch (e) {
    console.log(`\n### ${probe.label}\n  UNREACHABLE — ${(e as Error).message}`);
    results.push({ label: probe.label, status: 0, isData: false, title: null });
    continue;
  }

  // The whole point: is this DATA, or a page about why it is not?
  const isHtml = /^\s*<(?:!doctype|html)/i.test(body);
  const title = isHtml
    ? (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1]?.trim().replace(/\s+/g, " ") ?? null)
    : null;
  let isData = false;
  if (!isHtml) {
    try {
      const parsed: unknown = JSON.parse(body);
      isData = Array.isArray(parsed) ? parsed.length > 0 : typeof parsed === "object" && parsed !== null;
    } catch {
      isData = false;
    }
  }

  console.log(
    `\n### ${probe.label}\n  ${probe.redacted}\n  HTTP ${status} · ${isData ? "DATA" : "NOT DATA"}` +
      `${title === null ? "" : ` · <title>${title}</title>`}\n  ${body.slice(0, 140).replace(/\s+/g, " ")}`,
  );
  results.push({ label: probe.label, status, isData, title });
  await new Promise((r) => setTimeout(r, 400));
}

const [withKey, withoutKey, control] = results;

console.log("\n── VERDICT ─────────────────────────────────────────────────────");
if (withKey.isData) {
  console.log("  The credential ANSWERS. NS06 can close.");
  process.exit(0);
}
if (!control.isData) {
  console.log(
    "  CANNOT TELL. The keyless control did not return data either, so the host or this\n" +
      "  machine's route to it is the suspect rather than the credential. Re-walk before\n" +
      "  concluding anything about the key — a check that cannot reach its subject must\n" +
      "  never print like a failing one (RULING 24).",
  );
  process.exit(2);
}
console.log(
  "  The credential is REFUSED, and the request shape is not the cause:\n" +
    `    • with the key      HTTP ${withKey.status}${withKey.title === null ? "" : ` — "${withKey.title}"`}\n` +
    `    • without any key   HTTP ${withoutKey.status}${withoutKey.title === null ? "" : ` — "${withoutKey.title}"`}\n` +
    "    • keyless control   returned real data, so the host is up and the endpoint is right\n\n" +
    "  A Census API key must be ACTIVATED from the link the Census emails when it is issued.\n" +
    "  An unactivated key presents exactly like this. NS06 stays open.",
);
process.exit(1);
