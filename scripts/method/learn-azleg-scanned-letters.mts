import { join } from "node:path";

import { runLearnBatch, type LearnedRoute } from "../../lib/method/learn-batch.ts";
import { today } from "../doc-dates.mjs";

/**
 * `learn-azleg-scanned-letters` — **TWO THINGS THE METHOD STORE RECORDS ABOUT
 * ARIZONA ARE WRONG, AND BOTH WERE MEASUREMENT ARTEFACTS.** (AZ04, 2026-08-28.)
 *
 * The store is additive and `learnRoute` refuses a duplicate id, so a wrong
 * entry is corrected by a LATER entry that names it and says what changed —
 * never by editing the store, which is generated and never hand-edited
 * (RULING 92). Both corrections below exist because a session measured the
 * wrong thing and wrote the result down as a property of a government's
 * documents.
 *
 * ## Correction 1 — the letters are SCANS, not born-digital
 *
 * `governor-transmittal-letters-published-by-the-receiving-chamber` records
 * the letters at `/govlettr/` as *"each a separate born-digital PDF"*. Measured
 * with this repo's own instrument, `hb2003.pdf` returns
 * `TEXT_LAYER ZERO_ROWS rows=0 pages=1 pagesWithText=0`, and its internals are
 * `/Font 0`, `/Image 40`, `/CCITTFaxDecode 18`, `/DCTDecode 1` — a mixed-raster
 * scan, JPEG background with CCITT G4 text masks. It is clean ~200 DPI bilevel
 * typed text and near-ideal OCR input, but there is no text layer to read.
 *
 * The cost of the wrong entry is precise: a later session inheriting
 * "born-digital" runs the text layer, gets nothing, and has to decide whether
 * the document is empty. That is the ZERO_ROWS-as-empty-document defect with a
 * head start.
 *
 * ## Correction 2 — the signing date was never missing
 *
 * The same walk recorded that an enacted Arizona bill has no published signing
 * date, on the evidence that grepping a chaptered version for
 * `approved|governor|filed` returned nothing. **The grep was over the PDF's
 * BYTES.** These are born-digital PDFs and their text lives inside compressed
 * content streams, so a byte grep is guaranteed to find nothing on a document
 * that says the thing plainly. Extracted properly, every chaptered version
 * ends with its own stamp:
 *
 *     APPROVED BY THE GOVERNOR FEBRUARY 6, 2026.
 *     FILED IN THE OFFICE OF THE SECRETARY OF STATE FEBRUARY 6, 2026.
 *
 * A NAMED GAP that is actually a broken instrument is worse than no gap at
 * all: it is a durable, sourced-looking record that a government does not
 * publish something it publishes on every page.
 *
 * Run once, by the integration owner. Idempotent.
 */

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");

const ROUTES: LearnedRoute[] = [
  {
    id: "azleg-governor-letters-are-scans-correcting-the-born-digital-claim",
    title:
      "the Arizona governor's transmittal letters are mixed-raster SCANS, and the store said born-digital",
    tier: "A0",
    fields: ["document", "officeholder", "extraction"],
    note:
      "CORRECTS THE ENTRY `governor-transmittal-letters-published-by-the-receiving-chamber`, WHICH RECORDS THE /govlettr/ PDFs AS 'each a separate born-digital PDF'. THAT IS FALSE AND WAS NEVER MEASURED. Measured 2026-08-28 with this repo's own instrument on https://www.azleg.gov/govlettr/57leg/2r/hb2003.pdf (40,860 bytes): lib/extract/text-layer.ts returns TEXT_LAYER ZERO_ROWS rows=0 pages=1 pagesWithText=0. The PDF internals say why: /Font 0, /Image 40, /CCITTFaxDecode 18, /DCTDecode 1 — a mixed-raster scan, a JPEG background carrying CCITT G4 bilevel text masks. The typed text is clean and roughly 200 DPI, which is near-ideal OCR input, but there is NO TEXT LAYER and no amount of retrying the text layer will produce one. THE ROUTE IS THEREFORE REQUIRES_NEW_ADAPTER AND NOT BLOCKED: OCR is the named rung (lib/extract/ocr.ts, which returns CANNOT_RUN with the install line when tesseract is absent from PATH). WHAT THE WRONG ENTRY WOULD HAVE COST: a session inheriting 'born-digital' runs the text layer, receives zero rows, and is one careless step from recording that the Governor's letter says nothing — a ZERO_ROWS extraction reported as an empty document, about a public official's own signed correspondence. CONTRAST, ON THE SAME HOST: the chaptered versions at /legtext/<Leg>Leg/<Sess>/laws/<NNNN>.pdf ARE born-digital and extract cleanly (TEXT_LAYER EXTRACTED rows=7 pages=7 on 0001.pdf). Two publication pipelines on one host, and the class of a PDF is a property of the pipeline that made it, never of the host or of the sibling directory next to it.",
    origin:
      "measured 2026-08-28 while building the azleg ingestion, when the letters phase of scripts/hunt-azleg-actions.mts returned ZERO_ROWS on a document the method store promised had a readable text layer.",
    effort: {
      repeats: "PER_SOURCE",
      execution: "MACHINE",
      discovery: "KNOWN_METHOD",
      note:
        "One extraction attempt per document class, over bytes that were being fetched anyway. The expensive half is the crawl delay: www.azleg.gov asks 120 seconds between requests, so classifying a document class costs two minutes, and reading all 151 letters costs about five hours.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 151,
      outcome: "BLOCKED",
      note:
        "151 letters indexed and their URLs held; the documents are NOT READ pending an OCR engine. BLOCKED is the route's state and is not a statement about the letters' contents — nothing about any bill's disposition may be inferred from the letters being unread, and in particular the measured fact that the 151 lettered bills and the 264 chaptered bills are DISJOINT is consistent with every letter being a veto and is not evidence of it.",
    },
  },
  {
    id: "verify-a-pdfs-class-before-recording-it-as-born-digital",
    title: "'born-digital' is a measurement, and an unverified one costs a later session a false absence",
    tier: "A1",
    fields: ["document", "extraction", "source"],
    note:
      "THE PORTABLE RULE. A PDF's class — born-digital with a text layer, versus a raster scan needing OCR — is the single fact that decides which extraction rung applies, and it is cheap to measure and expensive to assume. RECORD IT ONLY FROM AN ACTUAL EXTRACTION, and record the numbers: rows, pages, pagesWithText. A publisher very often runs TWO pipelines side by side, so the class travels with the DOCUMENT CLASS and never with the host: on www.azleg.gov the chaptered bill texts under /legtext/ are born-digital and the Governor's transmittal letters under /govlettr/ are scans, and they are two directories on the same server. WHY IT MATTERS MORE THAN IT LOOKS: an unverified 'born-digital' is inherited by every later jurisdiction as a reason to trust a text layer, and when the text layer returns nothing the next session is being asked to choose between 'the parser failed' and 'the document is empty' with a stale note nudging it toward the second. That is the ZERO_ROWS-as-empty-document defect arriving pre-argued. THE CHEAP CHECK: run the text layer on ONE document of the class and look at pagesWithText; if it is zero, look at the PDF's internals (/Font count, /Image count, filter names) and write down what you saw, not what you expected.",
    origin:
      "generalised 2026-08-28 from the azleg correction, where a prior session's unmeasured 'born-digital PDF' description of a scanned document class was inherited as fact by the ingestion that followed it.",
    effort: {
      repeats: "PER_SOURCE",
      execution: "MACHINE",
      discovery: "KNOWN_METHOD",
      note: "One extraction over one document already in hand. Effectively free next to the fetch that produced it.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 2,
      outcome: "YIELDED",
      note:
        "Two document classes on one permitted host correctly classified — /legtext/ born-digital and EXTRACTED, /govlettr/ scanned and ZERO_ROWS — replacing one unmeasured claim that covered both.",
    },
  },
  {
    id: "grep-the-extracted-text-never-the-pdf-bytes",
    title:
      "a byte grep over a born-digital PDF finds nothing on a document that says it plainly, and the nothing becomes a false absence",
    tier: "A0",
    fields: ["document", "extraction", "vote", "officeholder"],
    note:
      "THE MISTAKE THIS PREVENTS IS MANUFACTURING A NAMED GAP OUT OF A BROKEN INSTRUMENT. A prior walk recorded that an enacted Arizona bill has NO PUBLISHED SIGNING DATE, on the evidence that grepping a chaptered version for approved|governor|filed returned nothing. The grep was run over the PDF's BYTES. A born-digital PDF stores its text inside FlateDecode content streams, so a byte grep cannot match ordinary words in it and returns nothing regardless of what the document says — the measurement was guaranteed to produce that answer before it was run. MEASURED CORRECTLY 2026-08-28: extract the text layer first, and every chaptered version at https://www.azleg.gov/legtext/57Leg/2R/laws/<NNNN>.pdf ends with its own enactment stamp — 'APPROVED BY THE GOVERNOR FEBRUARY 6, 2026. FILED IN THE OFFICE OF THE SECRETARY OF STATE FEBRUARY 6, 2026.' That is a signing date, published by the state, in the primary document, for every enacted bill. THE GENERAL RULE: NEVER grep, regex or string-search a PDF, a DOCX or any compressed container directly. Run the extraction layer and search ITS OUTPUT, and if the extraction returns nothing, that is a finding about the extraction. WHY THIS ONE IS DANGEROUS RATHER THAN MERELY WRONG: it does not fail loudly. It produces a confident, specific, plausible-sounding absence — 'the state does not publish signing dates' — which is a false claim about a government, and it then hardens into a NAMED GAP that later sessions inherit and cite. A SECOND LESSON FROM THE SAME DOCUMENT: read the stamp's WORDING, not just its date. A bill reaches a chapter three ways — approved by the governor, becoming law without signature, or passage over a veto — so 'chaptered' proves ENACTMENT and never proves a SIGNATURE, and filing every chapter as 'signed' is its own false claim about a governmental act.",
    origin:
      "found 2026-08-28 while building the azleg ingestion: the session brief carried the prior walk's conclusion that chapter PDFs 'carry no approval date (grep for approved|governor|filed returns nothing)', and the first extracted chapter ended with the approval date in capital letters.",
    effort: {
      repeats: "ONCE",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note:
        "No additional request. The correction costs one text-layer extraction over a document already downloaded, and it converted a permanent named gap into a populated field on every enacted-bill row.",
    },
    outcome: {
      jurisdiction: "az",
      rows: 264,
      outcome: "YIELDED",
      note:
        "The signing date for all 264 chaptered bills of 57leg/2r moved from 'no permitted machine-readable source' to a field read off each act's own stamp, together with the enactment ROUTE that says whether a signature happened at all.",
    },
  },
];

runLearnBatch(STORE, ROUTES, today());
