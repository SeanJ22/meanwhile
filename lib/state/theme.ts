export const THEME_STORAGE_KEY = "wtp.theme";
export type Theme = "light" | "dark";

/** An explicit Meanwhile choice wins; an unavailable system preference means light. */
export function resolveTheme(saved: unknown, systemDark: boolean | undefined): Theme {
  return saved === "light" || saved === "dark" ? saved : systemDark === true ? "dark" : "light";
}

/** Synchronous head script: the same policy runs before any reader markup can paint. */
export function themeBootstrapScript(allowReviewChoice: boolean): string {
  return `(()=>{let saved=null,systemDark;try{saved=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch{}${allowReviewChoice ? `try{const choice=new URLSearchParams(location.search).get("theme");if(choice==="light"||choice==="dark"){saved=choice;try{localStorage.setItem(${JSON.stringify(THEME_STORAGE_KEY)},choice)}catch{document.documentElement.setAttribute("data-theme-choice",choice)}}}catch{}` : ""}try{systemDark=matchMedia("(prefers-color-scheme: dark)").matches}catch{}const theme=(${resolveTheme.toString()})(saved,systemDark);document.documentElement.setAttribute("data-theme",theme);document.documentElement.style.colorScheme=theme})();`;
}
