// Offline checks for the case study and demo. No network, no API key.
// Run from the repository root:  node scripts/check.mjs
import { execFileSync } from "node:child_process";
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

// 4b. Subscribe page (Vercel): self-contained, posts to the API, and is copied into the deployment.
const subPage = existsSync("subscribe/index.html") ? readFileSync("subscribe/index.html", "utf8") : "";
check(/fetch\("\/api\/subscribe"/.test(subPage) && /action="\/api\/subscribe"/.test(subPage), "subscribe/index.html posts to /api/subscribe (script and no-JavaScript form)");
check(/name="email"/.test(subPage) && /name="website"/.test(subPage), "subscribe/index.html has the email field and the website honeypot field");
check(/We store your email address and the dates you subscribed and confirmed/.test(subPage) && /Unsubscribing deletes it/.test(subPage), "subscribe/index.html has the privacy note");
check(/Gathered by an AI model with web search\. Items are not verified/.test(subPage), "subscribe/index.html has the AI notice");
check(/Questions or a deletion request: email <a href="mailto:hello@pehchanthetraveller\.com">/.test(subPage) && !/will be added here/.test(subPage), "subscribe/index.html has a real contact address, not the placeholder");
check(subPage.length > 0 && !/<script[^>]*\ssrc=|<link[^>]*rel=["']?stylesheet|@import|url\(\s*["']?https?:/i.test(subPage), "subscribe/index.html is self-contained (no external script, stylesheet, import or font URL)");
const vercelJson = JSON.parse(readFileSync("vercel.json", "utf8"));
check(/\bcp -r [^&]*\bsubscribe\b[^&]* public\//.test(vercelJson.buildCommand || ""), "vercel.json's buildCommand copies subscribe into public/");
check(/name="wantsPro"/.test(subPage) && /wantsPro: form\.wantsPro\.checked/.test(subPage), "subscribe/index.html has the \"I'd also like Pro\" box and sends it");

// 4c. Manage page (Vercel): self-contained, talks to /api/account, never leaks its token link.
const manPage = existsSync("manage/index.html") ? readFileSync("manage/index.html", "utf8") : "";
check(/fetch\("\/api\/account"/.test(manPage) && /action: "request-pro"/.test(manPage), "manage/index.html reads /api/account and posts the request-pro action");
check(/<meta name="referrer" content="no-referrer"/.test(manPage) && /<meta name="robots" content="noindex"/.test(manPage), "manage/index.html sends no Referer and is not indexed (its URL carries a token)");
check(!/\.innerHTML\s*=/.test(manPage), "manage/index.html writes server data with textContent only, never innerHTML");
check(manPage.length > 0 && !/<script[^>]*\ssrc=|<link[^>]*rel=["']?stylesheet|@import|url\(\s*["']?https?:/i.test(manPage), "manage/index.html is self-contained (no external script, stylesheet, import or font URL)");
check(/\bcp -r [^&]*\bmanage\b[^&]* public\//.test(vercelJson.buildCommand || ""), "vercel.json's buildCommand copies manage into public/");
check(existsSync("api/account.js"), "api/account.js exists (the manage page's endpoint)");
const subLinks = [...page.matchAll(/href="([^"]*subscribe[^"]*)"/g)].map((m) => m[1]);
check(subLinks.every((h) => h.startsWith("https://travel-problem-radar.vercel.app/subscribe/")), `index.html links to the subscribe page only by the absolute Vercel URL${subLinks.length ? " (" + subLinks.join(", ") + ")" : " (no link yet)"}`);

// 5. The server copy of the prompt and categories must match the Claude artifact.
const jsx = readFileSync("travel-problem-radar.jsx", "utf8");
const srv = readFileSync("api/_lib/radar.js", "utf8");
const squash = (t) => t.replace(/\s+/g, " ").trim();
const jsxPrompt = (jsx.match(/const prompt =\s*([\s\S]*?);\s*const res = await fetch/) || [])[1];
const srvPrompt = (srv.match(/return \(\s*([\s\S]*?)\s*\);\s*\}/) || [])[1];
check(!!jsxPrompt && !!srvPrompt && squash(jsxPrompt) === squash(srvPrompt), "server prompt matches the artifact's prompt");
const catText = (t) => [...t.matchAll(/label: "([^"]+)",\s*(?:color: "[^"]+",\s*)?desc:\s*"([^"]+)"/g)].map((m) => m[1] + "|" + m[2]).join("\n");
check(catText(jsx).split("\n").length === 4 && catText(jsx) === catText(srv), "server categories match the artifact's categories");

// 6. No secrets in the repository: it is public. Keys and webhooks (Anthropic, Resend, Slack,
// Blob) live only in Vercel's environment variables; this catches the common formats if one is
// pasted into a tracked file.
let tracked = [];
try { tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean); } catch (e) {}
const SECRET = /sk-ant-[A-Za-z0-9_-]{10,}|\bre_[A-Za-z0-9]{6,}_[A-Za-z0-9]{16,}|hooks\.slack\.com\/services\/T[A-Za-z0-9]+|vercel_blob_rw_[A-Za-z0-9]+|xox[abprs]-[A-Za-z0-9-]{10,}|BEGIN [A-Z ]*PRIVATE KEY/;
const leaks = tracked.filter((f) => !/\.(png|jpe?g|gif|ico|zip)$/i.test(f) && existsSync(f) && SECRET.test(readFileSync(f, "utf8")));
check(tracked.length > 0 && leaks.length === 0,
      `no API keys, Slack webhooks, Blob tokens or private keys in tracked files${leaks.length ? " (found in " + leaks.join(", ") + ")" : ""}`);
check(!tracked.some((f) => /(^|\/)\.env/.test(f)), "no .env files are tracked");

console.log(failures.length ? `\n${failures.length} failure(s)` : "\nAll checks passed.");
process.exit(failures.length ? 1 : 0);
