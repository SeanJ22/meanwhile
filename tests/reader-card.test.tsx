import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Card } from "../components/ui/card.tsx";

test("the shared frame names its card and always includes a Sources disclosure", () => {
  const html = renderToStaticMarkup(<Card title="Public record" eyebrow="Meeting" sources={[]}><p>Record content</p></Card>);
  assert.match(html, /aria-labelledby=/);
  assert.match(html, /Public record/);
  assert.match(html, /Record content/);
  assert.match(html, /data-card-sources=/);
  assert.match(html, /Sources/);
  assert.match(html, /aria-expanded="false"/);
});

test("identity can carry the visible name without losing the card's accessible title", () => {
  const html = renderToStaticMarkup(<Card title="Person" titleVisible={false} onClose={() => {}} sources={[]}><p>Identity</p></Card>);
  assert.match(html, /class="sr-only"/);
  assert.match(html, /aria-label="Close Person"/);
});
