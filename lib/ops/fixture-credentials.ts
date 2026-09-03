/**
 * **A CAPTURED PUBLIC PAGE IS EVIDENCE, NOT A CREDENTIAL VAULT.**
 * (2026-08-28, the post-cleanroom shipping hotfix.)
 *
 * ## What happened, because the mechanism is the lesson
 *
 * PR #216 compiled and bundled clean and then failed Netlify's secret scan.
 * The finding was not ours: `tests/fixtures/legistar-insite-pima-clerk-schedule.html`
 * is a byte-for-byte capture of Pima County's Clerk of the Board schedule page,
 * recorded live by `scripts/learn-legistar-horizon.mts --record`, and the
 * PUBLISHER's own bootstrap JSON carries a Google Maps browser key. Nobody
 * pasted anything. The repository became a mirror of a third party's live
 * credential because a `writeFileSync` wrote a public page verbatim.
 *
 * That is the class, and it is a class about ACQUISITION, not about care:
 *
 * > PUBLIC WEB CAPTURE -> TEST FIXTURE MUST REMOVE CREDENTIAL-LIKE MATERIAL
 * > THAT IS IRRELEVANT TO THE TESTED RECORD, WHILE PRESERVING PROVENANCE AND
 * > PARSER SEMANTICS.
 *
 * A committed fixture is a PARSER REGRESSION ARTIFACT. It has to carry every
 * byte the parser reads and it has no business carrying anything else.
 *
 * ## WHY THIS IS PATTERN-BASED WHEN `secret-redaction.ts` REFUSES TO BE
 *
 * `lib/ops/secret-redaction.ts` argues at length that a secret sweep must run
 * BY VALUE, from `.env.local`, and that a shape-based scanner is both useless
 * and unsafe. **That argument is correct and this module does not contradict
 * it, because the two modules answer different questions.**
 *
 *   - `secret-redaction.ts` looks for OUR credentials. We hold the values, so
 *     by-value is available and is strictly better than any shape.
 *   - This module looks for a THIRD PARTY'S credentials, emitted by a page we
 *     did not write, whose values are unknowable before capture. By-value is
 *     not merely worse here; it is not a thing that can be done.
 *
 * ## THE PATTERN IS THE FILTER. THE `confirm` PREDICATE IS THE VERDICT.
 *
 * The false-positive problem that ruled out shapes over there is answered here
 * by **class-awareness in two stages**, and the second stage is the one that
 * matters. Every pattern is anchored on a vendor-assigned literal prefix or a
 * structural marker — `AIza`, three base64url JWT segments, `AKIA`,
 * `-----BEGIN … PRIVATE KEY-----`. None is "a long random-looking string", so
 * a git SHA, a CivicPlus container GUID, a meeting id, a date and an ordinary
 * UUID never reach stage two at all.
 *
 * Stage two then asks whether the match is a CREDENTIAL rather than merely a
 * string of that shape, and the two real cases this repository contains are
 * why it exists:
 *
 *   - `window.hcmsClientToken="Bearer eyJ…"` in the Pima capture decodes to a
 *     payload carrying `exp`, `nbf`, `iss`, `iat`, `jti`, `client_id` and
 *     `scope`. Those are RFC 7519 registered authentication claims. It is a
 *     bearer credential and it is live for thirty days.
 *   - `https://lnks.gd/l/eyJ…` in `data/states/nj/hunt/nj-campaign-sites-*.json` decodes
 *     to `{"bulletin_link_id", "uri", "bulletin_id", "url"}` — a GovDelivery
 *     signed *link*, whose entire payload is a public justice.gov URL. It is a
 *     PUBLIC RECORD IDENTIFIER that the hunt genuinely found, and redacting it
 *     would destroy the provenance of a source link to protect nothing.
 *
 * Registered-claims-or-`Bearer`-position separates those two perfectly, and it
 * is grounded in the standard rather than in a vocabulary someone guessed at.
 * The same discipline retires the other false positive the first draft had:
 * `docs/deploy-key-setup.md` and `tests/deploy-key-ssh.test.ts` both quote the
 * string `-----BEGIN OPENSSH PRIVATE KEY-----`, one in prose and one as a
 * deliberate structural placeholder with a body of sixty-four `x`s. Requiring
 * an actual base64 body with real alphabet diversity excludes both **on the
 * evidence**, which is the only kind of exclusion that stays correct when
 * somebody edits those files.
 *
 * ## NOTHING IS SET ASIDE SILENTLY
 *
 * An unconfirmed match is still a finding. It is returned, counted, printed and
 * carries the reason it was not treated as a credential. Setting something
 * aside with no number is the trim this codebase names more often than any
 * other defect, and a scanner that quietly drops matches is indistinguishable
 * from one that never looked.
 *
 * ## NO PATTERN LIST IS EVER COMPLETE
 *
 * `CLASSES` is what the project knows now. It is a floor and never a completion
 * condition: a file this scanner passes is a file with no KNOWN credential
 * class in it, which is a claim about this list, not a claim about the file.
 * The gate exists so the known classes cost nobody a second red deploy — not so
 * anyone can call the fixture tree proven clean.
 */

/** What a redacted credential is replaced with. Matches no credential scanner. */
export const REDACTION_PLACEHOLDER = "__SOURCE_CREDENTIAL_REDACTED__";

/** The sanitizer rule set's version. Recorded per file, so a re-run is comparable. */
export const SANITIZER_VERSION = "fx-cred-v1-2026-08-28";

/** Where a match sits, for the predicates that need more than the match itself. */
export interface MatchContext {
  /** The whole text being scanned. */
  text: string;
  /** Character offset of the match. */
  index: number;
  /** Capture groups from the class pattern. */
  groups: readonly (string | undefined)[];
}

export interface CredentialClass {
  /** Stable id, used in reports and in the provenance record. */
  id: string;
  /** What a reader needs to know to act on a finding. */
  what: string;
  /** Anchored on a vendor prefix or a structural marker — never on entropy. */
  pattern: RegExp;
  /**
   * Stage two. Returns `null` when the match IS a credential, or a short reason
   * when it is a string of that shape and demonstrably not one. The reason is
   * printed, so a wrong exclusion is visible rather than invisible.
   */
  confirm?: (value: string, context: MatchContext) => string | null;
}

/** Base64url segment -> parsed JSON object, or `null` if it is not one. */
function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    const parsed: unknown = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * RFC 7519 registered claims, plus the two OAuth claims every identity server
 * in practice emits. A token carrying any of these is asserting *who bears it
 * and for how long*, which is what makes it a credential rather than a signed
 * identifier.
 */
const AUTH_CLAIMS = ["exp", "nbf", "iat", "iss", "aud", "sub", "jti", "scope", "client_id", "azp"];

/**
 * THE KNOWN CREDENTIAL CLASSES.
 *
 * Each `pattern` is written WITHOUT the global flag; `matchAll` needs it, so
 * the scanner clones each with `g` rather than relying on a shared `lastIndex`.
 * A shared stateful regex across files is the classic way a scanner silently
 * skips the first match in every second file it reads.
 */
export const CLASSES: readonly CredentialClass[] = [
  {
    id: "google_api_key",
    what: "a Google API browser key (Maps, Places, and siblings)",
    // The incident class. 39 characters total: the `AIza` prefix and 35 more.
    pattern: /AIza[0-9A-Za-z_-]{35}/,
  },
  {
    id: "jwt",
    what: "a signed JSON Web Token — a bearer credential for as long as it lives",
    /*
     * Three base64url segments, and the first TWO must begin `eyJ`, which is
     * base64url for `{"`. That structural requirement keeps the pattern off
     * ordinary base64: a random payload does not decode to a JSON object in
     * both its header and its claims.
     */
    pattern: /eyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{8,}/,
    confirm: (value, { text, index }) => {
      const [header, payload] = value.split(".");
      if (!decodeSegment(header)) return "the header does not decode to a JSON object";
      const claims = decodeSegment(payload);
      if (!claims) return "the payload does not decode to a JSON object";

      // Presented AS a credential, whatever it carries.
      if (/\bBearer\s+$/i.test(text.slice(Math.max(0, index - 16), index))) return null;

      const present = AUTH_CLAIMS.filter((c) => c in claims);
      if (present.length > 0) return null;

      return (
        "a signed identifier, not a credential — the payload carries no RFC 7519 " +
        `authentication claim (${Object.keys(claims).slice(0, 6).join(", ")})`
      );
    },
  },
  {
    id: "mapbox_secret_token",
    what: "a Mapbox SECRET token (`sk.`), which is not the publishable `pk.` kind",
    pattern: /\bsk\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  },
  {
    id: "aws_access_key_id",
    what: "an AWS access key id",
    pattern: /\b(?:AKIA|ASIA|AIDA|AROA)[0-9A-Z]{16}\b/,
  },
  {
    id: "github_token",
    what: "a GitHub personal access / app / refresh token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  },
  {
    id: "slack_token",
    what: "a Slack API token",
    pattern: /\bxox[abprs]-[0-9A-Za-z-]{10,}/,
  },
  {
    id: "stripe_secret_key",
    what: "a Stripe secret or restricted key",
    pattern: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/,
  },
  {
    id: "google_oauth_client_secret",
    what: "a Google OAuth client secret",
    pattern: /\bGOCSPX-[A-Za-z0-9_-]{20,}/,
  },
  {
    id: "sendgrid_api_key",
    what: "a SendGrid API key",
    pattern: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  },
  {
    id: "npm_token",
    what: "an npm access token",
    pattern: /\bnpm_[A-Za-z0-9]{36}\b/,
  },
  {
    id: "private_key_block",
    what: "a PEM private key block",
    /*
     * THE BODY IS PART OF THE MATCH, and that is the whole refinement.
     *
     * Matching the header alone flagged a sentence in `docs/deploy-key-setup.md`
     * that NAMES the header, which is how a guard teaches people to ignore it.
     */
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\r\n]+([A-Za-z0-9+/=][A-Za-z0-9+/=\r\n]{31,})/,
    confirm: (_value, { groups }) => {
      const body = (groups[0] ?? "").replace(/[\r\n]/g, "");
      // A real key body uses most of the base64 alphabet. A placeholder is one
      // character repeated — `tests/deploy-key-ssh.test.ts` uses sixty-four `x`s
      // deliberately, so that no test run ever handles key material.
      const distinct = new Set(body).size;
      if (distinct < 8) {
        return `a structural placeholder — the body uses ${distinct} distinct character(s)`;
      }
      return null;
    },
  },
];

export interface CredentialFinding {
  /** The class that matched. */
  classId: string;
  /** SHA-256 prefix of the matched value. **The value itself is never carried.** */
  fingerprint: string;
  /** Character length of the matched value, which is diagnostic and not sensitive. */
  length: number;
  /** 1-indexed line the match starts on. */
  line: number;
  /** How many times this exact value occurs in the file. */
  occurrences: number;
  /** Did stage two agree this is a credential? Only confirmed findings block or redact. */
  confirmed: boolean;
  /** Why an unconfirmed finding was not treated as a credential. */
  note?: string;
}

/**
 * A short, stable fingerprint of a value.
 *
 * **RULING 127 — no tool prints a credential value.** A fingerprint lets two
 * reports be compared, and a redaction be confirmed, without the value ever
 * reaching a terminal, a log, a PR body or a transcript. Twelve hex characters
 * is far too little to invert and far more than enough to distinguish the
 * handful of values one page emits.
 */
export function fingerprint(value: string, sha256Hex: (input: string) => string): string {
  return sha256Hex(value).slice(0, 12);
}

/** Every match of every class, confirmed or not, with the value never carried out. */
export function scanText(text: string, sha256Hex: (input: string) => string): CredentialFinding[] {
  const findings: CredentialFinding[] = [];

  // Line starts, computed once. Calling `split` inside the match loop turned a
  // 1.1 MB fixture into a multi-second scan when this was first written.
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  for (const klass of CLASSES) {
    const global = new RegExp(klass.pattern.source, `${klass.pattern.flags}g`);
    const byValue = new Map<
      string,
      { first: number; count: number; confirmed: boolean; note?: string }
    >();

    for (const match of text.matchAll(global)) {
      const value = match[0];
      const index = match.index ?? 0;
      const reason = klass.confirm
        ? klass.confirm(value, { text, index, groups: match.slice(1) })
        : null;

      const seen = byValue.get(value);
      if (seen) {
        seen.count += 1;
        // One confirmed placement is enough: the same string used as a bearer
        // token once is a credential even where it also appears inertly.
        if (reason === null && !seen.confirmed) {
          seen.confirmed = true;
          delete seen.note;
        }
      } else {
        byValue.set(value, {
          first: index,
          count: 1,
          confirmed: reason === null,
          ...(reason === null ? {} : { note: reason }),
        });
      }
    }

    for (const [value, seen] of byValue) {
      findings.push({
        classId: klass.id,
        fingerprint: fingerprint(value, sha256Hex),
        length: value.length,
        line: lineOf(seen.first),
        occurrences: seen.count,
        confirmed: seen.confirmed,
        ...(seen.note ? { note: seen.note } : {}),
      });
    }
  }

  return findings.sort((a, b) => a.line - b.line || a.classId.localeCompare(b.classId));
}

/** The confirmed subset — what blocks a gate and what a sanitizer replaces. */
export function credentials(findings: readonly CredentialFinding[]): CredentialFinding[] {
  return findings.filter((f) => f.confirmed);
}

export interface SanitizeResult {
  text: string;
  /** One entry per DISTINCT value replaced, with its occurrence count. */
  redactions: CredentialFinding[];
  /** Matches deliberately left in place, with the reason — never silently dropped. */
  preserved: CredentialFinding[];
  /** `redactions` summed over occurrences — the number of replaced substrings. */
  replaced: number;
}

/**
 * Replace every CONFIRMED credential with `REDACTION_PLACEHOLDER`.
 *
 * **Longest value first**, for the reason `redactSecrets` gives one module
 * over: one credential can contain another — a Mapbox `sk.` token contains a
 * JWT-shaped body — and replacing the short one first leaves the long one
 * mangled, unrecognisable to the second pass, and still partly present.
 *
 * Nothing else about the text is touched. The surrounding HTML, the table the
 * parser reads, every meeting row, date, time, body identity and public record
 * identifier survive byte-for-byte, and `tests/legistar-insite-union.test.ts`
 * is what proves it on the fixture this was written for.
 */
export function sanitizeText(text: string, sha256Hex: (input: string) => string): SanitizeResult {
  const findings = scanText(text, sha256Hex);
  const confirmed = credentials(findings);
  const preserved = findings.filter((f) => !f.confirmed);
  if (confirmed.length === 0) return { text, redactions: [], preserved, replaced: 0 };

  /*
   * The values are re-derived here rather than carried out of `scanText`,
   * which deliberately returns fingerprints only. Matching on fingerprint
   * keeps the two passes agreeing without a second copy of the confirm logic.
   */
  const wanted = new Set(confirmed.map((f) => f.fingerprint));
  const values = new Set<string>();
  for (const klass of CLASSES) {
    const global = new RegExp(klass.pattern.source, `${klass.pattern.flags}g`);
    for (const match of text.matchAll(global)) {
      if (wanted.has(fingerprint(match[0], sha256Hex))) values.add(match[0]);
    }
  }

  let out = text;
  let replaced = 0;
  for (const value of [...values].sort((a, b) => b.length - a.length)) {
    const parts = out.split(value);
    replaced += parts.length - 1;
    out = parts.join(REDACTION_PLACEHOLDER);
  }

  return { text: out, redactions: confirmed, preserved, replaced };
}

/**
 * Is this path in a tree that holds captured third-party bodies?
 *
 * Kept as a function rather than a constant so the acquisition boundary and the
 * guard cannot drift apart — the sweep, the guard and `save()` in the recorder
 * all ask this one question.
 */
export function isCapturedFixturePath(repoRelativePath: string): boolean {
  return repoRelativePath.startsWith("tests/fixtures/");
}

/**
 * Files that legitimately contain the PATTERNS and never a value: this module,
 * its test, and its sweep.
 *
 * **This list is about pattern text, not about trust.** Nothing here is exempt
 * from scanning — the sweep still reads every one of them and still reports
 * what it finds. What the list does is keep the guard from failing on a regex
 * literal, which is the one way a scanner reliably gets disabled.
 */
export const PATTERN_BEARING_PATHS: readonly string[] = [
  "lib/ops/fixture-credentials.ts",
  "tests/fixture-credentials.test.ts",
  "scripts/fixture-credential-sweep.mts",
];
