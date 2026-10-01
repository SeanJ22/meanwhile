/**
 * **THE CHAT'S OWN CONSTANTS.** Where a message is posted, where a question is
 * said to have come from, and the words at the top of the view. The command
 * center's Ask view and the route both import this, so the two cannot disagree.
 */

/** Where the operator chat lives: a view of the command center. */
export const CHAT_PAGE = "/admin?view=chat";

/** Where a message is posted. */
export const CHAT_ROUTE = "/api/admin/chat";

/** The heading, and the sentence under it that says what this is. */
export const CHAT_TITLE = "Ask the console";
export const CHAT_STANDFIRST =
  "Ask about the state of the system and get an answer built from the records themselves — " +
  "each one naming what it read, how many of what it counted, and whether it needs you.";
