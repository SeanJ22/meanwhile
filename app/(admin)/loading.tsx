import { Logo } from "@/components/brand/logo";

import { s } from "./_mw/legacy-styles";

export default function ConsoleLoading() {
  return (
    <main className={s.root} aria-busy="true">
      <header className={s.header}>
        <span className={s.brand}>
          <Logo variant="wordmark" size={20} decorative />
        </span>
      </header>
      <div className={s.container}>
        <p className={s.lede} role="status">
          Reading the records…
        </p>
        <p className={s.note}>
          The console is asking the control plane for the current state of things. Nothing is cached, so what arrives is what is true right now.
        </p>
      </div>
    </main>
  );
}
