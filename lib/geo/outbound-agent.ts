/**
 * The one place the outbound contact address is written, for every route and
 * hunt that identifies itself to a third party. Server-only.
 */
export const OUTBOUND_USER_AGENT =
  "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)";

/** The contact address alone, so a caller can compose its own product string. */
export const OUTBOUND_CONTACT = "seanj22@gmail.com";
