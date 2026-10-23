// Fills the owner's name, address and phone into the built policy pages, so they live in Vercel's
// environment variables and never in the public repo. Run by package.json's build:site (vercel.json runs it):
//   node scripts/fill-legal.mjs public
// Fails the build if a page still has a {{SLOT}} whose variable is unset, so a page never goes live half-filled.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SLOTS = ["LEGAL_NAME", "LEGAL_ADDRESS", "LEGAL_PHONE"];

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Returns the filled text and the slots that had no value. A newline in a value becomes a line break.
export function fill(text, env) {
  const missing = new Set();
  const out = text.replace(/\{\{([A-Z_]+)\}\}/g, (m, name) => {
    const v = SLOTS.includes(name) ? (env[name] || "").trim() : "";
    if (!v) { missing.add(name); return m; }
    return escapeHtml(v).replace(/\r?\n/g, "<br />");
  });
  return { out, missing: [...missing] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = join(process.argv[2] || "public", "legal");
  if (!existsSync(root)) { console.log("fill-legal: no legal/ in the build, nothing to fill"); process.exit(0); }
  const problems = [];
  for (const slug of readdirSync(root)) {
    const f = join(root, slug, "index.html");
    if (!existsSync(f)) continue;
    const { out, missing } = fill(readFileSync(f, "utf8"), process.env);
    writeFileSync(f, out);
    if (missing.length) problems.push(`${slug}: ${missing.join(", ")}`);
  }
  if (problems.length) { console.error(`fill-legal: unset variables (${problems.join("; ")})`); process.exit(1); }
  console.log("fill-legal: policy pages filled");
}
