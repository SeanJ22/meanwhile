/** Keep the existing anonymous, fixed-choice signal; only a stored row is success. */
export async function submitDemandSignal(
  subjectType: "BODY" | "CANDIDATE",
  subjectId: string,
  context: { lat?: number | null; lng?: number | null } = {},
): Promise<boolean> {
  try {
    const response = await fetch("/api/demand-signal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subjectType,
        subjectId,
        signal: "WANT_THIS_SOONER",
        ...(typeof context.lat === "number" && typeof context.lng === "number"
          ? { lat: context.lat, lng: context.lng } : {}),
      }),
    });
    return response.status === 204;
  } catch {
    return false;
  }
}
