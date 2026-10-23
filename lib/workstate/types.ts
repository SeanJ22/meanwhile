

/** ----------------------------------------------------------- dispositions */

/**
 * Work and source dispositions. A CAPTCHA, missing tooling, a pending records
 * request, a third-party pointer or a presently prohibited route is not
 * absence.
 */
export const DISPOSITIONS = [
  "UNWALKED",
  "DISCOVERED",
  "IN_PROGRESS",
  "INGESTED",
  "POINTER_ONLY",
  "WALKED_NO_YIELD",
  "BLOCKED_CURRENTLY",
  "REQUIRES_NEW_ADAPTER",
  "RECORDS_REQUEST_PENDING",
  "NOT_APPLICABLE",
  "RECHECK_DUE",
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

/**
 * The dispositions that TERMINATE a child for completion purposes.
 * `BLOCKED_CURRENTLY`, `REQUIRES_NEW_ADAPTER` and `RECORDS_REQUEST_PENDING` are
 * open obligations, not done.
 */
export const TERMINAL_DISPOSITIONS: readonly Disposition[] = [
  "INGESTED",
  "WALKED_NO_YIELD",
  "NOT_APPLICABLE",
];

/** Dispositions that leave a workstream OPEN and are reported by name. */
export const OPEN_DISPOSITIONS: readonly Disposition[] = [
  "UNWALKED",
  "DISCOVERED",
  "IN_PROGRESS",
  "POINTER_ONLY",
  "BLOCKED_CURRENTLY",
  "REQUIRES_NEW_ADAPTER",
  "RECORDS_REQUEST_PENDING",
  "RECHECK_DUE",
];

/** --------------------------------------- permission and transport, apart */

/**
 * What a host's robots.txt said about a route, as RECORDED evidence.
 * `CANNOT_TELL` (the document could not be read) is NOT `DISALLOWED` (read and
 * names the route); a transport failure may never become a verdict. Neither
 * refuses a public page; what stops a walk is an access control (a challenge,
 * a 401/403/429).
 */
export const PERMISSION_STATES = ["ALLOWED", "DISALLOWED", "CANNOT_TELL", "NOT_APPLICABLE"] as const;
export type PermissionState = (typeof PERMISSION_STATES)[number];

/**
 * What happened when we tried to RETRIEVE something — including the permission
 * document itself. Never a permission verdict.
 */
export const TRANSPORT_STATES = [
  "REACHABLE",
  "FAILED_AT_RUNG",
  "CHALLENGED",
  "TIMEOUT",
  "TLS_CLIENT_MISMATCH",
  "OTHER_NAMED_FAILURE",
] as const;
export type TransportState = (typeof TRANSPORT_STATES)[number];
