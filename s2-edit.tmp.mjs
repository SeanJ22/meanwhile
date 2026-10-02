import fs from "node:fs";
const rep = (f, pairs) => { let s = fs.readFileSync(f, "utf8"); for (const [a, b] of pairs) { if (!s.includes(a)) throw new Error(f + " missing: " + a.slice(0, 70)); s = s.replace(a, () => b); } fs.writeFileSync(f, s); };
rep("components/ballot/jurisdiction-note.tsx", [[`        A zip code is a mail route, not a boundary — this one crosses several
        governments, and each of the contests marked{" "}
        <span aria-hidden="true" className="text-signal">
          {JURISDICTION_MARK}
        </span>{" "}
        below is decided by one of them rather than by all of you. We hold every
        one of these races in full; what we cannot tell from a zip code alone is
        which of them is yours.`, `        This zip crosses several governments. Each contest marked{" "}
        <span aria-hidden="true" className="text-signal">
          {JURISDICTION_MARK}
        </span>{" "}
        below is decided by one of them rather than by all of you.`]]);
rep("app/ballot/page.tsx", [[`      <p className="mt-3 text-[0.8125rem] leading-relaxed text-voice lg:max-w-2xl">
        A zip code is orientation, not your exact ballot — zip areas cross
        town and district lines. Everything below is presented as filed with
        election authorities, with the filing linked on every item.{" "}
        <span className="font-medium">We never suggest how to vote.</span>
      </p>
`, ``]]);
rep("tests/jurisdiction-note.test.ts", [[`  assert.match(
    note,
    /what we cannot tell from a zip code alone is\s*\n?\s*which of them is yours/,
    "the block no longer attributes the limit to the zip and to us",
  );`, `  assert.doesNotMatch(
    code,
    /not a boundary|what we cannot tell/,
    "rulings §10: no disclaimer sentence in the block",
  );
  assert.match(code, /This zip crosses several governments/);`]]);
