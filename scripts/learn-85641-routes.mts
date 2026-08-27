/**
 * The routes ZIP 85641 taught, recorded into cumulative project knowledge.
 *
 * RULING 178: a new route is PROJECT knowledge, persisted, classified by
 * portability ONLY from evidence, and inherited by every later jurisdiction.
 * Each entry below carries the literal outcome it was measured with, and every
 * portability class starts at what the evidence actually supports — one county
 * in one state is not a nationwide proof, and typing it as one is the failure
 * `applyEarnedPortability` exists to prevent.
 *
 * Run once. `learnRoute` refuses a duplicate id rather than deepening it.
 */

import { readFileSync, writeFileSync } from "node:fs";

import {
  learnRoute,
  recordRouteOutcome,
  type MethodKnowledge,
  type MethodRoute,
} from "../lib/method/knowledge.ts";
import { unknownApplicability } from "../lib/method/portability.ts";
import { floored } from "../lib/ops/denominator-floor.ts";

const STORE = "data/method/knowledge.json";
const TODAY = process.env.WTP_TODAY ?? "2026-08-27";

type NewRoute = Omit<MethodRoute, "learnedAtVersion">;

const ROUTES: Array<{ route: NewRoute; outcome: Parameters<typeof recordRouteOutcome>[2] }> = [
  {
    route: {
      id: "zip-polygon-intersect-district-layers",
      title:
        "hand a boundary layer the ZIP's own polygon and ask what INTERSECTS it — point sampling has holes a small district fits inside",
      tier: "A0",
      fields: ["body", "jurisdiction", "boundary"],
      applicability: {
        ...unknownApplicability(),
        note:
          "the instrument is ArcGIS spatialRel=esriSpatialRelIntersects with the ZCTA polygon POSTed as the geometry. " +
          "Measured at 85641: a 96-point sampling grid found 39 governing units; the polygon intersect found 55 features " +
          "across 18 layers, including SIX governing units sampling missed entirely — Mescal-J6 Fire District, " +
          "Sahuarita Unified, Tanque Verde Unified, a second Board of Supervisors district, a second community-college " +
          "taxation district and Tucson Ward 5. The route travels to any jurisdiction whose districts are published as " +
          "queryable feature layers; whether THIS county publishes them does not.",
      },
      outcomes: [],
      subBranches: [],
      origin: "AZ 85641 hyperfocus, 2026-08-27",
      learnedOn: TODAY,
    },
    outcome: {
      jurisdiction: "az-pima-85641",
      walkedOn: TODAY,
      rows: 55,
      outcome: "YIELDED",
      note:
        "20 layers walked, 0 failed. 55 intersecting features across 18 layers. The same run measured how leaky " +
        "sampling was: 6 governing units present in the intersect were absent from a 96-point grid.",
    },
  },
  {
    route: {
      id: "special-district-territory-from-county-tax-layer",
      title:
        "a special district's territory is published by the county that LEVIES it, as a taxation boundary layer — not by the Census, whose national boundary files carry no special districts at all",
      tier: "A0",
      fields: ["body", "jurisdiction", "boundary"],
      applicability: {
        ...unknownApplicability(),
        note:
          "docs/gap-ledger.md recorded 24 Pima County special districts as territory-UNRESOLVED because the national " +
          "boundary join of 2026-08-24 'resolved 47,834 of the country's 90,837 governments and not one special " +
          "district — the boundaries are not published anywhere in that data at all'. That was true of THAT DATASET " +
          "and false of the world: Pima County publishes 'Districts - Fire Taxation' and 'Districts - Pima Community " +
          "College Taxation' as open ArcGIS layers. The route is: ask the LEVYING authority, not the statistical one. " +
          "Every state that funds special districts through county property tax has a levying authority with the same " +
          "obligation; the publication format is what varies.",
      },
      outcomes: [],
      subBranches: [],
      origin: "AZ 85641 hyperfocus, 2026-08-27",
      learnedOn: TODAY,
    },
    outcome: {
      jurisdiction: "az-pima-85641",
      walkedOn: TODAY,
      rows: 4,
      outcome: "YIELDED",
      note:
        "four fire taxation districts intersect 85641 — CORONA DE TUCSON, MESCAL-J6, RINCON VALLEY, SONOITA ELGIN. " +
        "MESCAL-J6 and SONOITA ELGIN appear in NEITHER the Census list of 24 Pima special districts NOR the state " +
        "wildfire-dispatch layer, so the levying authority's own layer is the only source that named them.",
    },
  },
  {
    route: {
      id: "arcgis-root-path-guess-is-not-an-absence",
      title:
        "a 404 at a guessed ArcGIS root means the guess was wrong, never that the government publishes no services — take the root from a portal item's own url field",
      tier: "A0",
      fields: ["source"],
      applicability: {
        ...unknownApplicability(),
        note:
          "`gisdata.pima.gov/arcgis/rest/services` answers 404 and the real root is `/arcgis1/`. Four other guessed " +
          "hostnames also 404'd or failed to connect. The reliable route is to search the ArcGIS Online sharing API " +
          "for the publisher's items and read the `url` field off one — it names the server, the folder and the layer " +
          "index. Any ArcGIS-published government has this shape.",
      },
      outcomes: [],
      subBranches: [],
      origin: "AZ 85641 hyperfocus, 2026-08-27",
      learnedOn: TODAY,
    },
    outcome: {
      jurisdiction: "az-pima-85641",
      walkedOn: TODAY,
      rows: 281,
      outcome: "YIELDED",
      note:
        "eight guessed roots: five 404, two connection-failed, one exposed only a Utilities folder. The portal item " +
        "url gave the real root in one call, and walking it enumerated 34 services and 281 layers, 66 of them " +
        "governance-shaped.",
    },
  },
  {
    route: {
      id: "vendor-api-leaked-by-hydration-payload",
      title:
        "a client-hydrated CMS ships its own vendor API endpoints in the page's hydration payload — read the payload, then call the API the page calls",
      tier: "A1",
      fields: ["roster", "official", "meeting", "document"],
      applicability: {
        ...unknownApplicability(),
        platforms: ["apptegy"],
        note:
          "vailschooldistrict.org serves 1.44 MB of HTML with NO roster in it — which is exactly why an earlier " +
          "extraction verification found five of six stored names absent from the page they were cited to. " +
          "`window.clientWorkStateTemp` carries the Thrillshare org id and every CMS endpoint. The route is the " +
          "general one: a hydrated page must tell the browser where its data lives, so the payload always names it.",
      },
      outcomes: [],
      subBranches: [],
      origin: "AZ 85641 hyperfocus, 2026-08-27",
      learnedOn: TODAY,
    },
    outcome: {
      jurisdiction: "az-pima-85641",
      walkedOn: TODAY,
      rows: 20,
      outcome: "YIELDED",
      note:
        "org 8164 and five CMS endpoints recovered from the payload. The staff directory answered 20 rows. It did " +
        "NOT contain the governing board, so the payload route yielded the vendor API without yielding this " +
        "particular roster — recorded as it happened rather than reframed.",
    },
  },
  {
    route: {
      id: "older-vendor-api-version-returns-redacted-fields",
      title:
        "when a vendor exposes two API versions, walk BOTH — the older one returned the email addresses the newer one replaced with the literal string \"hidden\"",
      tier: "A1",
      fields: ["contact", "email"],
      applicability: {
        ...unknownApplicability(),
        platforms: ["apptegy"],
        note:
          "Thrillshare /api/v4/o/<org>/cms/directories returns `\"email\":\"hidden\"`; /api/v2/s/<section>/directories " +
          "returns the real address for the same person and the same id. Neither endpoint is authenticated and " +
          "neither is disallowed. The general shape — a newer API redacting a field its predecessor still serves — " +
          "is not specific to this vendor, but the evidence so far is.",
      },
      outcomes: [],
      subBranches: [],
      origin: "AZ 85641 hyperfocus, 2026-08-27",
      learnedOn: TODAY,
    },
    outcome: {
      jurisdiction: "az-pima-85641",
      walkedOn: TODAY,
      rows: 20,
      outcome: "YIELDED",
      note:
        "same 20 people from both endpoints; v4 redacted every email to \"hidden\", v2 returned all 20.",
    },
  },
  {
    route: {
      id: "ballot-measure-from-the-body-statutory-notice-pdf",
      title:
        "the governing body's own statutory Notice of Election PDF carries the ballot question verbatim, the statute, the dollar amount, the tax rate and the election authority — a promotional page carries none of it",
      tier: "A0",
      fields: ["measure", "election", "ballot", "plain-language"],
      applicability: {
        ...unknownApplicability(),
        note:
          "Arizona requires the notice; the shape — a statutory pre-election notice naming the exact question — is " +
          "general to jurisdictions with published election notices, and the statute citation is what makes the " +
          "document findable. Also yields the SPANISH text of the same question from the same authority, which is a " +
          "sourced translation rather than a generated one.",
      },
      outcomes: [],
      subBranches: [],
      origin: "AZ 85641 hyperfocus, 2026-08-27",
      learnedOn: TODAY,
    },
    outcome: {
      jurisdiction: "az-pima-85641",
      walkedOn: TODAY,
      rows: 1,
      outcome: "YIELDED",
      note:
        "Vail USD No. 20 override continuation, 12.5% for FY2027/28 plus six years, ~$5,102,762, $1.61 per $100 of " +
        "secondary assessed valuation, A.R.S. 15-481(P), special election 2026-11-03, election authority Pima County " +
        "Elections. Two pages, English and Spanish, both extracted from the text layer.",
    },
  },
  {
    route: {
      id: "robots-named-crawler-group-is-not-the-star-group",
      title:
        "a host may disallow named AI crawlers while allowing `*` — the rule group that binds is the one matching the identity you actually declare, and it must be reported rather than quietly relied on",
      tier: "A0",
      fields: ["permission"],
      applicability: {
        ...unknownApplicability(),
        note:
          "azdor.gov carries `User-agent: ClaudeBot / Disallow: /` alongside `User-agent: * / Allow: /` and a " +
          "Cloudflare Content-Signal of `search=yes,ai-train=no,use=reference`. This project's client has always " +
          "identified as we-the-people/1.0 with a mailto, so `*` is its group and `Allow: /` is its rule. The route " +
          "is the REPORTING obligation, not a technique: a host that has thought about AI crawlers specifically has " +
          "expressed something, and a session that silently took the `*` rule would be hiding that from the author.",
      },
      outcomes: [],
      subBranches: [],
      origin: "AZ 85641 hyperfocus, 2026-08-27",
      learnedOn: TODAY,
    },
    outcome: {
      jurisdiction: "az-pima-85641",
      walkedOn: TODAY,
      rows: 1,
      outcome: "YIELDED",
      note:
        "azdor.gov names Amazonbot, Applebot-Extended, Bytespider, CCBot, ClaudeBot, Google-Extended, GPTBot and " +
        "meta-externalagent with Disallow: /, and allows `*`. Recorded as a Needs Sean row rather than decided here.",
    },
  },
  {
    route: {
      id: "tls-altname-failure-is-a-moved-host-not-a-wall",
      title:
        "a hostname that resolves but fails TLS with ERR_TLS_CERT_ALTNAME_INVALID is a RETIRED address, not a refusal — the office moved and the old name still has DNS",
      tier: "A0",
      fields: ["source"],
      applicability: {
        ...unknownApplicability(),
        note:
          "to.pima.gov (the Pima County Treasurer's historical hostname) resolves to 159.233.179.13, connects, and " +
          "presents a certificate for another name; plain HTTP answers 500. curl reports only `000`, which reads " +
          "identically to a network block, and the robots sweep therefore returned CANNOT_TELL and refused the walk. " +
          "Node's fetch names the actual cause. The rule: when a sweep says CANNOT_TELL, ask a client that reports " +
          "the TLS error before recording anything about the publisher.",
      },
      outcomes: [],
      subBranches: [],
      origin: "AZ 85641 hyperfocus, 2026-08-27",
      learnedOn: TODAY,
    },
    outcome: {
      jurisdiction: "az-pima-85641",
      walkedOn: TODAY,
      rows: 1,
      outcome: "YIELDED",
      note:
        "curl -> 000 (indistinguishable from a block); node fetch -> ERR_TLS_CERT_ALTNAME_INVALID. The host is " +
        "misconfigured or retired, and the Treasurer's current pages are on www.pima.gov. No permission claim is made.",
    },
  },
  {
    route: {
      id: "multi-tenant-vendor-apex-403-is-routing-not-permission",
      title:
        "a shared vendor host answering 403 `Invalid URL` at /robots.txt is refusing an unrouted path, not asserting a rule — take permission from the publishing government's own hub and the item's licence",
      tier: "A0",
      fields: ["permission"],
      applicability: {
        ...unknownApplicability(),
        note:
          "services6.arcgis.com serves org-scoped paths only, so a bare /robots.txt has no tenant and the router " +
          "answers 403 with the body `Invalid URL`. The robots sweep correctly returns CANNOT_TELL and fails safe. " +
          "RULING 182: permission state and transport state are orthogonal — the resolution is the PUBLISHER's " +
          "permission (azgeo.az.gov -> azgeo-data-hub-agic.hub.arcgis.com, ALLOWED) plus the item's own access and " +
          "licence fields, not a softer read of the vendor's robots.",
      },
      outcomes: [],
      subBranches: [],
      origin: "AZ 85641 hyperfocus, 2026-08-27",
      learnedOn: TODAY,
    },
    outcome: {
      jurisdiction: "az-pima-85641",
      walkedOn: TODAY,
      rows: 1,
      outcome: "YIELDED",
      note:
        "403 body is the literal string `Invalid URL` at rungs 2, 3 and 4 and under a bare Node fetch. The AZGeo " +
        "item is access:public, publisher Arizona DFFM, and the state's own hub host allows the walk.",
    },
  },
  {
    route: {
      id: "zip-crosses-districts-so-one-point-is-never-the-answer",
      title:
        "resolve a ZIP against every geography layer at MANY interior points — a ZIP is not a government and routinely holds several distinct governing combinations",
      tier: "A0",
      fields: ["jurisdiction", "district", "body"],
      applicability: {
        ...unknownApplicability(),
        note:
          "the Census geographies endpoint answers layers=all for a coordinate. Sampling the ZCTA polygon rather than " +
          "its centroid is what makes a crossing visible. Measured at 85641: 44 distinct combinations across 96 " +
          "points. The project's own prior research recorded 'Vail in LD-17' as a fact about the ZIP; 52 of 96 " +
          "points are in LD-19.",
      },
      outcomes: [],
      subBranches: [],
      origin: "AZ 85641 hyperfocus, 2026-08-27",
      learnedOn: TODAY,
    },
    outcome: {
      jurisdiction: "az-pima-85641",
      walkedOn: TODAY,
      rows: 44,
      outcome: "YIELDED",
      note:
        "96 interior points, 0 failed reads, 44 distinct combinations. Two legislative districts (17 and 19), two " +
        "jurisdictions (unincorporated Pima County and City of Tucson), and three school-district situations " +
        "including 12 points in 'School District Not Defined'.",
    },
  },
];

let k = JSON.parse(readFileSync(STORE, "utf8")) as MethodKnowledge;
const startVersion = k.version;
const startRoutes = k.routes.length;

let learned = 0;
const duplicates: string[] = [];
for (const { route, outcome } of ROUTES) {
  const res = learnRoute(k, route, TODAY);
  if (res.duplicate) {
    // RULING 63: a route that already exists is a DEFECT reported as one, never
    // quietly merged.
    duplicates.push(route.id);
    continue;
  }
  k = res.knowledge;
  learned += 1;
  const rec = recordRouteOutcome(k, route.id, outcome);
  if (!rec.recorded) throw new Error(`outcome not recorded for ${route.id}: ${rec.reason}`);
  k = rec.knowledge;
}

writeFileSync(STORE, JSON.stringify(k, null, 2) + "\n", "utf8");

// RULING 159 — learned against ATTEMPTED. A run that learned nothing from a
// non-empty ROUTES list has hit the duplicate refusal on every one, and that
// is a defect to report rather than a quiet no-op.
floored("routes learned", "the ROUTES list in this file", ROUTES.length, learned);

console.log(`method version   ${startVersion} -> ${k.version}`);
console.log(`routes           ${startRoutes} -> ${k.routes.length}`);
console.log(`learned          ${learned}`);
if (duplicates.length) {
  console.log(`DUPLICATE IDS REFUSED (${duplicates.length}): ${duplicates.join(", ")}`);
}
