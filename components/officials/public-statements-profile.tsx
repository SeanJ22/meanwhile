"use client";

import { useEffect, useState } from "react";
import type { PrlReaderProfile } from "@/lib/sources/prl/snapshot";
import { formatDateLong } from "@/lib/text/format-date";
import { CardSection } from "./card-section";
import styles from "./public-statements-profile.module.css";

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
      <div data-public-statements-profile={profile.subjectId}>
        <p className={styles.intro}>
          {profile.statementCount.toLocaleString("en-US")} statements classified. Each bar is an independent classification, so the shares can overlap.
        </p>
        <div className={styles.bars}>
          {profile.categories.map(category => {
            const roundedShare = Math.round(category.share);
            return (
              <div className={styles.barRow} key={category.id} title={category.explainer}>
                <div className={styles.barLabel}>
                  <span className={styles.barName}>{category.label}</span>
                  <span className={styles.barValue}>{category.share > 0 && category.share < 1 ? "<1%" : `${roundedShare}%`}</span>
                </div>
                <div
                  className={styles.track}
                  role="progressbar"
                  aria-label={`${category.label}: ${category.share.toFixed(1)} percent`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={category.share}
                >
                  <div className={styles.fill} style={{ width: `${category.share}%` }} />
                </div>
                <p className={styles.explainer}>{category.explainer}</p>
              </div>
            );
          })}
        </div>
        <p className={styles.source}>
          Measured {formatDateLong(profile.measuredAt)} · read {formatDateLong(profile.readAt.slice(0, 10))}.{" "}
          <a href={profile.attribution.url} target="_blank" rel="noreferrer">{profile.attribution.citation}</a>
          {" · "}<a href={profile.attribution.licenceUrl} target="_blank" rel="noreferrer">{profile.attribution.licence}</a>
        </p>
      </div>
  );
}
