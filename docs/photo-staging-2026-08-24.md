# Staged portraits, 2026-08-24 — read as images, and what each one is

**Session `nj-depth-0824`. Nothing here shipped. Nothing here is approved.**

`pnpm exec tsx scripts/hunt-campaign-photos.mts` walked every campaign site this
project holds a link for and staged **55 images for 17 of 19 candidates** —
doors 3 and 4, the candidate's own site. Two candidates' sites yielded no usable
image reference at all (Steven Endres, 1 reference and 0 usable; Robert Strobel,
0 references).

**Every image below was READ AS AN IMAGE**, on two contact sheets built by
`pnpm sheet` and opened. RULING 2: capturing is not looking, and a report that
says "staged" on the strength of a byte count has reported a step it did not
take. The sheets are `portraits-staged-2026-08-24.png` in the Drive mirror.

**31 of 55 read and judged — the 16 New Jersey and 15 New Hampshire images.**
The remaining **24 are Arizona**, staged incidentally because the script walks
every campaign link in the corpus rather than a zip. Arizona is not in tonight's
scope and they were NOT judged; saying otherwise would claim work nobody did.

## The result, stated plainly

| | count |
|---|---:|
| read as images | **31 of 31** in scope |
| refused, with a reason each | **28** |
| queueable, awaiting Sean | **3 files, 2 people** |
| shipped | **0** |

**Zero candidate photos ship without Sean.** The standing approval class his
8/24 ruling created covers government-published door-2 portraits of sitting
officials; every image here is door 3 or 4, and none of it is covered.

## New Jersey — 16 staged, 16 refused

| # | file | what it actually is | refused because |
|---|---|---|---|
| 1 | `…bennett-rebecca__1_ogimage` | banner: "REBECCA BENNETT FOR CONGRESS" over a helmeted pilot | wordmark; not a solo portrait |
| 2 | `…bennett-rebecca__2_img` | a person standing beside a helicopter, small in frame | environmental candid, subject not the unambiguous sole subject |
| 3–5 | `…bennett-rebecca__3,4,5_img` | abstract line graphics (logo elements) | not a portrait |
| 6 | `…bennett-rebecca__6_img` | "AN SBDIGITAL WEBSITE" vendor badge | not a portrait |
| 7 | `…kean-jr-thomas-h__1_ogimage` | group shot, family | group shot |
| 8 | `…kean-jr-thomas-h__2_img` | candid with two other people, subject part-turned | group / candid |
| 9 | `…kean-jr-thomas-h__3_img` | a signature | not a portrait |
| 10 | `…kean-jr-thomas-h__4_img` | group of four | group shot |
| 11 | `…hodas-david__1_img` | a lake and trees | no person in it at all |
| 12 | `…kapner-gary__1_ogimage` | campaign flyer, "GARY KAPNER" plus slogan block | wordmark |
| 13 | `…kapner-gary__2_img` | "ELECTION 2026" flag graphic | not a portrait |
| 14 | `…kapner-gary__3_img` | the same flyer as 12 | wordmark |
| 15 | `…kapner-gary__4_img` | a bulleted policy list | not a portrait |
| 16 | `…kapner-gary__5_img` | "KAPNER For Mendham Township Committee" card with an embedded headshot, a URL and a QR code | wordmark — Sean's Menard ruling: a portrait carrying campaign slogan text does not ship |

**16 of 16 refused, and the pattern is the finding.** The previous round
recorded that `og:image` failed 7 of 7 because a share card is designed to be a
banner. Collecting the page's own `<img>` elements as well was the fix for that,
and on this ballot it produced logos, flyers, signatures and a lake. **Not one
of the sixteen is a clean solo portrait of the candidate.**

## New Hampshire — 15 staged, 12 refused, 3 queued

| # | file | what it actually is | verdict |
|---|---|---|---|
| 1 | `…weir-ben__1_img` | candidate holding a campaign lawn sign, full body, sign text dominant | refused — campaign material, not a portrait |
| 2 | `…menard-tobin__1_ogimage` | full-length solo, plain white background, **no text of any kind** | **QUEUED** |
| 3 | `…menard-tobin__2_img` | the same image | **QUEUED** (duplicate of 2) |
| 4 | `…fife-shaun__1_ogimage` | "MAJl Party — THE RISING PARTY" logo | refused — not a portrait |
| 5 | `…harned-rebecca__1_ogimage` | split card: wordmark beside a photo with two dogs | refused — wordmark; not solo |
| 6 | `…harned-rebecca__2_img` | candidate with two dogs, lifestyle candid | refused — not a portrait |
| 7 | `…harned-rebecca__3_img` | pure wordmark | refused — not a portrait |
| 8 | `…harned-rebecca__4_img` | candidate with a child in a canoe | refused — group shot |
| 9 | `…harned-rebecca__5_img` | "Professional Fire Fighters N.H." seal | refused — an organisation's mark, and an endorsement mark at that |
| 10 | `…harned-rebecca__6_img` | "THE NEXT 50" graphic | refused — not a portrait |
| 11 | `…manzur-karishma__1_ogimage` | split card: "KARISHMA MANZUR US SENATE" wordmark beside a clean headshot | refused — the wordmark is IN the image |
| 12 | `…manzur-karishma__2_img` | two people on a street | refused — not sole subject |
| 13 | `…manzur-karishma__3_img` | two people on a porch | refused — group |
| 14 | `…martin-andy__1_img` | **clean solo headshot, plain grey background, no text** | **QUEUED** |
| 15 | `…vail-john__1_img` | an engraving / cartoon | refused — not a portrait of the candidate |

**Note on 11.** Karishma Manzur's card carries a genuinely clean headshot on its
right half. It is refused as it stands because the wordmark travels with it in
the same file, not because the photograph is wrong — a cropped version would be
a different question and is not one a session may answer by cropping somebody's
campaign material.

## What is queued, and what queued means

- **Tobin Menard**, Executive Councilor District 2 — his own campaign site's
  `og:image`, door 3, no text, sole subject, plain background.
- **Andy Martin**, US Senate — a solo headshot from his own campaign site, door
  3, no text, plain background.

**Queued is not approved.** Both are in
`portraits-staged-2026-08-24.png` in the Drive mirror for Sean to say yes or no
to. Only he closes a photo row.

*Refusing an image says nothing about whether a correct portrait exists for that
person. The hunt continues either way.*
