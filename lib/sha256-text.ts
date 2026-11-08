const K = Uint32Array.from({ length: 64 }, (_, index) => {
  let candidate = 2, seen = 0;
  for (; ; candidate++) { let prime = true; for (let d = 2; d * d <= candidate; d++) if (candidate % d === 0) { prime = false; break; } if (prime && seen++ === index) break; }
  return Math.floor((candidate ** (1 / 3) % 1) * 2 ** 32);
});

/** SHA-256 of a short string, in plain JavaScript so a browser computes the digest the server's `node:crypto` would. Large inputs belong to `lib/sha256.ts`. */
export function sha256Text(text: string): string {
  const data = new TextEncoder().encode(text), padded = new Uint8Array((data.length + 72) & ~63);
  padded.set(data); padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(data.length / 0x20000000)); view.setUint32(padded.length - 4, data.length << 3);
  const h = Uint32Array.from([2, 3, 5, 7, 11, 13, 17, 19], prime => Math.floor((prime ** 0.5 % 1) * 2 ** 32)), w = new Uint32Array(64);
  const rotate = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 64; i++) w[i] = w[i - 16] + (rotate(w[i - 15], 7) ^ rotate(w[i - 15], 18) ^ (w[i - 15] >>> 3)) + w[i - 7] + (rotate(w[i - 2], 17) ^ rotate(w[i - 2], 19) ^ (w[i - 2] >>> 10));
    let [a, b, c, d, e, f, g, x] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = x + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i];
      const t2 = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
      x = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, x].forEach((value, i) => { h[i] += value; });
  }
  return [...h].map(word => word.toString(16).padStart(8, "0")).join("");
}
