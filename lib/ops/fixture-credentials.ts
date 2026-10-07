/** A captured public page is evidence, not a credential vault: known credential classes are found, confirmed and redacted. */

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
  /** Stage two: null when the match is a credential, else a printed reason it demonstrably is not one. */
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

/** Registered JWT claims plus the two common OAuth ones: a token carrying any asserts who bears it and for how long. */
const AUTH_CLAIMS = ["exp", "nbf", "iat", "iss", "aud", "sub", "jti", "scope", "client_id", "azp"];

/** The known credential classes. Each pattern is written without the global flag; the scanner clones it with `g`. */
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
    /* Three base64url segments with the first two beginning `eyJ`, which keeps the pattern off ordinary base64. */
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
    /* The body is part of the match, so prose that merely names the header is not flagged. */
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\r\n]+([A-Za-z0-9+/=][A-Za-z0-9+/=\r\n]{31,})/,
    confirm: (_value, { groups }) => {
      const body = (groups[0] ?? "").replace(/[\r\n]/g, "");
      // A real key body uses most of the base64 alphabet. A placeholder is one
      // character repeated — the regression test uses sixty-four `x`s
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

/** A short, stable fingerprint of a value, so reports compare without the value ever being printed. */
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

/** Replace every confirmed credential with `REDACTION_PLACEHOLDER`, longest value first, since one credential can contain another. */
export function sanitizeText(text: string, sha256Hex: (input: string) => string): SanitizeResult {
  const findings = scanText(text, sha256Hex);
  const confirmed = credentials(findings);
  const preserved = findings.filter((f) => !f.confirmed);
  if (confirmed.length === 0) return { text, redactions: [], preserved, replaced: 0 };

  /* Values are re-derived here, since `scanText` returns fingerprints only. */
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

/** Whether this path is in a tree holding captured third-party bodies; one question for the sweep, guard and recorder. */
export function isCapturedFixturePath(repoRelativePath: string): boolean {
  return repoRelativePath.startsWith("tests/fixtures/");
}

/** Files that contain the patterns and never a value. Still scanned; only exempt from failing on a regex literal. */
export const PATTERN_BEARING_PATHS: readonly string[] = [
  "lib/ops/fixture-credentials.ts",
  "tests/fixture-credentials.test.ts",
  "scripts/fixture-credential-sweep.mts",
];
