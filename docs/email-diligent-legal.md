# Draft — Diligent, permission to read public agendas from tenant portals

**Status: DRAFT. Not sent. Nothing here has been reviewed by counsel.**
Related: tracker **D13** (the adapter), **D14** (the per-vendor finding),
**B09** (the counsel question this letter tries to make unnecessary).

Send only after the author has read it. A reply either way moots B09 for this
source, which is why it is worth sending early and in parallel with the letter
to the district.

---

**To:** Diligent — legal / privacy contact listed at `diligent.com/legal/`
**Subject:** Automated access to public meeting agendas on Diligent Community
tenant portals

---

Hello,

I'm building a non-commercial civic tool that shows residents the upcoming
public meetings of the governments that cover their address — city councils,
county boards, and school boards — and links each one to the agenda the body
itself published. It is free to readers, and it links out to the source rather
than republishing agenda documents.

Many of the school boards I want to cover publish through Diligent Community.
I'd like to check my reading of the terms with you before writing anything that
touches a tenant portal.

My understanding is that `diligent.com/legal/terms-of-use` governs
diligent.com and its associated resource, training and community sites, and
that it expressly carves out use of Diligent *products* to the terms agreed at
signup or to the customer's own agreement, which take precedence in a conflict.
If that reading is right, then a district's tenant portal — for example
`tusd1-schooldesk.community.diligentoneplatform.com/Portal/` — is governed by
the district's agreement rather than by the website terms of use. I would like
to confirm that, because it decides who I should be asking.

Three questions:

1. Is that reading of the scope correct?
2. Does Diligent object to a modest, identified, rate-limited client reading
   the meeting and agenda pages a district has already made public on its
   portal? I would identify the project and a contact address in the
   `User-Agent`, serialize requests with a delay, honour `Retry-After`, back
   off on any 429 or 5xx, and never re-fetch a document whose content hash is
   unchanged.
3. Is there a supported interface I should use instead? If Diligent offers a
   read API, a feed, or a bulk export for public meeting data, I would much
   rather use it than read pages, and I would be glad to work against a
   documented endpoint.

To be explicit about intent: I am asking about records that districts are
already required to publish in advance of a meeting, and that are already
public on the portal. I am not asking for anything behind authentication, and
I am not looking to redistribute Diligent's software or its documents. The
attribution on every record names the **district** as the publisher, not
Diligent.

If the right answer is that this is the district's call rather than yours, I am
happy to hear that and take it up with them — I am writing to both.

Thank you for your time.

[name]
[project] — [url]
[contact address]
