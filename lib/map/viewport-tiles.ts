/** Tiles intersecting the cold ZIP viewport, including fractional zoom and world edges. */
export function viewportTiles(point: { lat: number; lng: number; width: number; height: number }, zoom: number, z: number) {
  const scale = 2 ** z, pixels = 512 * 2 ** (zoom - z);
  const lat = Math.max(-85.05112878, Math.min(85.05112878, point.lat)) * Math.PI / 180;
  const cx = (point.lng + 180) / 360 * scale, cy = (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * scale;
  const dx = Math.min(2048, Math.max(1, point.width)) / (2 * pixels), dy = Math.min(2048, Math.max(1, point.height)) / (2 * pixels);
  const tiles = new Map<string, { z: number; x: number; y: number }>();
  for (let x = Math.floor(cx - dx); x <= Math.floor(cx + dx); x++) {
    for (let y = Math.max(0, Math.floor(cy - dy)); y <= Math.min(scale - 1, Math.floor(cy + dy)); y++) {
      const tx = ((x % scale) + scale) % scale;
      tiles.set(`${tx}/${y}`, { z, x: tx, y });
    }
  }
  return [...tiles.values()];
}
