/**
 * **THE HYPERLOCAL PRESS SURFACE, ENUMERATED PER MUNICIPALITY.**
 * (The final pass, 2026-08-25, item 4.)
 *
 * ## PERMISSION IS READ FIRST, AND THIS SESSION LEARNED THAT THE HARD WAY
 *
 * Earlier the same night this session put two search engines into a pool on the
 * strength of *does it answer* and *does it pass a control*, and both carried
 * `Disallow: /search`. The register had said so, dated, and it was not read.
 *
 * So every outlet here carries the `User-agent: *` block from its OWN
 * `robots.txt`, read on the date given, **before** any page was fetched — and an
 * outlet whose policy could not be READ is not walked, because permission that
 * cannot be established is not permission.
 *
 * ## What was found, 2026-08-25
 *
 * | Outlet | `robots.txt` | Verdict |
 * | --- | --- | --- |
 * | `patch.com` | 200; disallows `/includes/`, `/misc/`, `/modules/`, `/profiles/`, `/scripts/`, `/themes/` — infrastructure only | **WALK.** Per-town pages are permitted |
 * | `dailyrecord.com` | 200; disallows `/errors`, `/interactive/`, `/userauth/`, `/ugc/`, `/feeds/`, `/services/` | **WALK.** Article and search paths are permitted |
 * | `northjersey.com` | the same Gannett policy | **WALK** |
 * | `morristowngreen.com` | 200; disallows `/wp-login.php` and `/wp-admin/` only | **WALK.** Already walked 2026-08-24 |
 * | `newjerseyglobe.com` | 200; no disallows at all | **WALK.** Already walked 2026-08-24 |
 * | `www.tapinto.net` | **`robots.txt` itself answers 403** | **DO NOT WALK.** The policy cannot be read, so permission cannot be established. A 403 on the policy is not an implied yes |
 *
 * ## AND A PRESS PAGE IS NOT A VERIFIED PAGE
 *
 * A newspaper writing about a candidate is a source ABOUT them and never their
 * own page — the same distinction that kept `huffpost.com` from being recorded
 * as a comedian's campaign site. What a press walk yields is the candidate's
 * own words quoted with a citation, and LINKS to sites that may be theirs, each
 * of which still faces `classifyCampaignPage` before it becomes anything.
 *
 * **No press route supplies a photo, at any outlet.** Press photos are the
 * demand-letter class and no door reaches them.
 */

/** Whether a host's own policy permits the paths a walk would use. */
export type PressPermission =
  /** The policy was read and permits it. */
  | "PERMITTED"
  /** The policy was read and forbids the path. Honoured; never re-walked on a clock. */
  | "DISALLOWED"
  /** The policy could not be read. NOT an implied yes. */
  | "UNREADABLE";

export interface PressOutlet {
  id: string;
  host: string;
  /** What kind of outlet — it decides what the walk may take from it. */
  kind: "hyperlocal-network" | "county-daily" | "regional-daily" | "statewide" | "town-weekly";
  permission: PressPermission;
  /** The `User-agent: *` block as read, and the date. */
  robots: string;
  /** Per-town URL where the outlet publishes one; null where it does not. */
  townUrl: ((slug: string) => string) | null;
  /** A single entry point where there is no per-town form. */
  entry: string | null;
}

/**
 * The spellings a hyperlocal network might use for one municipality.
 *
 * **A 404 on OUR spelling is not an absence of coverage**, and the first run of
 * this walk reported 4 of 39 Patch towns on exactly that mistake:
 * `parsippany-troy-hills` answers 404 while `parsippany` answers 200, and the
 * same is true of Montville and Jefferson. Three real hyperlocals were recorded
 * as towns with no press.
 *
 * That is RULING 100 in miniature — a partial that reconciles is still wrong —
 * and it is the reason this returns a LIST rather than a string: the walk tries
 * each spelling and an absence is only claimed once all of them have failed.
 *
 * The forms, in the order a network is likeliest to use them: the full name, and
 * the bare town without its `township`/`borough`/`town` suffix — which is how
 * a reader says it and how these networks generally spell it.
 */
export function townSlugs(municipality: string): string[] {
  const full = municipality.replace(/_/g, "-");
  const bare = municipality.replace(/_(township|borough|town)$/, "").replace(/_/g, "-");
  return [...new Set([full, bare])];
}

export const PRESS_OUTLETS: readonly PressOutlet[] = [
  {
    id: "patch",
    host: "patch.com",
    kind: "hyperlocal-network",
    permission: "PERMITTED",
    robots:
      "`User-agent: *` disallowing `/includes/`, `/misc/`, `/modules/`, `/profiles/`, `/scripts/` and `/themes/` — infrastructure paths only, and no article or town path (read 2026-08-25)",
    townUrl: (slug) => `https://patch.com/new-jersey/${slug}`,
    entry: null,
  },
  {
    id: "daily-record",
    host: "www.dailyrecord.com",
    kind: "county-daily",
    permission: "PERMITTED",
    robots:
      "`User-agent: *` disallowing `/errors`, `/interactive/`, `/userauth/`, `/ugc/`, `/feeds/` and `/services/` — article and search paths are not among them (read 2026-08-25)",
    townUrl: null,
    entry: "https://www.dailyrecord.com/search/?q=Morris%20County%20candidate%202026",
  },
  {
    id: "northjersey",
    host: "www.northjersey.com",
    kind: "regional-daily",
    permission: "PERMITTED",
    robots: "the same Gannett policy as `dailyrecord.com` (read 2026-08-25)",
    townUrl: null,
    entry: "https://www.northjersey.com/search/?q=Morris%20County%20election%202026",
  },
  {
    id: "morristown-green",
    host: "morristowngreen.com",
    kind: "town-weekly",
    permission: "PERMITTED",
    robots: "`User-agent: *` disallowing `/wp-login.php` and `/wp-admin/` only (read 2026-08-25)",
    townUrl: null,
    entry: "https://morristowngreen.com/",
  },
  {
    id: "new-jersey-globe",
    host: "newjerseyglobe.com",
    kind: "statewide",
    permission: "PERMITTED",
    robots: "`User-agent: *` with NO disallow lines at all (read 2026-08-25)",
    townUrl: null,
    entry: "https://newjerseyglobe.com/",
  },
  {
    id: "tapinto",
    host: "www.tapinto.net",
    kind: "hyperlocal-network",
    permission: "UNREADABLE",
    robots:
      "**`https://www.tapinto.net/robots.txt` answers HTTP 403.** The policy cannot be read, so permission cannot be established — and a 403 on the policy is not an implied yes (read 2026-08-25)",
    townUrl: null,
    entry: null,
  },
];

/** Only outlets whose own policy was READ and permits the walk. */
export function walkableOutlets(): PressOutlet[] {
  return PRESS_OUTLETS.filter((o) => o.permission === "PERMITTED");
}
