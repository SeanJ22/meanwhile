/** The required contexts as data a bare Node can read before dependencies are installed. */

/** The contexts branch protection on `main` actually requires, as read back from the GitHub API; kept in step with the branch. */
export const REQUIRED_CONTEXTS: readonly string[] = [
  "build (default)",
  "build (standalone)",
  "gates (test · lint · tsc)",
];
