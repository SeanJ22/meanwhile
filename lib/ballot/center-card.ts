/**
 * Scroll an opened card to the middle of the screen once its layout stops moving
 * (height, page height and position unchanged for two frames). Layout changes
 * cancel smooth scrolling, so this jumps. A card taller than the screen lines its
 * top up 12px below the top edge. Returns a cancel function.
 */
export function centerWhenStable(card: HTMLElement): () => void {
  let frame = 0, last = "", steady = 0, frames = 0, stopped = false;
  const key = () => `${card.offsetHeight}|${document.documentElement.scrollHeight}|${Math.round(card.getBoundingClientRect().top + window.scrollY)}`;
  const place = () => {
    const top = card.getBoundingClientRect().top + window.scrollY, height = card.offsetHeight, view = window.innerHeight;
    const target = height + 24 >= view ? top - 12 : top - (view - height) / 2;
    window.scrollTo({ top: Math.max(0, target), behavior: "instant" });
  };
  const tick = () => {
    if (stopped) return;
    const now = key();
    steady = now === last ? steady + 1 : 0;
    last = now;
    if (steady >= 2 || ++frames > 90) return place();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(frame); };
}
