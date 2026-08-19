/** D25 hunt, rung 2 and 3: plain fetch, then the full browser header set. */
const UA =
  "we-the-people/1.0 (civic meeting aggregator; contact: seanj22@gmail.com)";
const BROWSER = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};
const PAT =
  /(call to the (public|audience))|public comment|public participation|public portion|comment period|address the (board|council|commission)|speaker('s)? card|three \(3\) minutes|3 minutes|minutes per speaker/gi;

const targets = process.argv.slice(2);
for (const url of targets) {
  for (const [rung, headers] of [
    ["2 plain", { "User-Agent": UA }],
    ["3 browser", BROWSER],
  ] as const) {
    try {
      const r = await fetch(url, { headers, redirect: "follow" });
      const body = r.ok ? await r.text() : "";
      const text = body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
      const hits = [...new Set((text.match(PAT) ?? []).map((h) => h.toLowerCase()))];
      console.log(
        `${url}\n  rung ${rung}: HTTP ${r.status} · ${body.length} bytes · hits ${hits.length ? hits.join(", ") : "NONE"}`,
      );
      if (r.ok) break;
    } catch (e) {
      console.log(`${url}\n  rung ${rung}: THREW ${(e as Error).message}`);
    }
  }
}
