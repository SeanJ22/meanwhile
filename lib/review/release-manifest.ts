import { describeWriteContext, type WriteEnvironment } from "../db/write-guard.ts";
import { RAISED_STATE_CANDIDATES, REVIEW_CONTRACT_VERSION, REVIEW_SECTIONS, STAGING_OWNERSHIP, reviewUrl } from "./contract.ts";

export interface ReviewBuildIdentity {
  sha: string;
  branch: string;
  context: string;
  deployId: string;
  builtAt: string;
}

/** A boundary regression withdraws the milestone on the next uncached read. */
export function softwareReleaseManifest(identity: ReviewBuildIdentity, environment: WriteEnvironment, reportedAt: string) {
  const application = describeWriteContext(environment, "software review isolation measurement", "application");
  const controlPlane = describeWriteContext(environment, "software review isolation measurement", "control-plane");
  const identified = /^[a-f0-9]{40}$/.test(identity.sha) && identity.branch === "test" &&
    identity.context === "branch-deploy" && /^[a-f0-9]{24}$/.test(identity.deployId);
  const isolated = application.allowed && application.dbRole === "staging" &&
    controlPlane.allowed && controlPlane.dbRole === "staging";
  const stable = identified && isolated;
  return {
    contractVersion: REVIEW_CONTRACT_VERSION,
    kind: "SOFTWARE_VISUAL_REVIEW",
    sha: identity.sha,
    build: identity,
    reportedAt,
    stagingBoundary: stable ? "STABLE" : "INVALID",
    milestone: stable ? "STAGING_BOUNDARY_STABLE" : "STAGING_BOUNDARY_INVALID",
    prompt3Status: stable ? "VISUAL_WORK_IN_PROGRESS" : "BLOCKED_STAGING_BOUNDARY",
    reviewState: stable ? "VISUAL_WORK_IN_PROGRESS" : "BLOCKED",
    boundaryReason: !identified ? "BUILD_IDENTITY_UNPROVEN" : !isolated ? "MUTABLE_RESOURCE_ISOLATION_UNPROVEN" : null,
    isolation: { application: application.dbRole, controlPlane: controlPlane.dbRole, productionWritesAllowed: false },
    reviewSections: REVIEW_SECTIONS,
    raisedState: {
      status: "AWAITING_OWNER_CHOICE",
      candidates: RAISED_STATE_CANDIDATES.map(candidate => ({ ...candidate,
        url: reviewUrl({ zip: "85701", raisedState: candidate.id }),
        arizona: { dark: reviewUrl({ zip: "85701", raisedState: candidate.id, theme: "dark" }), light: reviewUrl({ zip: "85701", raisedState: candidate.id, theme: "light" }) },
        newJersey: { dark: reviewUrl({ zip: "07866", raisedState: candidate.id, theme: "dark" }), light: reviewUrl({ zip: "07866", raisedState: candidate.id, theme: "light" }) },
      })),
    },
    ownership: STAGING_OWNERSHIP,
    prompt4MayBeginInSeparateSession: stable,
  };
}
