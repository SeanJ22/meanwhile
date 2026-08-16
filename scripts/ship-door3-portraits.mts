/**
 * Ship the door-3 portraits that survived the eyeball pass (D50, 2026-08-15).
 *
 *   pnpm exec tsx scripts/ship-door3-portraits.mts
 *
 * Door 3 is the campaign's OWN self-published portrait from its OWN site.
 * `scripts/hunt-campaign-photos.mts` stages candidates; a human looks at a
 * contact sheet; the ones that pass the composition and identity standards —
 * which do NOT move at any door — are named here, with the reason they
 * passed, and this ships them.
 *
 * Named explicitly rather than derived, because "which images passed the
 * eyeball" is a human judgment and a script must never appear to have made
 * it. Everything else is mechanical: fetch once, strip metadata, commit under
 * our own origin, repoint the card, label "campaign-provided".
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { stripImageMetadata } from "./strip-image-metadata.mts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "data", "ballot", "candidate-cards-2026.json");
const TODAY = "2026-08-15";
const UA = "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)";

interface Shipment {
  /** The card key in candidate-cards-2026.json. */
  key: string;
  /** The file name under public/candidates/. */
  slug: string;
  imageUrl: string;
  /** The campaign site the image is published on. */
  site: string;
  /** Why it passed the eyeball: what the image is, in the judge's words. */
  judgment: string;
  /** File extension, when the campaign publishes something other than JPEG. */
  ext?: "jpg" | "png";
}

/**
 * The two that passed, from eleven candidates and forty-six staged images.
 *
 * Both are clean solo studio portraits against a plain ground, the
 * unambiguous sole subject, published on the candidate's own domain under a
 * filename the campaign itself named "Headshot". Nine other candidates
 * produced only banners, wordmarks, group shots, event candids and
 * compositions with several faces — all recorded in `docs/photo-report.md`
 * with the door tried and the reason.
 */
const SHIPMENTS: Shipment[] = [
  {
    key: 'ballot-az-pima:governor|Teri Ann Hourihan',
    slug: "az-pima-governor-hourihan-teri-ann",
    imageUrl:
      "https://images.squarespace-cdn.com/content/v1/688fa4f1b2679a2af766a0d7/0de6a951-58f4-4afb-91a7-43711b0f6379/Teri+Headshot-Full+Res-11.jpg",
    site: "https://teriann4azgov.org",
    judgment:
      "clean solo studio portrait, plain grey ground, unambiguous sole subject; the campaign's own file, named Teri Headshot-Full Res-11.jpg",
  },
  {
    key: 'ballot-az-pima:mine-inspector|Walter "Les" Presmyk',
    slug: "az-pima-mine-inspector-presmyk-walter-les",
    imageUrl:
      "https://images.squarespace-cdn.com/content/v1/690ada5923d577143bd5f1c0/ce807f73-9e20-4636-aa2a-e80901fff1dc/Headshot.jpg",
    site: "https://lespresmyk.com",
    judgment:
      "clean solo studio portrait, plain grey ground, unambiguous sole subject; the campaign's own file, named Headshot.jpg",
  },
  // Added 2026-08-15 (item 6b): the author named Risa Lombardo as still
  // missing a face on the 85701 ballot. The prior hunt had checked only the
  // home page's og:image and recorded the miss there — the home page carries
  // a WORDMARK ("RISA LOMBARDO / GREEN FOR GOVERNOR"), which correctly
  // failed. Door 3 is the campaign's own portrait ANYWHERE on its own site,
  // not only in an og:image tag, and her About page carries one.
  {
    key: "ballot-az-pima:governor|Risa Lombardo",
    slug: "az-pima-governor-lombardo-risa",
    imageUrl: "https://risalombardo.com/wp-content/uploads/2026/05/risal-1024x1024.png",
    site: "https://risalombardo.com",
    ext: "png",
    judgment:
      "clean solo studio portrait, plain grey ground, circular crop on transparency, unambiguous sole subject; published on her own domain's About page. NOTE for the author: the campaign's own treatment places a small party emblem inside the lower-right of the circle. It is a portrait carrying a badge, not a logo standing in for a portrait, so it passes — but it is recorded here so the ruling is yours to reverse.",
  },
];

const cardsFile = JSON.parse(await readFile(FILE, "utf8")) as {
  cards: Record<string, { photoUrl: string | null; photoSource: string | null }>;
};
await mkdir(join(ROOT, "public", "candidates"), { recursive: true });

let shipped = 0;
for (const s of SHIPMENTS) {
  // A candidate with no card yet gets one. The key is the `<contestId>|<name>`
  // form `cardForNominee()` looks up, which is the same key the links file
  // uses — these two are filed candidates who simply had nothing to put on a
  // card until now. Everything but the photo stays null: a bio needs its own
  // source and its own source-class label, and a card is not a place to
  // guess.
  const card = (cardsFile.cards[s.key] ??= {
    photoUrl: null,
    photoSource: null,
    bio: null,
    bioSourceUrl: null,
    bioSourceLabel: null,
    email: null,
    phone: null,
  } as (typeof cardsFile.cards)[string]);
  if (card.photoUrl) {
    console.log(`  ALREADY        ${s.key} → ${card.photoUrl}`);
    continue;
  }

  // Ask for JPEG or PNG explicitly. Squarespace's CDN content-negotiates and
  // will hand a WebP back for a `.jpg` URL if the request says it accepts
  // one — and the metadata stripper only understands JPEG and PNG, so an
  // unasked-for WebP means the portrait ships unstripped or not at all.
  const res = await fetch(s.imageUrl, {
    headers: {
      "user-agent": UA,
      accept: "image/jpeg,image/png",
      // Some campaign hosts refuse an image request with no referer.
      referer: s.site,
    },
  });
  if (!res.ok) {
    console.log(`  FETCH_FAILED   ${s.key} — HTTP ${res.status}`);
    continue;
  }
  const raw = Buffer.from(await res.arrayBuffer());
  const { bytes, stripped, removed } = stripImageMetadata(raw);
  if (!stripped) {
    // An unknown format does not ship. The reader is not served bytes we
    // could not inspect.
    console.log(`  NOT_STRIPPED   ${s.key} — unrecognized format, not shipped`);
    continue;
  }

  const file = `${s.slug}.${s.ext ?? "jpg"}`;
  await writeFile(join(ROOT, "public", "candidates", file), bytes);
  card.photoUrl = `/candidates/${file}`;
  card.photoSource =
    `campaign-provided — published by the campaign at ${s.site}, ` +
    `read ${TODAY}; committed copy served from our origin, metadata stripped. ` +
    `Removed on request.`;
  shipped++;
  console.log(
    `  SHIPPED        ${s.key} → /candidates/${file} ` +
      `(${Math.round(bytes.length / 1024)} KB, removed ${removed.join(", ") || "nothing"})`,
  );
}

await writeFile(FILE, `${JSON.stringify(cardsFile, null, 2)}\n`, "utf8");
const withPhoto = Object.values(cardsFile.cards).filter((c) => c.photoUrl).length;
console.log(
  `\n${shipped} of ${SHIPMENTS.length} shipped. ` +
    `${withPhoto} of ${Object.keys(cardsFile.cards).length} curated cards now carry a portrait.`,
);
