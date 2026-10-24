// Offline checks for the case study and demo. No network, no API key.
// Run from the repository root:  node scripts/check.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

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

// 2. Home page (a customer product page): no dead buttons, and every local link points at a real file.
const page = readFileSync("index.html", "utf8");
check(!/href="#"/.test(page), 'index.html has no placeholder href="#" links');
check(/id="back"/.test(page) && /if \(!\/\\.github\\.io\$\/\.test\(location\.hostname\)\) document\.getElementById\("back"\)\.remove\(\);/.test(page),
  "index.html shows Back to portfolio only on the GitHub Pages copy");
const local = [...page.matchAll(/href="([^"#:]+)(#[^"]*)?"/g)].map((m) => m[1]).filter((h) => !h.startsWith("/api/")); // /api/ is served by functions
const missing = local.filter((h) => !existsSync(h.endsWith("/") ? h + "index.html" : h));
check(local.length > 0 && missing.length === 0, `local links resolve (${local.join(", ")})${missing.length ? " missing: " + missing : ""}`);
// The owner confirmed the Slack connector and the daily trigger worked in Claude's app;
// email delivery was not confirmed. Neither is in this repo's code, and the page must say so.
// The contact address is a Gmail address, so it's left out of this test.
check(!/Gmail/i.test(page.replaceAll("pehchanthetraveller19@gmail.com", "")), "no Gmail/email-delivery claim (not confirmed)");
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
// T17: with the board locked, 401 and 402 show a panel instead of an empty board.
check(liveBundle.includes("The board is for Pro members") && liveBundle.includes("The live board is part of Pro") && liveBundle.includes("../signin/") && liveBundle.includes("../manage/"),
  "live/radar-live.js has the locked-board panels (sign in, and Pro only)");

// 4b. Subscribe page (Vercel): the plans page. One sign-up form only, on /signup/ (4c3).
const subPage = existsSync("subscribe/index.html") ? readFileSync("subscribe/index.html", "utf8") : "";
check(subPage.length > 0 && !/<form|\/api\/subscribe/.test(subPage), "subscribe/index.html has no sign-up form of its own (the one form is on /signup/)");
check(/<a class="btn" href="\.\.\/signup\/">Create your account<\/a>/.test(subPage) && /href="\.\.\/signup\/\?pro=1"/.test(subPage), "subscribe/index.html links to the sign-up page, and to it with Pro ticked");
check(/Gathered by an AI model with web search\. Items are not verified/.test(subPage), "subscribe/index.html has the AI notice");
check(/Questions or a deletion request: email <a href="mailto:pehchanthetraveller19@gmail\.com">/.test(subPage) && !/will be added here/.test(subPage), "subscribe/index.html has a real contact address, not the placeholder");
check(subPage.length > 0 && !/<script[^>]*\ssrc=|<link[^>]*rel=["']?stylesheet|@import|url\(\s*["']?https?:/i.test(subPage), "subscribe/index.html is self-contained (no external script, stylesheet, import or font URL)");
const vercelJson = JSON.parse(readFileSync("vercel.json", "utf8"));
// The site build lives in package.json's build:site: Vercel caps vercel.json's buildCommand at 256 characters.
const siteBuild = JSON.parse(readFileSync("package.json", "utf8")).scripts["build:site"] || "";
check(vercelJson.buildCommand === "npm run build:site" && siteBuild.length > 0, "vercel.json's buildCommand runs package.json's build:site (Vercel allows 256 characters, too few for the list)");
check(/\bcp -r [^&]*\bsubscribe\b[^&]* public\//.test(siteBuild), "build:site copies subscribe into public/");

// 4c. Manage page (Vercel): self-contained, talks to /api/account, never leaks its token link.
const manPage = existsSync("manage/index.html") ? readFileSync("manage/index.html", "utf8") : "";
check(/fetch\("\/api\/account"/.test(manPage) && /action: "request-pro"/.test(manPage), "manage/index.html reads /api/account and posts the request-pro action");
check(/<meta name="referrer" content="no-referrer"/.test(manPage) && /<meta name="robots" content="noindex"/.test(manPage), "manage/index.html sends no Referer and is not indexed (its URL carries a token)");
// T14: the categories form posts set-cats, with one checkbox per category key.
const manBoxes = [...manPage.matchAll(/<input type="checkbox" value="([a-z_]+)"/g)].map((m) => m[1]);
check(/action: "set-cats"/.test(manPage) && JSON.stringify(manBoxes) === JSON.stringify(CATS), "manage/index.html posts set-cats and has one checkbox per category, in order");
check(!/\.innerHTML\s*=/.test(manPage), "manage/index.html writes server data with textContent only, never innerHTML");
check(manPage.length > 0 && !/<script[^>]*\ssrc=|<link[^>]*rel=["']?stylesheet|@import|url\(\s*["']?https?:/i.test(manPage), "manage/index.html is self-contained (no external script, stylesheet, import or font URL)");
check(/\bcp -r [^&]*\bmanage\b[^&]* public\//.test(siteBuild), "build:site copies manage into public/");
check(existsSync("api/account.js"), "api/account.js exists (the manage page's endpoint)");
check(/fetch\("\/api\/session"/.test(manPage) && /action: "signout"/.test(manPage), "manage/index.html has a Sign out button that posts to /api/session");
check(/action: "delete-account"/.test(manPage) && />Delete my account</.test(manPage) && /This can’t be undone/.test(manPage) && /action: "email-on"/.test(manPage),
  "manage/index.html has Delete my account (asked twice) and Turn emails back on (T17)");
// T32: the Emails a day card posts set-freq, with one radio button for each number, 1 to 5, in order.
const manFreq = [...manPage.matchAll(/<input type="radio" name="freq" value="(\d)"/g)].map((m) => m[1]);
check(/action: "set-freq"/.test(manPage) && manFreq.join() === "1,2,3,4,5" && /id="freqCard"/.test(manPage) && /sweepsPerDayMax/.test(manPage) && /"freqCard", "deleteCard"/.test(manPage),
  "manage/index.html has the Emails a day card: posts set-freq, radios 1 to 5, hides numbers above the cap, hidden after delete (T32)");
// T20: the one script loaded from elsewhere is Razorpay's Checkout, and only on the Upgrade click.
// Request Pro stays for while payments are off.
const manSrcs = [...manPage.matchAll(/\.src\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
check(/var CHECKOUT_JS = "https:\/\/checkout\.razorpay\.com\/v1\/checkout\.js";/.test(manPage) && manSrcs.length === 1 && manSrcs[0] === "CHECKOUT_JS"
  && /action: "checkout"/.test(manPage) && /action: "checkout-return"/.test(manPage) && /action: "cancel"/.test(manPage),
  "manage/index.html loads only Razorpay's Checkout script, and posts checkout, checkout-return and cancel (T20)");
check(/>Request Pro</.test(manPage) && />Upgrade to Pro</.test(manPage) && /a\.payments/.test(manPage) && !/\brzp_(test|live)_/.test(manPage) && !/prefill/.test(manPage),
  "manage/index.html keeps Request Pro for when payments are off, holds no Razorpay key and sends Checkout no address");
// The switch is set in Vercel's settings when T22 turns it on, never in the repo.
check(!JSON.stringify(vercelJson).includes("BOARD_PAYWALL"), "vercel.json does not set BOARD_PAYWALL");

// 4c2. Sign-in page (T16): self-contained, posts to /api/session, and is copied into the deployment.
const inPage = existsSync("signin/index.html") ? readFileSync("signin/index.html", "utf8") : "";
check(/fetch\("\/api\/session"/.test(inPage) && /action="\/api\/session"/.test(inPage) && /action: "request"/.test(inPage), "signin/index.html posts to /api/session (script and no-JavaScript form)");
check(/name="email"/.test(inPage) && /name="website"/.test(inPage), "signin/index.html has the email field and the website honeypot field");
check(!/\.innerHTML\s*=/.test(inPage), "signin/index.html never uses innerHTML");
check(inPage.length > 0 && !/<script[^>]*\ssrc=|<link[^>]*rel=["']?stylesheet|@import|url\(\s*["']?https?:/i.test(inPage), "signin/index.html is self-contained (no external script, stylesheet, import or font URL)");
check(/\bcp -r [^&]*\bsignin\b[^&]* public\//.test(siteBuild), "build:site copies signin into public/");
check(existsSync("api/session.js"), "api/session.js exists (sign-in and the login cookie)");
check(/href="\.\.\/signin\/"/.test(subPage), "subscribe/index.html links to the sign-in page");

// 4c3. Sign-up page: "Create your account", the same /api/subscribe as the subscribe page.
const upPage = existsSync("signup/index.html") ? readFileSync("signup/index.html", "utf8") : "";
check(/fetch\("\/api\/subscribe"/.test(upPage) && /action="\/api\/subscribe"/.test(upPage), "signup/index.html posts to /api/subscribe (script and no-JavaScript form)");
check(/name="email"/.test(upPage) && /name="website"/.test(upPage), "signup/index.html has the email field and the website honeypot field");
check(!/\.innerHTML\s*=/.test(upPage), "signup/index.html never uses innerHTML");
check(upPage.length > 0 && !/<script[^>]*\ssrc=|<link[^>]*rel=["']?stylesheet|@import|url\(\s*["']?https?:/i.test(upPage), "signup/index.html is self-contained (no external script, stylesheet, import or font URL)");
check(/\bcp -r [^&]*\bsignup\b[^&]* public\//.test(siteBuild), "build:site copies signup into public/");
check(/name="wantsPro"/.test(upPage) && /wantsPro: form\.wantsPro\.checked/.test(upPage) && /pro=1/.test(upPage), "signup/index.html has the \"I'd also like Pro\" box, sends it, and ticks it for ?pro=1");
check(/We store your email address, the dates you signed up and confirmed, and whether you asked for Pro/.test(upPage), "signup/index.html has the privacy note");
check(/Questions or a deletion request: email <a href="mailto:pehchanthetraveller19@gmail\.com">/.test(upPage) && /Gathered by an AI model with web search\. Items are not verified/.test(upPage), "signup/index.html has the contact address and the AI notice");
check(/includes the free daily summary/.test(upPage) && /Unsubscribing from it deletes the account/.test(upPage), "signup/index.html says the account includes the daily summary and how to delete it");
check(![page, subPage, upPage].some((s) => /everything found in the last 24 hours/i.test(s)), "home, subscribe and sign-up pages don't promise Free everything (it gets a summary, T18)");
check(/href="\.\.\/signin\/"/.test(upPage) && /href="\.\.\/signup\/"/.test(inPage), "signup and signin pages link to each other");
// /live and /demo without the trailing slash load their script from the site root (a 404): each page adds the slash.
const slashFix = 'if (!/(\\/|\\.html)$/.test(location.pathname)) location.replace(location.pathname + "/" + location.search + location.hash);';
check(livePage.includes(slashFix), "live/index.html adds the trailing slash (/live would load /radar-live.js, a 404)");
check(demo.includes(slashFix), "demo/index.html adds the trailing slash (/demo would load /radar.js, a 404)");
// "Continue with Google" (account-flows.md): hidden until /api/session?action=me says google:true.
for (const [f, t] of [["index.html", page], ["signin/index.html", inPage], ["signup/index.html", upPage]]) {
  check(/<div class="gwrap" hidden>\s*<p class="or">or continue with<\/p>\s*<a class="gbtn" id="\w+" href="\/api\/session\?action=google">/.test(t) && /b\.google/.test(t) && /New here\? You&rsquo;ll confirm before a free account is created\./.test(t),
    `${f} has a Continue with Google button, hidden until me says google:true, with the new-account note`);
  check(t.split('<div class="gwrap" hidden>').slice(0, -1).every((before) => /<\/form>(?![\s\S]*<form)/.test(before)),
    `${f}: each Google button comes after its email form, not before it`);
}
check((page.match(/<div class="gwrap" hidden>/g) || []).length === 2 && /\$\("upPro"\)\.checked \? "&pro=1"/.test(page), "index.html: the Google button on both tabs; the Create account tab takes its Pro box along");
check(/form\.wantsPro\.checked \? "&pro=1"/.test(upPage), "signup/index.html: Continue with Google takes the Pro box along");
check([inPage, upPage].every((t) => /If you continue with Google, we receive only your email address from it\./.test(t)), "signin and signup say Google gives us only the email address");
const privacyPage = readFileSync("legal/privacy/index.html", "utf8");
check(/if you continue with Google: only the email address/.test(privacyPage) && /<code>tpr_oauth<\/code>/.test(privacyPage) && /<b>Google<\/b>, only if you choose/.test(privacyPage),
  "legal/privacy: what Google gives us, the tpr_oauth cookie, and Google as a provider");
// T13: the Resend webhook, the firewall rule's 429, and Hobby's 12-function limit (no framework).
check(existsSync("api/resend-webhook.js"), "api/resend-webhook.js exists (bounces and complaints from Resend)");
check(/x\.status === 429/.test(upPage), "signup/index.html shows a message on 429 (the firewall rate limit)");
check(/Check your spam or junk folder/.test(readFileSync("api/_lib/subscription-handlers.js", "utf8")), "the sign-up reply tells people to check spam or junk (the new domain's confirmation email is often filtered)");
const fns = readdirSync("api").filter((f) => f.endsWith(".js"));
check(fns.length <= 12, `at most 12 functions in api/, Hobby's limit (${fns.length}: ${fns.join(", ")})`);
// Checkout and cancel are actions on /api/account (T20); the Razorpay webhook (T21) is the one payments function.
check(existsSync("api/razorpay-webhook.js"), "api/razorpay-webhook.js exists (subscription events from Razorpay)");
check(fns.length === 9, `9 functions in api/ after T21 (${fns.length})`);
for (const f of ["subscribe/index.html", "manage/index.html", "signin/index.html", "signup/index.html", "live/index.html", "pricing/index.html"]) {
  const t = existsSync(f) ? readFileSync(f, "utf8") : "";
  check(t.includes('if (/\\.github\\.io$/.test(location.hostname)) location.replace("https://travel-problem-radar.vercel.app" + location.pathname'), `${f} sends a GitHub Pages visit to the Vercel copy (Pages has no /api/)`);
}
// 4d. Policy pages (T15): drafts with marked gaps until the owner fills them; only then may the build ship them.
const LEGAL = ["privacy", "terms", "refunds", "contact"];
const buildCmd = siteBuild;
const shippedLegal = LEGAL.filter((s) => buildCmd.includes(`legal/${s}`)); // pages go live one at a time
const draftLegal = LEGAL.filter((s) => !shippedLegal.includes(s));
const legalShipped = shippedLegal.length > 0;
for (const slug of LEGAL) {
  const shipped = shippedLegal.includes(slug);
  const f = `legal/${slug}/index.html`;
  const t = existsSync(f) ? readFileSync(f, "utf8") : "";
  check(t.length > 0 && !/<script[^>]*\ssrc=|<link[^>]*rel=["']?stylesheet|@import|url\(\s*["']?https?:/i.test(t), `${f} exists and is self-contained`);
  check(t.includes('if (/\\.github\\.io$/.test(location.hostname)) location.replace("https://travel-problem-radar.vercel.app" + location.pathname'), `${f} sends a GitHub Pages visit to the Vercel copy`);
  if (shipped) check(t.includes('href="mailto:pehchanthetraveller19@gmail.com"') && shippedLegal.every((s) => t.includes(`href="../${s}/"`)) && draftLegal.every((s) => !t.includes(`href="../${s}/"`)), `${f} has the contact address and links only the policy pages that are live`);
  else check(t.includes('href="mailto:pehchanthetraveller19@gmail.com"') && LEGAL.every((s) => t.includes(`href="../${s}/"`)), `${f} has the contact address and links all four policy pages`);
  if (shipped) check(!/OWNER INPUT NEEDED|id="draft-notice"|name="robots" content="noindex"/.test(t), `${f} is in the build, so it has no gaps, draft notice or noindex left`);
}
// The owner's name, address and phone come from Vercel variables at build time (scripts/fill-legal.mjs), never the repo.
const { fill, SLOTS } = await import("./fill-legal.mjs");
const legalText = LEGAL.map((s) => (existsSync(`legal/${s}/index.html`) ? readFileSync(`legal/${s}/index.html`, "utf8") : "")).join("\n");
const slotsUsed = [...new Set([...legalText.matchAll(/\{\{(LEGAL_[A-Z_]+)\}\}/g)].map((m) => m[1]))]; // {{PRO_…}} slots are fill-plan's (4e)
check(SLOTS.every((s) => slotsUsed.includes(s)) && slotsUsed.every((s) => SLOTS.includes(s)), `the policy pages use exactly the build-time slots ${SLOTS.join(", ")} (${slotsUsed.join(", ")})`);
check(!/\b\d{10}\b|\+91/.test(legalText), "the policy pages hold no phone number (it comes from LEGAL_PHONE at build time)");
const filled = fill("{{LEGAL_NAME}} {{LEGAL_ADDRESS}}", { LEGAL_NAME: "A & <b>", LEGAL_ADDRESS: "1\n2" });
check(filled.out === "A &amp; &lt;b&gt; 1<br />2" && filled.missing.length === 0 && fill("{{LEGAL_PHONE}}", {}).missing[0] === "LEGAL_PHONE", "fill-legal escapes values, turns newlines into line breaks, and reports an unset variable");
if (legalShipped) check(/node scripts\/fill-legal\.mjs public/.test(buildCmd), "the build fills the policy pages from Vercel variables (scripts/fill-legal.mjs)");
if (shippedLegal.includes("privacy")) check([inPage, upPage].every((t) => t.includes('href="../legal/privacy/"')) && page.includes('href="https://travel-problem-radar.vercel.app/legal/privacy/"'), "the home, sign-in and sign-up pages link the privacy policy");
if (legalShipped) check(/^scripts\/\*$/m.test(readFileSync(".vercelignore", "utf8")) && /^!scripts\/fill-legal\.mjs$/m.test(readFileSync(".vercelignore", "utf8")), ".vercelignore keeps scripts/fill-legal.mjs, which the build runs");

// 4e. Plan facts (T23, T24): Pro's price, GST, refund rule and the rest live in plan.json and are filled in at
// build time by scripts/fill-plan.mjs. A page ships only once plan.json has every value it uses.
const fillPlan = await import("./fill-plan.mjs");
const plan = JSON.parse(readFileSync("plan.json", "utf8"));
const planErrs = fillPlan.planErrors(plan);
check(planErrs.length === 0, `plan.json is valid${planErrs.length ? " (" + planErrs.join("; ") + ")" : ""}`);
check(/node scripts\/fill-plan\.mjs public && node scripts\/fill-legal\.mjs public/.test(buildCmd), "the build fills plan.json's facts (fill-plan) before the policy pages' (fill-legal)");
check(/^!scripts\/fill-plan\.mjs$/m.test(readFileSync(".vercelignore", "utf8")), ".vercelignore keeps scripts/fill-plan.mjs, which the build runs");
const copied = ((buildCmd.match(/\bcp -r ([^&]*) public\/(?:\s|&|$)/) || [])[1] || "").split(/\s+/).filter(Boolean);
const pricingShipped = copied.includes("pricing");
const shippedPages = [...copied.flatMap((d) => (d.endsWith(".html") ? [d] : [`${d}/index.html`])), ...shippedLegal.map((s) => `legal/${s}/index.html`)].filter((f) => existsSync(f));
check(shippedPages.includes("index.html") && shippedPages.includes("manage/index.html"), `the shipped pages are worked out from the build command (${shippedPages.length})`);
// T32: the schedule is 1 to 5 sweeps a day, as Pro members choose. Nothing a visitor or subscriber reads may say the
// old fixed schedule. The prompt's "up to 5 objects" is items per category, not the schedule, and isn't matched.
const OLD_SCHEDULE = /(?<!1 to )5 times a day|every 5 hours|about 5 a day|up to 5 a day|after every sweep/i;
const oldSchedule = [...shippedPages, "travel-problem-radar.jsx", "live/radar-live.js", "demo/radar.js", "api/_lib/email.js", "api/_lib/subscription-handlers.js"]
  .filter((f) => existsSync(f) && OLD_SCHEDULE.test(readFileSync(f, "utf8")));
check(oldSchedule.length === 0, `no page, bundle or email says the old fixed schedule ("5 times a day", "every 5 hours", "after every sweep")${oldSchedule.length ? ": " + oldSchedule.join(", ") : ""}`);
const notReady = shippedPages.map((f) => [f, fillPlan.fill(readFileSync(f, "utf8"), plan).missing]).filter(([, m]) => m.length);
check(planErrs.length > 0 || notReady.length === 0, `every shipped page has plan.json values for the slots it uses${notReady.length ? " (" + notReady.map(([f, m]) => f + ": " + m.join(", ")).join("; ") + ")" : ""}`);
const pricePage = existsSync("pricing/index.html") ? readFileSync("pricing/index.html", "utf8") : "";
check(pricePage.length > 0 && !/<script[^>]*\ssrc=|<link[^>]*rel=["']?stylesheet|@import|url\(\s*["']?https?:/i.test(pricePage) && !/\.innerHTML\s*=/.test(pricePage), "pricing/index.html exists, is self-contained and never uses innerHTML");
check(/Gathered by an AI model with web search\. Items are not verified/.test(pricePage) && /aren&rsquo;t checked by a person/.test(pricePage) && /no uptime promise/.test(pricePage), "pricing/index.html has the AI notice and says what Pro doesn't promise (T23 B2)");
check(/fetch\("\/api\/session\?action=me"\)/.test(pricePage) && /a\.href = "\.\.\/manage\/"/.test(pricePage) && /id="getpro" href="\.\.\/signup\/\?pro=1"/.test(pricePage), "pricing/index.html: Get Pro goes to sign-up with Pro ticked, or to the account page when signed in");
check(/<th scope="col">Free<\/th><th scope="col">Pro<\/th>/.test(pricePage), "pricing/index.html shows Free and Pro side by side in one table (T23 B1, C1)");
// T23 rules a script can check, on every shipped page (and pricing, which ships once filled), in both versions.
const SAMPLE_PLAN = { ...plan, monthly: 299, gst: "GST included", trialDays: 0, refund: "Sample refund rule.", refundDays: 7, methods: ["cards"] }; // only for this check
const ruled = [...new Set([...shippedPages, "pricing/index.html", "about/index.html", "signup/index.html"])].filter((f) => existsSync(f));
for (const f of ruled) {
  const t = readFileSync(f, "utf8");
  const versions = [fillPlan.fill(t, { ...SAMPLE_PLAN, paid: false }).out, fillPlan.fill(t, { ...SAMPLE_PLAN, paid: true }).out];
  check(!/\bhurry\b|limited time|most popular|only \d+ left|\bcountdown\b/i.test(t), `${f}: no false urgency or popularity claims (T23 B3, B4)`);
  check(versions.every((v) => !/₹\s?[1-9]/.test(v) || /renews/i.test(v)), `${f}: a page that shows a price also says it renews (T23 A1, A2)`);
  check(t.split("<table").slice(1).every((tb) => /scope="(row|col)"/.test(tb.split("</table>")[0])), `${f}: every table has <th scope> headers (T23 C5)`);
  check(!/<input[^>]*(name="wantsPro"|id="upPro")[^>]*\schecked\b/.test(t), `${f}: the Pro box is never ticked in the page itself (T23 B6)`);
}
// T26: once Pro is paid, no page still calls it free or switched on by hand; the account page states the
// price, the renewal and the refund rule above the pay button; the live board's locked panels get the price.
const stillFree = ruled.filter((f) => /being tested|switched on by hand/i.test(fillPlan.fill(readFileSync(f, "utf8"), { ...SAMPLE_PLAN, paid: true }).out));
check(stillFree.length === 0, `with Pro paid, no page says Pro is free while being tested or switched on by hand (T26)${stillFree.length ? " (" + stillFree.join(", ") + ")" : ""}`);
const manPaid = fillPlan.fill(manPage, { ...SAMPLE_PLAN, paid: true }).out;
check(manPage.includes("{{PRO_PRICE}}, {{PRO_GST}}.</strong> Renews automatically every month until you cancel") && manPage.includes("<p>{{PRO_REFUND}}</p>")
  && />Pay with Razorpay</.test(manPaid) && !/id="req"/.test(manPaid) && /if \(req\) req\.addEventListener/.test(manPage),
  "manage/index.html, with Pro paid: price, GST, renewal and the refund rule above Pay with Razorpay, and no Request Pro (T26)");
check(manPage.includes('a.billing === "pending"') && manPage.includes('a.billing === "halted"') && /"payment_retrying"/.test(manPage) && /ondismiss/.test(manPage),
  "manage/index.html explains a failed renewal, offers no second checkout while Razorpay retries, and says when the payment window closes (T26)");
check(livePage.includes('<template data-when="paid"><meta name="tpr-pro-price" content="{{PRO_PRICE}}, {{PRO_GST}}. Renews automatically') && liveBundle.includes("tpr-pro-price") && liveBundle.includes("../pricing/"),
  "live: in a paid build the locked panels show Pro's price and renewal, and link /pricing/ (T26)");
check(!pricingShipped || !draftLegal.some((s) => pricePage.includes(`legal/${s}/`)), "pricing/index.html, once shipped, links no policy page the build doesn't ship");
// The policy pages take Pro's facts from plan.json too, so they say what /pricing/ says (T23 A1, A2, A4).
const termsPage = readFileSync("legal/terms/index.html", "utf8"), refundsPage = readFileSync("legal/refunds/index.html", "utf8");
check(termsPage.includes("{{PRO_PRICE}}, {{PRO_GST}}") && termsPage.includes("Renews automatically every month until you cancel"), "legal/terms takes Pro's price and GST from plan.json and says it renews");
check(refundsPage.includes("<p>{{PRO_REFUND}}</p>") && refundsPage.includes("{{PRO_REFUND_DAYS}}"), "legal/refunds takes the refund rule and its days from plan.json, the same text as /pricing/");

// 4f. About page and site footer (T25). Every shipped page ends with one footer: Home, About, Pricing, Contact, Terms,
// Privacy, Refunds, in that order, listing only the pages the build ships. Until /pricing/ and the contact page ship,
// Plans (/subscribe/) and the email address stand in for them. A draft lists all six, as it will once everything ships.
const SITE = "https://travel-problem-radar.vercel.app/";
const MAIL = "mailto:pehchanthetraveller19@gmail.com";
const aboutPage = existsSync("about/index.html") ? readFileSync("about/index.html", "utf8") : "";
const aboutShipped = copied.includes("about");
check(aboutPage.length > 0 && !/<script[^>]*\ssrc=|<link[^>]*rel=["']?stylesheet|@import|url\(\s*["']?https?:/i.test(aboutPage) && aboutPage.includes('if (/\\.github\\.io$/.test(location.hostname)) location.replace("https://travel-problem-radar.vercel.app"'), "about/index.html exists, is self-contained and sends a GitHub Pages visit to the Vercel copy");
check(/Gathered by an AI model with web search\. Items are not verified/.test(aboutPage) && /aren&rsquo;t checked by a person/.test(aboutPage) && !/\{\{/.test(aboutPage), "about/index.html has the AI notice and no build-time slot (the owner's name and address are on the contact page)");
if (aboutShipped) check(!/OWNER INPUT NEEDED/.test(aboutPage), "about/index.html is in the build, so it has no gaps left");
const ships = (p) => p === "" || (p.startsWith("legal/") ? shippedLegal.includes(p.split("/")[1]) : copied.includes(p.replace("/", "")));
const FOOT = [["Home", ""], ["About", "about/"], ["Pricing", "pricing/", "Plans subscribe/"], ["Contact", "legal/contact/", `Contact ${MAIL}`], ["Terms", "legal/terms/"], ["Privacy", "legal/privacy/"], ["Refunds", "legal/refunds/"]];
const footWanted = (all) => FOOT.flatMap(([label, p, standIn]) => (all || ships(p) ? [`${label} ${p}`] : standIn ? [standIn] : []));
// Where a link on page f goes, as a path from the site root ("legal/privacy/"); other links come back as they are.
const target = (f, h) => { if (h.startsWith("mailto:")) return h; const u = new URL(h, SITE + f); return u.origin + "/" === SITE ? u.pathname.slice(1) : h; };
const footPages = [...new Set([...shippedPages, "pricing/index.html", "about/index.html", ...LEGAL.map((s) => `legal/${s}/index.html`)])].filter((f) => existsSync(f));
for (const f of footPages) {
  const shipped = shippedPages.includes(f);
  const navs = [...readFileSync(f, "utf8").matchAll(/<nav class="site-foot" aria-label="Site">([\s\S]*?)<\/nav>/g)];
  const links = navs.length === 1 ? [...navs[0][1].matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[2], m[1]]) : [];
  const got = links.map(([l, h]) => `${l} ${target(f, h)}`).join(" · ");
  const want = footWanted(!shipped).join(" · ");
  check(got === want && (f !== "index.html" || links.every(([, h]) => h.startsWith(SITE) || h === MAIL)), `${f}: one site footer linking ${shipped ? "the pages that ship" : "all seven pages (it's a draft)"}, in order (${want}${got === want ? "" : "; found: " + (got || "none")})`);
}
// No shipped page links a page the build doesn't ship, in the version the build makes from today's plan.json.
const drafts = [...draftLegal.map((s) => `legal/${s}/`), ...(aboutShipped ? [] : ["about/"]), ...(pricingShipped ? [] : ["pricing/"])];
const draftLinks = shippedPages.flatMap((f) => [...fillPlan.fill(readFileSync(f, "utf8"), plan).out.matchAll(/href="([^"]+)"/g)].map((m) => `${f} → ${target(f, m[1])}`).filter((s) => drafts.some((d) => s.endsWith("→ " + d))));
check(draftLinks.length === 0, `no shipped page links a page the build doesn't ship (drafts: ${drafts.join(", ")})${draftLinks.length ? " (" + draftLinks.join("; ") + ")" : ""}`);

const subLinks = [...page.matchAll(/href="([^"]*subscribe[^"]*)"/g)].map((m) => m[1]);
check(subLinks.length > 0 && subLinks.every((h) => h.startsWith("https://travel-problem-radar.vercel.app/subscribe/")), `index.html links to the subscribe page, only by the absolute Vercel URL (GitHub Pages has no /api/)${subLinks.length ? " (" + subLinks.join(", ") + ")" : " (no link)"}`);
check(/<a href="\.\.\/subscribe\/">Plans<\/a>/.test(livePage), "live/index.html links to the subscribe page");
// Customer pages: the back link says Home (the home page is no longer a case study), and the board has no demo or repo links.
const backPages = ["live", "demo", "signup", "signin", "subscribe", "manage", "pricing", "about"];
check(backPages.every((d) => readFileSync(`${d}/index.html`, "utf8").includes("&larr; Home</a>")) && !backPages.some((d) => readFileSync(`${d}/index.html`, "utf8").includes("Case study")), "every sub-page's back link says Home, not Case study");
check(!/Sample demo|github\.com/.test(livePage), "live/index.html has no Sample demo or repo link");
// Account pages are findable: the home page links sign-in (absolute, as above); the board shows Sign in or Account.
check(/<a id="acct" class="btn sec small" href="https:\/\/travel-problem-radar\.vercel\.app\/signin\/" data-open="in">Sign in<\/a>/.test(page), "index.html links to the sign-in page by the absolute Vercel URL");
// Signed in, the home page mustn't keep offering "Create free account": the hero and plan buttons are relinked.
check(["heroCta", "heroNote", "freeBtn"].every((id) => page.includes(`id="${id}"`)) && (page.match(/id="proBtn"/g) || []).length === 2 && page.includes('setSignedIn(b.plan === "pro");'),
  "index.html relinks the hero and plan buttons once signed in (Your account / Open the live board / Your plan / Request Pro)");
// The home page's sign-up / sign-in dialog: the same posts as /signup/ and /signin/, shown while signed out.
check(/fetch\(url, \{ method: "POST"/.test(page) && /"\/api\/subscribe"/.test(page) && /action: "request"/.test(page) && /wantsPro: up\.wantsPro\.checked/.test(page),
  "index.html's dialog posts sign-up to /api/subscribe (with wantsPro) and sign-in to /api/session");
check(/<dialog id="dlg" aria-labelledby="dlg-h">/.test(page) && /fetch\("\/api\/session\?action=me"\)/.test(page) && (page.match(/name="website"/g) || []).length === 2,
  "index.html has the dialog, checks whether the visitor is signed in, and both forms keep the honeypot field");
check(!/\.innerHTML\s*=/.test(page), "index.html never uses innerHTML (findings are written with textContent)");
check(!/BHAWNA|Bhawna Mangla|More work|Product Manager|case study/i.test(page.replace(/<a class="back"[^>]*>[^<]*<\/a>/, "")),
  "index.html has no portfolio branding outside the Pages-only back link");
check(/Gathered by an AI model with web search\. Items are not verified/.test(page) && /mailto:pehchanthetraveller19@gmail\.com/.test(page), "index.html has the AI notice and the contact address");
check(/<a id="acct" href="\.\.\/signin\/">Sign in<\/a>/.test(livePage) && /fetch\("\/api\/session\?action=me"\)/.test(livePage) && /a\.href = "\.\.\/manage\/"/.test(livePage) && !/\.innerHTML\s*=/.test(livePage), "live/index.html links Sign in, and Account when signed in (no innerHTML)");
check(/\| \*\*Get it by email\*\* \| https:\/\/travel-problem-radar\.vercel\.app\/subscribe\/[ .]/.test(readFileSync("README.md", "utf8")), "README.md's top table links to the subscribe page");

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
// Razorpay (T19): a key id (rzp_test_… or rzp_live_…) isn't secret on its own, so a file fails only if
// it has one and also a line giving something named "secret" a value of 20 or more characters. The
// self-test's fixtures are built here so this file doesn't trip its own check.
const RZP_KEY = /\brzp_(test|live)_[A-Za-z0-9]{8,}/;
const RZP_SECRET_LINE = /secret\w*["'`]?\s*[:=]\s*["'`]?[A-Za-z0-9]{20,}/i;
const rzpLeak = (text) => RZP_KEY.test(text) && text.split("\n").some((l) => RZP_SECRET_LINE.test(l));
const rzpKey = "rzp_" + "live_" + "Ab12Cd34Ef56Gh";
const rzpSecret = "Zx9".repeat(8);
check(rzpLeak(`key_id = "${rzpKey}"\nkey_secret = "${rzpSecret}"`) && rzpLeak(`RAZORPAY_KEY_ID=${rzpKey}\nRAZORPAY_KEY_SECRET=${rzpSecret}`)
      && !rzpLeak(`key_id = "${rzpKey}"`) && !rzpLeak(`key_secret = "${rzpSecret}"`) && !rzpLeak("RAZORPAY_KEY_SECRET: keys start rzp_test_"),
      "the Razorpay secret pattern catches a key id with a secret, and not either alone");
const rzpLeaks = tracked.filter((f) => !/\.(png|jpe?g|gif|ico|zip)$/i.test(f) && existsSync(f) && rzpLeak(readFileSync(f, "utf8")));
check(rzpLeaks.length === 0, `no Razorpay key secrets in tracked files${rzpLeaks.length ? " (found in " + rzpLeaks.join(", ") + ")" : ""}`);

// 7. The PM case study (pm/) links stages to each other and to docs/ by relative path and #heading, so a renamed
// file or heading breaks it silently. Anchors follow GitHub's rule: lowercase, punctuation dropped, spaces to "-".
const mdFiles = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? mdFiles(join(d, e.name)) : e.name.endsWith(".md") ? [join(d, e.name)] : []);
const headingSlugs = (f) => new Set([...readFileSync(f, "utf8").matchAll(/^#{1,6}\s+(.*)$/gm)].map((m) =>
  m[1].trim().toLowerCase().replace(/[^\w\- ]/g, "").replace(/ /g, "-")));
const pmLinks = [], pmBroken = [];
for (const f of mdFiles("pm")) {
  for (const [, url] of readFileSync(f, "utf8").matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?|mailto):/.test(url)) continue;
    pmLinks.push(url);
    const [p, anchor] = url.split("#");
    const target = p ? resolve(dirname(f), decodeURIComponent(p)) : resolve(f);
    if (!existsSync(target)) pmBroken.push(`${relative(".", f)} → ${url} (no such file)`);
    else if (anchor && target.endsWith(".md") && !headingSlugs(target).has(anchor)) pmBroken.push(`${relative(".", f)} → ${url} (no such heading)`);
  }
}
check(pmLinks.length > 0 && pmBroken.length === 0,
  `pm/ relative links and #headings resolve (${pmLinks.length} links)${pmBroken.length ? ": " + pmBroken.join("; ") : ""}`);

console.log(failures.length ? `\n${failures.length} failure(s)` : "\nAll checks passed.");
process.exit(failures.length ? 1 : 0);
