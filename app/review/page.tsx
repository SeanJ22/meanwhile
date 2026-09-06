import { notFound } from "next/navigation";
import Link from "next/link";
import { ManifestReview } from "./manifest-review";

export const dynamic = "force-dynamic";

/** A reader-accessible view of the software manifest, under the same tester boundary. */
export default function ReviewPage() {
  if (process.env.WTP_BUILD_CONTEXT !== "branch-deploy" || process.env.WTP_BUILD_BRANCH !== "test") notFound();
  return (
    <main style={{ maxWidth: 840, margin: "0 auto", padding: "100px 24px 40px" }}>
      <h1>Staging software review</h1>
      <p>Build <code>{process.env.WTP_BUILD_COMMIT}</code></p>
      <p>Deploy <code>{process.env.WTP_BUILD_DEPLOY_ID}</code></p>
      <p><Link href="/">Open the staging reader</Link></p>
      <ManifestReview />
    </main>
  );
}
