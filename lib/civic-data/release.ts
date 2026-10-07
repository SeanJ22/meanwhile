export const ZERO_RELEASE_EVENTS = Object.freeze({
  testSitePromotions: 0,
  gitDataCommits: 0,
  pullRequests: 0,
  githubActionsRuns: 0,
  netlifyDeploys: 0,
  nextBuilds: 0,
  fullSiteBrowserWalks: 0,
});

export type ZeroReleaseEvents = typeof ZERO_RELEASE_EVENTS;
