// Offline checks for the case study and demo. No network, no API key.
// Run from the repository root:  node scripts/check.mjs
import { existsSync, readFileSync } from "node:fs";

const failures = [];
const check = (ok, label) => {
  console.log((ok ? "PASS " : "FAIL ") + label);
  if (!ok) failures.push(label);
};

// 1. Sample data: the shape the dashboard's normalize() expects.
const CATS = ["traveler_pain", "gov_policy", "web_app", "industry"];
const FIELDS = ["cat", "title", "summary", "source", "link", "region", "date", "severity", "opportunity"];
const sample = JSON.parse(readFileSync("sampleData.json", "utf8"));
check(Array.isArray(sample) && sample.length === 8, `sampleData.json has 8 items (${sample.length})`);
const bad = sample.filter((p) =>
  FIELDS.some((f) => typeof p[f] !== "string" || !p[f].trim()) ||
  !CATS.includes(p.cat) ||
  !["Low", "Medium", "High"].includes(p.severity) ||
  !/^https:\/\//.test(p.link));
check(bad.length === 0, `every item has all fields, a known category and severity, and an https link (${bad.length} bad)`);
for (const c of CATS) {
  const n = sample.filter((p) => p.cat === c).length;
  check(n === 2, `category ${c} has 2 items (${n})`);
}
const titles = sample.map((p) => p.cat + ":" + p.title.toLowerCase());
check(new Set(titles).size === titles.length, "no duplicate titles within a category (the New flag keys on them)");

// 2. Case-study page: no dead buttons, and every local link points at a real file.
const page = readFileSync("index.html", "utf8");
check(!/href="#"/.test(page), 'index.html has no placeholder href="#" links');
const local = [...page.matchAll(/href="([^"#:]+)(#[^"]*)?"/g)].map((m) => m[1]);
const missing = local.filter((h) => !existsSync(h.endsWith("/") ? h + "index.html" : h));
check(local.length > 0 && missing.length === 0, `local links resolve (${local.join(", ")})${missing.length ? " missing: " + missing : ""}`);
// The owner confirmed the Slack connector and the daily trigger worked in Claude's app;
// email delivery was not confirmed. Neither is in this repo's code, and the page must say so.
check(!/Gmail/i.test(page), "no Gmail/email-delivery claim (not confirmed)");
check(!/Slack/.test(page) || /not in this repository&rsquo;s code/.test(page),
      "Slack delivery, if mentioned, is marked as set up in Claude's app, not this repo");

// 3. Demo: page loads the built bundle, and the bundle contains the sample.
const demo = readFileSync("demo/index.html", "utf8");
check(/<script src="radar.js"><\/script>/.test(demo), "demo/index.html loads radar.js");
const bundle = existsSync("demo/radar.js") ? readFileSync("demo/radar.js", "utf8") : "";
check(sample.every((p) => bundle.includes(p.link)), "demo/radar.js is built and includes every sample link");

// 4. Live page (Vercel): loads its bundle, and the bundle is built.
const livePage = readFileSync("live/index.html", "utf8");
check(/<script src="radar-live.js"><\/script>/.test(livePage), "live/index.html loads radar-live.js");
const liveBundle = existsSync("live/radar-live.js") ? readFileSync("live/radar-live.js", "utf8") : "";
check(liveBundle.includes("/api/data"), "live/radar-live.js is built and reads /api/data");

// 5. The server copy of the prompt and categories must match the Claude artifact.
const jsx = readFileSync("travel-problem-radar.jsx", "utf8");
const srv = readFileSync("api/_lib/radar.js", "utf8");
const squash = (t) => t.replace(/\s+/g, " ").trim();
const jsxPrompt = (jsx.match(/const prompt =\s*([\s\S]*?);\s*const res = await fetch/) || [])[1];
const srvPrompt = (srv.match(/return \(\s*([\s\S]*?)\s*\);\s*\}/) || [])[1];
check(!!jsxPrompt && !!srvPrompt && squash(jsxPrompt) === squash(srvPrompt), "server prompt matches the artifact's prompt");
const catText = (t) => [...t.matchAll(/label: "([^"]+)",\s*(?:color: "[^"]+",\s*)?desc:\s*"([^"]+)"/g)].map((m) => m[1] + "|" + m[2]).join("\n");
check(catText(jsx).split("\n").length === 4 && catText(jsx) === catText(srv), "server categories match the artifact's categories");

console.log(failures.length ? `\n${failures.length} failure(s)` : "\nAll checks passed.");
process.exit(failures.length ? 1 : 0);
