import { runtimeWriteEnvironment } from "@/lib/db/write-guard";
import { softwareReleaseManifest } from "@/lib/review/release-manifest";

/** Non-sensitive software identity only. No database access and no mutations. */
export function GET() {
  if (process.env.WTP_BUILD_CONTEXT !== "branch-deploy" || process.env.WTP_BUILD_BRANCH !== "test") {
    return new Response(null, { status: 404 });
  }
  const manifest = softwareReleaseManifest({
    sha: process.env.WTP_BUILD_COMMIT ?? "unknown",
    branch: process.env.WTP_BUILD_BRANCH ?? "unknown",
    context: process.env.WTP_BUILD_CONTEXT ?? "unknown",
    deployId: process.env.WTP_BUILD_DEPLOY_ID ?? "unknown",
    builtAt: process.env.WTP_BUILD_CREATED_AT ?? "unknown",
  }, runtimeWriteEnvironment(), new Date().toISOString());
  return Response.json(manifest, { headers: {
    "cache-control": "no-store, max-age=0",
    "x-robots-tag": "noindex, nofollow, noarchive",
  } });
}
