const EARTH_RADIUS_KM = 6371.0088;

const toRadians = (deg: number) => (deg * Math.PI) / 180;

/**
 * Great-circle distance in kilometers.
 *
 * Good to a fraction of a percent at metro scale, which is all the radius
 * ladder needs. Anything that has to be exact belongs in PostGIS.
 */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
