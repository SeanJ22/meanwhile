import type { BodyPurpose } from "@/lib/map/body-purpose";

export function BodyPurposeLabel({ purpose }: { purpose: BodyPurpose | null | undefined }) {
  if (!purpose) return null;
  return (
    <a
      className="reader-body-purpose"
      data-body-purpose={purpose.label}
      data-purpose-source={purpose.basisUrl}
      href={purpose.basisUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={`${purpose.label}. ${purpose.description} Source: ${purpose.basis}`}
      title={`${purpose.description} Source: ${purpose.basis}`}
    >
      {purpose.label}
      <span aria-hidden="true">↗</span>
    </a>
  );
}
