/**
 * The discovery method the 2026-09-24 agenda-host refusal produced, written
 * through the one governed path (RULING 252).
 *
 * `legistar.granicus.com` answers robots.txt with `Disallow: /`, and the
 * Legistar Web API lists every Pima and Mesa agenda and minutes PDF there. The
 * tenant's own portal host publishes no restriction and serves the same
 * documents. The portal links them from each sitting's MeetingDetail page
 * (`EventInSiteURL`) with an id of its own, so the link is read off that page
 * and never built from the API's ids. Measured on two tenants and two document
 * kinds the same night.
 */
import { join } from "node:path";

import { runLearnBatch, type LearnedRoute } from "../../lib/method/learn-batch.ts";
import { today } from "../doc-dates.mjs";

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

const ROUTES: LearnedRoute[] = [
  {
    id: "legistar-portal-serves-the-refused-document-hosts-files",
    title:
      "a Legistar tenant's own portal serves the agenda and minutes PDFs its Web API lists on the robots-refused legistar.granicus.com — read the View.ashx link off the sitting's MeetingDetail page, never construct it",
    tier: "A1",
    fields: ["agenda", "minutes", "document", "permission"],
    note:
      "The Web API's EventAgendaFile / EventMinutesFile point at legistar.granicus.com (robots.txt Disallow: /). The " +
      "sitting's EventInSiteURL (https://<tenant>.legistar.com/MeetingDetail.aspx?LEGID=<EventId>&GID=..&G=..) is on the " +
      "tenant's portal host, whose robots.txt answers 404, so it is unrestricted. It links the agenda as " +
      "ctl00_ContentPlaceHolder1_hypAgenda -> View.ashx?M=A&ID=<portal id>&GUID=.. and the minutes as ..._hypMinutes -> " +
      "View.ashx?M=M&... ; M=AADA is the accessible HTML agenda. Measured 2026-09-24: Pima event 1828 (Board of " +
      "Supervisors, 2026-09-22) -> portal id 1381577 -> View.ashx?M=A answered 200 application/pdf with no redirect. " +
      "Mesa View.ashx?M=M&ID=1336046 answered 200 application/pdf (203,919 bytes) with no redirect. View.ashx built from " +
      "the API's EventId and EventGuid (ID=1828) answered 302 -> Confirmation.aspx?M1=Gone: the portal numbers sittings " +
      "in its own id space. An unposted document renders its anchor with no href. Wired for agendas in " +
      "lib/sources/legistar/portal-agenda-link.ts, used by the ingest when the API link is refused.",
    origin:
      "closing the robots violation on legistar.granicus.com (2026-09-24) without losing Pima's and Mesa's agenda text: " +
      "the reader merge keeps the API row, whose own link is refused.",
    effort: {
      repeats: "PER_VENDOR",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note: "One detail-page read per sitting (about 280 KB), then the document itself; the link is reused afterwards. No key, no model.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 2,
      outcome: "YIELDED",
      note: "Pima agenda (event 1828 -> portal 1381577) and Mesa minutes (portal 1336046) both served as PDFs by the permitted portal host.",
    },
    claims: [
      {
        id: "legistar-portal-serves-the-refused-document-hosts-files#exists",
        class: "ROUTE_EXISTENCE",
        statement: "A Legistar sitting's MeetingDetail page on the tenant's portal host links its agenda and minutes as View.ashx?M=A and View.ashx?M=M.",
        restsOn: [],
      },
      {
        id: "legistar-portal-serves-the-refused-document-hosts-files#pima-agenda",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-24 Pima's MeetingDetail page for event 1828 linked View.ashx?M=A&ID=1381577, which answered 200 application/pdf with no redirect.",
        restsOn: ["legistar-portal-serves-the-refused-document-hosts-files#exists"],
      },
      {
        id: "legistar-portal-serves-the-refused-document-hosts-files#mesa-minutes",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-24 Mesa's View.ashx?M=M&ID=1336046 answered 200 application/pdf with no redirect.",
        restsOn: ["legistar-portal-serves-the-refused-document-hosts-files#exists"],
      },
      {
        id: "legistar-portal-serves-the-refused-document-hosts-files#api-ids-do-not-address-the-portal",
        class: "ROUTE_OUTCOME",
        statement: "On 2026-09-24 View.ashx?M=A built from Pima's API EventId 1828 and its EventGuid answered 302 to Confirmation.aspx?M1=Gone.",
        restsOn: ["legistar-portal-serves-the-refused-document-hosts-files#exists"],
      },
    ],
  },
];

runLearnBatch(STORE, ROUTES, today());
