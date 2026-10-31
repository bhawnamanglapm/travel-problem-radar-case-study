// Copies brand.css's color tokens into the pages that must stay self-contained (no external stylesheet,
// import or font URL: scripts/check.mjs). Edit brand.css, then run `npm run sync:brand`. Without the
// @import line, so these pages fall back to system fonts and ask no other site for anything.
import { readFileSync, writeFileSync } from "node:fs";

export const SELF_CONTAINED = [
  "about/index.html", "admin/index.html", "manage/index.html", "pricing/index.html", "signin/index.html",
  "signup/index.html", "subscribe/index.html", "trends/index.html",
  "legal/contact/index.html", "legal/privacy/index.html", "legal/refunds/index.html", "legal/terms/index.html",
];

const START = "<style>/* Brand tokens, copied from brand.css by scripts/sync-brand.mjs: edit brand.css, then run npm run sync:brand. */";
const END = "</style><!-- end brand tokens -->";

// The block a page must hold: brand.css without its comment header and @import.
export function brandBlock(css) {
  const body = css.replace(/^\/\*[\s\S]*?\*\/\s*/, "").replace(/^@import url\([^)]*\);\s*/m, "").trim();
  return `${START}\n${body}\n${END}`;
}

// Run directly (not imported by check.mjs): rewrite the pages.
if (/sync-brand\.mjs$/.test(process.argv[1] || "")) {
  const block = brandBlock(readFileSync("brand.css", "utf8"));
  for (const page of SELF_CONTAINED) {
    const s = readFileSync(page, "utf8");
    const at = s.indexOf(START);
    let out;
    if (at >= 0) out = s.slice(0, at) + block + s.slice(s.indexOf(END, at) + END.length);
    else if (/<link rel="stylesheet" href="[./]*brand\.css" \/>/.test(s)) out = s.replace(/<link rel="stylesheet" href="[./]*brand\.css" \/>/, () => block);
    else out = s.replace("<style>", () => `${block}\n<style>`);
    if (out !== s) writeFileSync(page, out);
    console.log(`${out !== s ? "updated" : "current"}  ${page}`);
  }
}
