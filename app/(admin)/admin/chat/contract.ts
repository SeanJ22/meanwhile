/**
 * **THE CHAT SURFACE'S OWN CONSTANTS.** (ADM-C7.)
 *
 * The convention the release-review page set: a surface's paths and limits live
 * beside it in a `contract.ts` that both the page and its route import, so the
 * two cannot disagree about where a message is posted or what the page is
 * called.
 */

/** Where the operator chat lives. */
export const CHAT_PAGE = "/admin/chat";

/** Where a message is posted. */
export const CHAT_ROUTE = "/api/admin/chat";

/** The heading, and the sentence under it that says what this is. */
export const CHAT_TITLE = "Ask the console";
export const CHAT_STANDFIRST =
  "Ask about the state of the system and get an answer built from the records themselves — " +
  "each one naming what it read, how many of what it counted, and whether it needs you.";
