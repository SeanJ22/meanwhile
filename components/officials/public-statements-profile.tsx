"use client";

import { useEffect, useState } from "react";
import type { PrlReaderProfile } from "@/lib/sources/prl/snapshot";
import { formatDateLong } from "@/lib/text/format-date";
import { CardSection } from "./card-section";

/** Shared map and ballot presentation; the source's measurement stays attributed. */
export function PublicStatementsProfile({ subjectId }: { subjectId: string }) {
  return <ProfileForIdentity key={subjectId} subjectId={subjectId} />;
}

function ProfileForIdentity({ subjectId }: { subjectId: string }) {
  const [profile, setProfile] = useState<PrlReaderProfile | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    if (!/^congress:[A-Z]\d{6}$/.test(subjectId)) return;
    const controller = new AbortController();
    void fetch(`/api/profile/${encodeURIComponent(subjectId)}`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(String(response.status)); return response.json() as Promise<{ profile: PrlReaderProfile | null }>; })
      .then(answer => { if (answer?.profile?.subjectId === subjectId) setProfile(answer.profile); })
      .catch(() => { if (!controller.signal.aborted) setLoadFailed(true); });
    return () => controller.abort();
  }, [subjectId]);
  if (loadFailed) return <CardSection title="Public statements"><p className="text-sm">We couldn’t check for a public-statements profile just now.</p></CardSection>;
  if (!profile) return null;
  return <CardSection title="Public statements"><PublicStatementsProfileContent profile={profile} /></CardSection>;
}

/** The same measured, attributed reader body for fetched UI and census render proof. */
export function PublicStatementsProfileContent({ profile }: { profile: PrlReaderProfile }) {
  return (
      <div className="space-y-3 text-sm">
        {profile.categories.map(category => <p key={category.id}>{category.sentence}</p>)}
        <p className="text-xs text-muted-foreground">
          Measured {formatDateLong(profile.measuredAt)}. Read {formatDateLong(profile.readAt.slice(0, 10))}.
        </p>
        <p className="break-words text-xs text-muted-foreground">
          <a className="underline underline-offset-2" href={profile.attribution.url} target="_blank" rel="noreferrer">{profile.attribution.citation}</a>
          {" · "}<a className="underline underline-offset-2" href={profile.attribution.licenceUrl} target="_blank" rel="noreferrer">{profile.attribution.licence}</a>
        </p>
      </div>
  );
}
