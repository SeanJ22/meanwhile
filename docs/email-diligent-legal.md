# Draft — Diligent, one named robots.txt group for Community public sites

**Status: DRAFT. Not sent. Nothing here has been reviewed by counsel.**
Related: tracker **D13** (the adapter), **D14** (the per-vendor finding),
**B09** (the counsel question this letter tries to make unnecessary).
Rewritten 2026-09-23 (the Pima school-agenda routes session) around what the
tenants' robots.txt actually says; the ledger is
`docs/detective/pima-school-agenda-routes-2026-09-23.md`.

## What was verified before this was drafted

- **The file.** Every Diligent Community tenant read on 2026-09-23T20:02Z —
  `pima.community.highbond.com`, `susd-12.community.highbond.com`,
  `tusd1-schooldesk.community.diligentoneplatform.com` — serves one
  byte-identical robots.txt (23,479 bytes, sha256 `b5cbf0b4b2cbcf18…`, recorded
  as `tests/fixtures/pima-edu/robots-pima.community.highbond.com.txt`). It is an
  allowlist: `User-agent: *` → `Disallow: /`, and six named crawlers (msnbot,
  slurp, googlebot, bingbot, duckduckbot, AddSearchBot) may read `/Portal/`,
  `/document/` and `/Services/` under `Crawl-delay: 120`, with ten narrow
  disallows (`/FileStorage/`, `/WorkSpace/`, `/js/`, `/scripts/`, `/css/`,
  `/images/`, `/fonts/`, `/Content/`, `/WebResource.axd`, `/ScriptResource.axd`).
- **The address.** Diligent's Website Terms of Use
  (`www.diligent.com/legal/terms-of-use`, updated 2022-01-06, read 2026-09-23)
  name the contact for questions about them: Legal Department,
  `legal@diligent.com`, 61 W 23rd Street 4th Floor, New York, NY 10010. The
  same terms bar robots on "the Diligent Websites"; whether a tenant's public
  site is one is B09's question, and a grant answers both.
- **No API to ask for instead.** Diligent's Community public-site guide
  (`connect.diligent.com/file-asset/Diligent_Community_Public_Site_Resource`)
  documents searchable records, email subscriptions that send a link to each
  published document, request-to-speak and YouTube links, and no API, feed or
  export. `developer.diligent.com` could not be read (its robots.txt answers
  with an HTML page, so it is CANNOT_TELL); a third-party profile lists only
  customer-gated GRC APIs. This letter therefore asks for crawl permission, not
  for an interface nobody has shown exists.
- **The token the change must name.** This project's robots evaluator
  (`lib/control-plane/scheduler/robots.ts`) reads the group for the product
  token `we-the-people` before it falls back to `*`, so a group with that name
  flips every Diligent tenant to ALLOWED for this client on the next read.

---

**To:** legal@diligent.com
**Subject:** Diligent Community robots.txt: adding one named crawler

---

Your Community public sites serve the same robots.txt on every tenant. It lets six search crawlers read /Portal/, /document/ and /Services/ with a two-minute crawl delay and turns every other agent away.

I run Meanwhile, a free civic app that shows residents the public meetings of the bodies that govern them and links each meeting to the agenda the body published. Three Arizona boards we cover publish through you: Pima Community College, Sunnyside Unified and Tucson Unified. Arizona law requires those agendas to be public 24 hours before the meeting. Our crawler honors your file, so it can't read them.

Add a group for our token, `we-the-people`, with the same rules as your Googlebot group: the same ten Disallow lines and Crawl-delay: 120. If you'd rather grant it in writing, a reply here works and I'll keep it on file.

Our client identifies itself in the User-Agent as "we-the-people civic meeting index" with a contact link. It reads robots.txt before every run, waits out the crawl delay, backs off on any 429 or 5xx, reads only what a tenant published to its public site, and never logs in. Every record credits the district that published it.

If this belongs with someone other than Legal, send me the name and I'll take it to them. Once the group is live we re-read your robots.txt the same day and start from there.

Sean Johnson
Meanwhile

---

**Voice check (sean-voice audit, 2026-09-23):** banned strings 0, em dashes in
the body 0, the close is the next action rather than a permission ask, and the
opening is about their file.
