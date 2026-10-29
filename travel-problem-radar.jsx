import { useState, useEffect, useRef } from "react";

/* ---------------------------------------------------------------------------
   TRAVEL PROBLEM RADAR
   A live opportunity-scouting dashboard. Sweeps global sources on demand,
   buckets problems into 4 categories, flags what's new since the last sweep,
   tags each with a product angle, and ARCHIVES every run by date so you can
   page back through past sweeps.

   Two ways to run it:
   - Live (default export, no props): inside Claude's artifact runtime, which
     supplies the Anthropic API access and window.storage. Each sweep is four
     real web-search calls.
   - Demo (<TravelProblemRadar sample={...} />): used by demo/ on GitHub Pages.
     A sweep replays the saved sample instead of calling any API, and history
     is kept in the visitor's localStorage.
--------------------------------------------------------------------------- */

const CSS = `
.tpr, .tpr * { box-sizing: border-box; }
/* Colors and fonts come from brand.css, which every page that loads this bundle links. */
.tpr {
  --accent-line:color-mix(in srgb, var(--accent) 55%, var(--line));
  background:var(--bg); color:var(--text); font-family:var(--body);
  min-height:100vh; width:100%; padding:22px clamp(14px,4vw,40px) 60px;
  -webkit-font-smoothing:antialiased;
}
.tpr a { color:inherit; }

/* ---- header / command bar ---- */
.tpr-top { display:flex; flex-wrap:wrap; align-items:flex-end; gap:16px 22px; margin-bottom:22px; }
.tpr-brand { display:flex; align-items:center; gap:14px; }
.tpr-radar-mini { position:relative; width:42px; height:42px; border-radius:50%;
  border:1px solid var(--line2); flex:none;
  background:radial-gradient(circle at center, color-mix(in srgb, var(--link) 12%, transparent), transparent 70%); overflow:hidden; }
.tpr-radar-mini::before { content:''; position:absolute; inset:0; border-radius:50%;
  background:conic-gradient(from 0deg, color-mix(in srgb, var(--accent) 60%, transparent), transparent 32%); }
.tpr-radar-mini.spin::before { animation:tpr-sweep 1.4s linear infinite; }
.tpr-radar-mini::after { content:''; position:absolute; left:50%; top:50%; width:3px; height:3px;
  margin:-1.5px; border-radius:50%; background:var(--accent); box-shadow:0 0 6px var(--accent); }
@keyframes tpr-sweep { to { transform:rotate(360deg); } }

.tpr-title { line-height:.9; }
.tpr-title h1 { font-family:var(--wordmark); font-weight:400; font-size:clamp(30px,5vw,44px);
  letter-spacing:.01em; margin:0; }
.tpr-title h1 span { color:var(--accent-text); }
.tpr-title p { margin:4px 0 0; font-size:12px; color:var(--muted); letter-spacing:.14em;
  text-transform:uppercase; font-family:var(--mono); }

.tpr-actions { margin-left:auto; display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.tpr-swept { font-family:var(--mono); font-size:11px; color:var(--faint); text-align:right; line-height:1.5; }
.tpr-swept b { color:var(--muted); font-weight:500; }

.tpr-sweep-btn { font-family:var(--body); font-size:15px; font-weight:600; letter-spacing:.01em;
  background:var(--primary); color:var(--on-primary); border:none; padding:11px 22px; border-radius:10px;
  cursor:pointer; display:inline-flex; align-items:center; gap:10px; transition:transform .12s ease, box-shadow .2s ease, background .15s ease;
  box-shadow:0 0 0 transparent; }
.tpr-sweep-btn:hover { background:var(--primary-hover); transform:translateY(-1px); box-shadow:0 6px 22px color-mix(in srgb, var(--primary) 25%, transparent); }
.tpr-sweep-btn:disabled { opacity:.55; cursor:default; transform:none; box-shadow:none; }
.tpr-sweep-btn .dot { width:8px; height:8px; border-radius:50%; background:var(--accent); }
.tpr-sweep-btn.busy .dot { animation:tpr-blink .9s ease-in-out infinite; }
@keyframes tpr-blink { 50% { opacity:.25; } }

/* ---- view tabs ---- */
.tpr-tabs { display:flex; gap:2px; background:var(--surface); border:1px solid var(--line);
  border-radius:9px; padding:3px; }
.tpr-tab { font-family:var(--mono); font-size:11px; letter-spacing:.1em; text-transform:uppercase;
  color:var(--muted); background:none; border:none; padding:7px 13px; border-radius:6px; cursor:pointer; }
.tpr-tab.on { background:var(--surface2); color:var(--text); }

/* ---- archived-sweep banner ---- */
.tpr-banner { display:flex; align-items:center; gap:12px; background:color-mix(in srgb, var(--accent) 10%, var(--surface));
  border:1px solid var(--accent-line); border-radius:10px; padding:10px 15px; margin-bottom:16px;
  font-size:13px; color:var(--text); }
.tpr-banner b { font-weight:600; }
.tpr-banner button { margin-left:auto; font-family:var(--mono); font-size:11px; letter-spacing:.06em;
  text-transform:uppercase; background:none; border:1px solid var(--accent-line); color:var(--accent-text);
  padding:6px 12px; border-radius:7px; cursor:pointer; white-space:nowrap; }
.tpr-banner button:hover { background:var(--accent); color:var(--on-accent); }

/* ---- stats strip ---- */
.tpr-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin-bottom:20px; }
.tpr-stat { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:13px 16px; }
.tpr-stat .n { font-family:var(--display); font-size:30px; font-weight:600; letter-spacing:-.02em; line-height:1; }
.tpr-stat .l { font-family:var(--mono); font-size:10px; letter-spacing:.13em; text-transform:uppercase;
  color:var(--muted); margin-top:6px; }
.tpr-stat.pink .n { color:var(--accent-text); }
.tpr-stat.lime .n { color:var(--link); }
.tpr-stat.amber .n { color:var(--high); }

/* ---- filters ---- */
.tpr-filters { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-bottom:20px; }
.tpr-chips { display:flex; flex-wrap:wrap; gap:7px; }
.tpr-chip { font-family:var(--mono); font-size:11px; letter-spacing:.05em; text-transform:uppercase;
  background:var(--surface); border:1px solid var(--line); color:var(--muted);
  padding:7px 13px; border-radius:20px; cursor:pointer; transition:.15s; white-space:nowrap; }
.tpr-chip:hover { border-color:var(--line2); color:var(--text); }
.tpr-chip.on { background:var(--primary); color:var(--on-primary); border-color:var(--primary); }
.tpr-chip .c { width:7px; height:7px; border-radius:50%; display:inline-block; margin-right:6px; vertical-align:middle; }
.tpr-chip .k { font-weight:600; margin-left:3px; }
.tpr-area-chips { flex-basis:100%; }

/* ---- area overview: one tile per area in the sweep (T37) ---- */
.tpr-areas { display:grid; grid-template-columns:repeat(auto-fill,minmax(128px,1fr)); gap:8px; margin-bottom:16px; }
.tpr-area { display:flex; flex-direction:column; align-items:flex-start; gap:4px; text-align:left; cursor:pointer;
  background:var(--surface); border:1px solid var(--line); color:var(--text); border-radius:12px; padding:10px 13px;
  font:inherit; transition:.15s; }
.tpr-area:hover { border-color:var(--line2); }
.tpr-area .n { font-family:var(--display); font-size:22px; font-weight:600; line-height:1; }
.tpr-area .l { font-family:var(--mono); font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); }
.tpr-area.on { background:var(--primary); border-color:var(--primary); color:var(--on-primary); }
.tpr-area.on .l { color:var(--on-primary); }
.tpr-search { margin-left:auto; background:var(--surface); border:1px solid var(--line); color:var(--text);
  font-family:var(--body); font-size:13px; padding:9px 13px; border-radius:9px; min-width:180px; }
.tpr-search::placeholder { color:var(--faint); }
.tpr-search:focus { outline:none; border-color:var(--link); box-shadow:0 0 0 2px color-mix(in srgb, var(--link) 30%, transparent); }

/* ---- board: one parent card per category, holding its problem cards ---- */
.tpr-groups { display:flex; flex-direction:column; gap:16px; }
.tpr-group { background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:14px; }
.tpr-group-head { display:flex; align-items:flex-start; gap:12px; flex-wrap:wrap; }
.tpr-group-head .dot { width:10px; height:10px; border-radius:50%; background:var(--cat); margin-top:6px; flex:none; }
.tpr-group-title { flex:1 1 220px; min-width:0; }
.tpr-group-title h2 { margin:0; font-family:var(--display); font-size:17px; font-weight:600; letter-spacing:-.01em; color:var(--text); }
.tpr-group-title p { margin:2px 0 0; font-size:12.5px; color:var(--muted); line-height:1.45; }
.tpr-group-count { font-family:var(--mono); font-size:11px; color:var(--muted); margin-top:4px; white-space:nowrap; }
.tpr-group-toggle { background:none; border:1px solid var(--line); color:var(--text); font-family:var(--body);
  font-size:12.5px; font-weight:500; padding:6px 12px; border-radius:8px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; }
.tpr-group-toggle:hover { border-color:var(--link); color:var(--link); }
.tpr-group-toggle:focus-visible { outline:2px solid var(--link); outline-offset:2px; }
.tpr-group-toggle .chev { display:inline-block; transition:transform .15s ease; }
.tpr-group-toggle[aria-expanded="false"] .chev { transform:rotate(-90deg); }
.tpr-group .tpr-board { margin-top:14px; }
.tpr-group .tpr-board[hidden] { display:none; }
.tpr-group .tpr-card { background:var(--surface2); box-shadow:inset 3px 0 0 var(--cat); padding-left:19px; }
.tpr-board { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr)); gap:14px; }
.tpr-card { background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:16px 17px 15px;
  display:flex; flex-direction:column; gap:10px; position:relative; overflow:hidden;
  animation:tpr-rise .35s ease both; }
@keyframes tpr-rise { from { opacity:0; transform:translateY(8px); } }
.tpr-card:hover { border-color:var(--line2); }
.tpr-card-top { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.tpr-sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
.tpr-new { font-family:var(--mono); font-size:9px; letter-spacing:.14em; text-transform:uppercase;
  background:var(--accent); color:var(--on-accent); padding:3px 7px 2px; border-radius:5px; font-weight:600; }
.tpr-card h3 { margin:0; font-size:15px; font-weight:600; line-height:1.28; letter-spacing:-.01em; }
.tpr-summary { margin:0; font-size:13px; color:var(--muted); line-height:1.5; }
.tpr-meta { display:flex; flex-wrap:wrap; gap:6px; }
.tpr-tag { font-family:var(--mono); font-size:10px; color:var(--muted); background:var(--bg2);
  border:1px solid var(--line); padding:3px 8px; border-radius:6px; }
.tpr-src { text-decoration:none; cursor:pointer; transition:.15s; }
.tpr-src:hover { color:var(--link); border-color:var(--link); }
.tpr-sev { font-weight:500; }
.tpr-sev.High { color:var(--high); border-color:color-mix(in srgb, var(--high) 45%, var(--line)); }
.tpr-sev.Medium { color:var(--medium); border-color:color-mix(in srgb, var(--medium) 45%, var(--line)); }
.tpr-sev.Low { color:var(--muted); }
.tpr-opp { margin-top:2px; border-left:2px solid var(--link); padding:2px 0 2px 11px; }
.tpr-opp .lab { font-family:var(--mono); font-size:10px; font-weight:500; letter-spacing:.12em; text-transform:uppercase; color:var(--link); display:block; }
.tpr-opp p { margin:3px 0 0; font-size:12.5px; color:var(--text-2); line-height:1.45; }

/* ---- report ---- */
.tpr-report { background:var(--surface); border:1px solid var(--line); border-radius:14px; overflow:hidden; }
.tpr-report-bar { display:flex; align-items:center; justify-content:space-between; gap:12px;
  padding:13px 16px; border-bottom:1px solid var(--line); }
.tpr-report-bar h2 { font-family:var(--display); font-weight:600; font-size:18px; letter-spacing:-.01em; margin:0; }
.tpr-copy { font-family:var(--mono); font-size:11px; letter-spacing:.08em; text-transform:uppercase;
  background:var(--surface2); border:1px solid var(--line2); color:var(--text); padding:8px 14px;
  border-radius:8px; cursor:pointer; }
.tpr-copy:hover { border-color:var(--link); color:var(--link); }
.tpr-report pre { margin:0; padding:18px 16px; font-family:var(--mono); font-size:12px; line-height:1.7;
  color:var(--text); white-space:pre-wrap; word-break:break-word; max-height:62vh; overflow:auto; }

/* ---- history ---- */
.tpr-hist { display:flex; flex-direction:column; gap:20px; }
.tpr-hist-day h4 { font-family:var(--display); font-weight:600; font-size:16px; letter-spacing:-.01em;
  margin:0 0 9px; color:var(--muted); }
.tpr-hrow { display:flex; align-items:center; gap:13px; background:var(--surface); border:1px solid var(--line);
  border-radius:11px; padding:12px 15px; margin-bottom:8px; flex-wrap:wrap; }
.tpr-hrow.cur { border-color:var(--link); }
.tpr-htime { font-family:var(--mono); font-size:12.5px; color:var(--text); min-width:74px; }
.tpr-hcounts { display:flex; gap:7px; flex-wrap:wrap; }
.tpr-hc { font-family:var(--mono); font-size:10px; letter-spacing:.06em; text-transform:uppercase;
  color:var(--muted); background:var(--bg2); border:1px solid var(--line); padding:3px 8px; border-radius:6px; }
.tpr-hc.new { color:var(--accent-text); border-color:var(--accent-line); }
.tpr-hc.high { color:var(--high); }
.tpr-hview { margin-left:auto; font-family:var(--mono); font-size:11px; letter-spacing:.08em; text-transform:uppercase;
  background:var(--surface2); border:1px solid var(--line2); color:var(--text); padding:7px 13px; border-radius:8px; cursor:pointer; }
.tpr-hview:hover { border-color:var(--link); color:var(--link); }
.tpr-hview.cur { background:var(--primary); color:var(--on-primary); border-color:var(--primary); cursor:default; }

/* ---- empty / status ---- */
.tpr-empty { text-align:center; padding:60px 20px; }
.tpr-radar-big { width:120px; height:120px; margin:0 auto 26px; position:relative; border-radius:50%;
  border:1px solid var(--line2);
  background:
    radial-gradient(circle, transparent 0 30%, color-mix(in srgb, var(--link) 18%, transparent) 30% 31%, transparent 31%),
    radial-gradient(circle, transparent 0 60%, color-mix(in srgb, var(--link) 18%, transparent) 60% 61%, transparent 61%),
    radial-gradient(circle at center, color-mix(in srgb, var(--link) 8%, transparent), transparent 72%);
  overflow:hidden; }
.tpr-radar-big::before { content:''; position:absolute; inset:0; border-radius:50%;
  background:conic-gradient(from 0deg, color-mix(in srgb, var(--accent) 55%, transparent), transparent 30%); animation:tpr-sweep 3s linear infinite; }
.tpr-radar-big.spin::before { animation:tpr-sweep 1.3s linear infinite; }
.tpr-empty h2 { font-family:var(--display); font-weight:600; font-size:24px; letter-spacing:-.01em; margin:0 0 8px; }
.tpr-empty p { color:var(--muted); font-size:14px; max-width:400px; margin:0 auto; line-height:1.6; }
.tpr-empty p + p { margin-top:14px; }
.tpr-locked-actions { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; }
.tpr-locked-actions .tpr-hview { margin-left:0; text-decoration:none; }
.tpr-locked-actions .tpr-hview.cur { cursor:pointer; }

.tpr-progress { display:flex; flex-direction:column; gap:9px; max-width:360px; margin:26px auto 0; }
.tpr-prow { display:flex; align-items:center; gap:11px; font-family:var(--mono); font-size:11px;
  letter-spacing:.05em; text-transform:uppercase; color:var(--muted); }
.tpr-prow .ic { width:14px; height:14px; border-radius:50%; border:1.5px solid var(--line2); flex:none; }
.tpr-prow.run .ic { border-color:var(--link); border-top-color:transparent; animation:tpr-sweep .7s linear infinite; }
.tpr-prow.done .ic { border-color:var(--link); background:var(--link); }
.tpr-prow.err .ic { border-color:var(--accent); background:var(--accent); }
.tpr-prow.done, .tpr-prow.done .cnt { color:var(--text); }
.tpr-prow .cnt { margin-left:auto; color:var(--faint); }

.tpr-note { font-family:var(--mono); font-size:10.5px; color:var(--faint); letter-spacing:.03em;
  margin-top:24px; text-align:center; }

/* ---- detail panel (T36): a side panel, a bottom sheet on phones ---- */
.tpr-seen { color:var(--text-2); }
.tpr-more { align-self:flex-start; margin-top:auto; background:none; border:1px solid var(--line2); color:var(--text);
  font-family:var(--body); font-size:12.5px; font-weight:500; padding:6px 12px; border-radius:8px; cursor:pointer; }
.tpr-more:hover, .tpr-dlg-x:hover { border-color:var(--link); color:var(--link); }
.tpr-more:focus-visible, .tpr-dlg-x:focus-visible, .tpr-dlg .tpr-hview:focus-visible { outline:2px solid var(--link); outline-offset:2px; }
.tpr-dlg { border:0; border-left:1px solid var(--line2); padding:0; margin:0 0 0 auto; width:min(440px,100%); max-width:100%;
  height:100%; max-height:100%; background:var(--surface); color:var(--text); font-family:var(--body); overflow:auto; }
.tpr-dlg::backdrop { background:rgba(0,0,0,.65); }
.tpr-dlg-in { min-height:100%; padding:18px 20px 26px; display:flex; flex-direction:column; gap:12px; }
.tpr-dlg-top { display:flex; align-items:center; gap:10px; }
.tpr-dlg-cat { font-family:var(--mono); font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted);
  display:inline-flex; align-items:center; gap:6px; }
.tpr-dlg-cat::before { content:''; width:8px; height:8px; border-radius:50%; background:var(--cat); }
.tpr-dlg-x { margin-left:auto; background:none; border:1px solid var(--line); color:var(--text); font-size:20px; line-height:1;
  width:34px; height:34px; border-radius:8px; cursor:pointer; flex:none; }
.tpr-dlg h2 { margin:0; font-family:var(--display); font-size:19px; font-weight:600; line-height:1.28; letter-spacing:-.01em; }
.tpr-dlg-hist { border-top:1px solid var(--line); padding-top:12px; margin-top:4px; }
.tpr-dlg-hist h3 { margin:0 0 6px; font-family:var(--mono); font-size:10px; font-weight:500; letter-spacing:.12em;
  text-transform:uppercase; color:var(--muted); }
.tpr-dlg-hist p, .tpr-dlg-none { margin:0; font-size:13px; color:var(--text-2); line-height:1.5; }
.tpr-dlg-hist ul { list-style:none; margin:10px 0 0; padding:0; display:flex; flex-direction:column; gap:6px; }
.tpr-dlg-hist li { display:flex; align-items:center; gap:10px; font-family:var(--mono); font-size:12px; color:var(--text);
  background:var(--bg2); border:1px solid var(--line); border-radius:9px; padding:7px 10px; }
.tpr-dlg-gone { margin-left:auto; font-size:10.5px; color:var(--muted); }
@media (max-width:640px){
  .tpr-dlg { top:auto; bottom:0; margin:0; width:100%; height:auto; max-height:88vh; border-left:0; border-top:1px solid var(--line2);
    border-radius:16px 16px 0 0; }
}

@media (max-width:560px){
  .tpr-actions { width:100%; }
  .tpr-swept { text-align:left; }
  .tpr-search { margin-left:0; width:100%; }
}
@media (prefers-reduced-motion:reduce){
  .tpr *, .tpr *::before, .tpr *::after { animation:none !important; }
}
`;

const CATS = [
  { key: "traveler_pain", label: "Traveler pain", color: "var(--cat-traveler)",
    desc: "recurring frustrations travelers report — booking, airlines, hotels, refunds, loyalty, service failures" },
  { key: "gov_policy", label: "Gov & policy", color: "var(--cat-gov)",
    desc: "new visa rules, entry requirements, travel bans, tourist taxes, and regulations affecting travelers" },
  { key: "web_app", label: "Website & app", color: "var(--cat-web)",
    desc: "outages, bugs, broken flows, UX failures, and data/security issues on travel platforms and OTAs" },
  { key: "industry", label: "Industry", color: "var(--cat-industry)",
    desc: "strikes, bankruptcies, capacity cuts, overtourism, pricing shocks, and major operational disruptions" },
];
const SEV_RANK = { High: 3, Medium: 2, Low: 1 };

// Areas (T37): a fixed list the board filters by, and areaOf() to place the AI's free-text region in one.
// The same text is in travel-problem-radar.jsx and api/_lib/radar.js; scripts/check.mjs fails if they differ.
const AREAS = ["Global", "Asia", "Europe", "North America", "Latin America", "Middle East & Africa", "Oceania", "Other"];
const AREA_NAMES = {
  Global: "global|globally|worldwide|world|international|multinational|multiple|various|online|multiple countries|multiple regions|several countries|many countries",
  Asia: "asia|south asia|southeast asia|south east asia|east asia|central asia|asia pacific|apac|asean|afghanistan|armenia|azerbaijan|bangladesh|bhutan|brunei|cambodia|china|mainland china|hong kong|macau|macao|india|indonesia|japan|kazakhstan|kyrgyzstan|laos|malaysia|maldives|mongolia|myanmar|burma|nepal|north korea|south korea|korea|pakistan|philippines|singapore|sri lanka|taiwan|tajikistan|thailand|timor leste|east timor|turkmenistan|uzbekistan|vietnam|viet nam|bali|tokyo|kyoto|osaka|seoul|beijing|shanghai|bangkok|phuket|delhi|new delhi|mumbai|goa|kathmandu|manila|jakarta|kuala lumpur|hanoi|ho chi minh city",
  Europe: "europe|eu|european union|schengen|schengen area|western europe|eastern europe|southern europe|northern europe|central europe|scandinavia|nordics|nordic countries|balkans|mediterranean|albania|andorra|austria|belarus|belgium|bosnia|herzegovina|bulgaria|croatia|cyprus|czech republic|czechia|denmark|estonia|finland|france|germany|greece|hungary|iceland|ireland|italy|kosovo|latvia|liechtenstein|lithuania|luxembourg|malta|moldova|monaco|montenegro|netherlands|holland|north macedonia|macedonia|norway|poland|portugal|romania|russia|san marino|serbia|slovakia|slovenia|spain|sweden|switzerland|turkey|turkiye|ukraine|united kingdom|uk|great britain|britain|england|scotland|wales|northern ireland|vatican|vatican city|london|paris|rome|venice|florence|milan|barcelona|madrid|lisbon|amsterdam|berlin|munich|vienna|prague|budapest|athens|santorini|istanbul|dublin|edinburgh|copenhagen|stockholm|oslo|reykjavik|zurich|geneva|brussels|mallorca|majorca|ibiza|canary islands|tenerife",
  "North America": "north america|america|united states|united states of america|us|usa|canada|greenland|bermuda|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|washington dc|nyc|los angeles|san francisco|las vegas|chicago|boston|miami|orlando|seattle|honolulu|ontario|quebec|british columbia|alberta|toronto|vancouver|montreal",
  "Latin America": "latin america|latam|south america|central america|caribbean|west indies|mexico|guatemala|belize|honduras|el salvador|nicaragua|costa rica|panama|cuba|jamaica|haiti|dominican republic|puerto rico|bahamas|barbados|trinidad|tobago|aruba|curacao|st lucia|saint lucia|colombia|venezuela|ecuador|galapagos|peru|bolivia|brazil|paraguay|uruguay|argentina|chile|guyana|suriname|patagonia|cancun|tulum|mexico city|rio de janeiro|sao paulo|buenos aires|cusco|machu picchu",
  "Middle East & Africa": "middle east|mena|gcc|gulf states|persian gulf|gulf region|africa|north africa|sub saharan africa|east africa|west africa|southern africa|central africa|bahrain|iran|iraq|israel|jordan|kuwait|lebanon|oman|palestine|gaza|west bank|qatar|saudi arabia|saudi|syria|uae|united arab emirates|yemen|dubai|abu dhabi|doha|riyadh|jeddah|tel aviv|jerusalem|egypt|cairo|morocco|marrakech|algeria|tunisia|libya|sudan|south sudan|ethiopia|kenya|nairobi|tanzania|zanzibar|uganda|rwanda|nigeria|lagos|ghana|senegal|south africa|cape town|johannesburg|namibia|botswana|zimbabwe|zambia|mozambique|madagascar|mauritius|seychelles|cameroon|ivory coast|cote divoire|angola|congo|drc|mali|niger|chad|somalia|eritrea|djibouti|benin|togo|burkina faso|guinea|sierra leone|liberia|gambia|gabon|malawi|lesotho|eswatini|cape verde|cabo verde",
  Oceania: "oceania|australasia|pacific islands|south pacific|australia|new zealand|fiji|papua new guinea|papua|samoa|tonga|vanuatu|solomon islands|tahiti|french polynesia|guam|sydney|melbourne|brisbane|perth|queensland|new south wales|tasmania|auckland",
};
let areaTable = null;
function areaOf(region) {
  if (!areaTable) {
    areaTable = new Map();
    for (const [area, names] of Object.entries(AREA_NAMES)) for (const n of names.split("|")) areaTable.set(n, area);
  }
  const text = String(region || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[.'\u2019]/g, "");
  if (!/[a-z0-9]/.test(text)) return "Global";
  const scan = (t) => {
    const found = new Set();
    for (const raw of t.split(/[,;\/&+()]|\band\b|\bor\b/)) {
      const part = raw.replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");
      if (!part) continue;
      if (areaTable.has(part)) { found.add(areaTable.get(part)); continue; }
      // Words inside the text, longest name first: "southern spain", "new south wales", "rural japan".
      const w = part.split(" ");
      for (let i = 0; i < w.length; i++) {
        for (let n = 3; n >= 1; n--) {
          const a = i + n <= w.length && areaTable.get(w.slice(i, i + n).join(" "));
          if (a) { found.add(a); i += n - 1; break; }
        }
      }
    }
    return found;
  };
  // Text in brackets qualifies the rest ("Mali (US citizens affected)"), so it counts only when the rest names nothing.
  let found = scan(text.replace(/\([^)]*\)/g, " "));
  if (!found.size) found = scan(text);
  // Text that names two or more areas ("US and Europe") spans them, so it counts as Global.
  return found.size === 1 ? [...found][0] : found.size ? "Global" : "Other";
}
// End of areas.

const slug = (s = "") =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

function extractProblems(data) {
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  if (!text) throw new Error("empty");
  let s = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = s.indexOf("["), b = s.lastIndexOf("]");
  if (a === -1) throw new Error("no json");
  s = b > a ? s.slice(a, b + 1) : s.slice(a);
  try { return JSON.parse(s); }
  catch (e) {
    const last = s.lastIndexOf("}");
    if (last > 0) { try { return JSON.parse(s.slice(0, last + 1) + "]"); } catch (_) {} }
    throw e;
  }
}

async function scanCategory(cat) {
  const prompt =
    `You are a travel-industry problem scout. Using web search, find the most recent, real, notable ` +
    `problems, complaints, breakages, disruptions, or newly announced changes in this area: ` +
    `"${cat.label}" (${cat.desc}). Focus on roughly the last 60 days, from sources anywhere in the world. ` +
    `Return ONLY a JSON array (no prose, no markdown fences) of up to 5 objects with EXACTLY these string ` +
    `fields: "title" (short, specific), "summary" (max 22 words, what the problem is), "source" ` +
    `(publication or site name), "link" (the direct source URL you found it at, starting with https://), ` +
    `"region" (country/region or "Global"), "date" (e.g. "Jul 2026"), ` +
    `"severity" (one of: Low, Medium, High), "opportunity" (max 18 words: a concrete product a PM ` +
    `could build to address it). Output must start with [ and end with ].`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // The model that worked in Claude's app, which doesn't think unless asked. An answer alone is
      // about 1,000 tokens (DEPLOYMENT.md, Known issues 2), so 1,000 was too tight; this is the server's cap.
      model: "claude-haiku-5-5",
      max_tokens: 16000,
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });
  if (!res.ok) throw new Error("http " + res.status);
  const data = await res.json();
  const arr = extractProblems(data);
  return arr.filter((p) => p && p.title).map((p) => normalize(cat, p));
}

function normalize(cat, p) {
  return {
    id: cat.key + ":" + slug(p.title),
    cat: cat.key,
    title: String(p.title).trim(),
    summary: String(p.summary || "").trim(),
    source: String(p.source || "—").trim(),
    link: /^https?:\/\//.test(String(p.link || "").trim()) ? String(p.link).trim() : "",
    region: String(p.region || "Global").trim(),
    date: String(p.date || "").trim(),
    severity: ["Low", "Medium", "High"].includes(p.severity) ? p.severity : "Medium",
    opportunity: String(p.opportunity || "").trim(),
  };
}

// Demo mode: hand back the saved sample for this category. The short, staggered
// pause only lets the progress list render; nothing is fetched.
async function replayCategory(sample, cat, i) {
  await new Promise((r) => setTimeout(r, 300 + i * 200));
  return sample.filter((p) => p && p.cat === cat.key && p.title).map((p) => normalize(cat, p));
}

const KEY_SEEN = "radar:seenIds";
const KEY_INDEX = "radar:history";
const KEY_LEGACY = "radar:lastSweep";
const KEY_ITEMS = "radar:items"; // each item's history (T36); the live board never reads it
const sweepKey = (id) => "radar:sweep:" + id;

// Each item's history (T36). `index` maps an id to { f: first sweep id, n: sweeps it was in, s: its latest
// sweep ids, e: 1 when it was seen before the index knew it, so f and n are lower bounds }. Returns the index
// for the ids in keepIds, and the items with firstAt, seen, prev (up to 5 earlier sweep ids) and firstEarlier.
// The same text is in api/_lib/radar.js; scripts/check.mjs fails if the two differ.
function trackItems(index, items, sweepId, keepIds) {
  const next = {};
  const out = items.map((it) => {
    const was = index[it.id];
    const ok = was && Number.isFinite(was.n) && Array.isArray(was.s);
    const e = ok
      ? { f: was.f, n: was.n + 1, s: [...was.s, sweepId].slice(-6), ...(was.e ? { e: 1 } : {}) }
      : { f: sweepId, n: 1, s: [sweepId], ...(it.isNew === false ? { e: 1 } : {}) };
    next[it.id] = e;
    const extra = e.e ? { firstEarlier: true } : {};
    return { ...it, firstAt: new Date(Number(e.f)).toISOString(), seen: e.n, prev: e.s.slice(0, -1), ...extra };
  });
  for (const id of keepIds) if (!next[id] && index[id]) next[id] = index[id];
  return { index: next, items: out };
}

// #p=<id> opens that problem's detail panel (T36).
function hashItemId() {
  const m = window.location.hash.match(/^#p=(.+)$/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch (e) { return null; }
}
function setHash(h) {
  try { window.history.replaceState(null, "", h || window.location.pathname + window.location.search); } catch (e) {}
}

// Claude's artifact runtime provides window.storage; a normal web page does not,
// so fall back to this browser's localStorage (same keys, under a demo prefix).
const LOCAL_PREFIX = "tpr-demo/";
// Read-only "remote" mode (the daily Vercel version): history is read from the server's
// /api/data feed and never written from the browser.
let REMOTE = null;
const store = {
  async get(key) {
    if (REMOTE !== null) {
      const r = await fetch(REMOTE + "?key=" + encodeURIComponent(key));
      if (r.status === 404) return null;
      // With the board locked (BOARD_PAYWALL), 401 is "sign in" and 402 is "Pro only".
      if (r.status === 401 || r.status === 402) throw Object.assign(new Error("locked"), { locked: r.status });
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }
    if (window.storage) return window.storage.get(key, false);
    const v = window.localStorage.getItem(LOCAL_PREFIX + key);
    return v == null ? null : { value: v };
  },
  async set(key, value) {
    if (REMOTE !== null) return;
    if (window.storage) return window.storage.set(key, value, false);
    window.localStorage.setItem(LOCAL_PREFIX + key, value);
  },
  async delete(key) {
    if (REMOTE !== null) return;
    if (window.storage) return window.storage.delete(key, false);
    window.localStorage.removeItem(LOCAL_PREFIX + key);
  },
};

async function loadJSON(key) {
  try { const r = await store.get(key); return r ? JSON.parse(r.value) : null; }
  catch (e) { if (e && e.locked) throw e; return null; }
}
async function saveJSON(key, val) {
  try { await store.set(key, JSON.stringify(val)); } catch (e) {}
}

// The item index from this browser's saved sweeps, oldest first: once, when there are sweeps but no index yet.
async function buildItemIndex(hist) {
  let index = {};
  for (const e of hist) {
    const sw = await loadJSON(sweepKey(e.id));
    if (!sw || !Array.isArray(sw.problems)) continue;
    const ids = sw.problems.map((p) => p.id);
    index = trackItems(index, sw.problems, e.id, [...Object.keys(index), ...ids]).index;
  }
  return index;
}

function groupByDay(entries) {
  const map = new Map();
  entries.forEach((e) => {
    const day = new Date(e.at).toDateString();
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(e);
  });
  return [...map.entries()];
}

// Pro's price line (T26). live/index.html has this meta tag only in a build where Pro is paid; otherwise
// the locked panels keep the "ask for Pro" wording.
const proPriceLine = () => {
  const m = typeof document !== "undefined" && document.querySelector('meta[name="tpr-pro-price"]');
  return m ? m.getAttribute("content") || "" : "";
};

export default function TravelProblemRadar({ sample, remote } = {}) {
  const demo = Array.isArray(sample);
  const live = typeof remote === "string"; // read-only view of the daily server sweep
  REMOTE = live ? remote : null;
  const [problems, setProblems] = useState([]);
  const [history, setHistory] = useState([]); // [{id, at, total, newCount, highCount}] oldest -> newest
  const [selId, setSelId] = useState(null);
  const [sweptAt, setSweptAt] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | scanning | done | error
  const [locked, setLocked] = useState(null); // 401 | 402 when the live board is for Pro only
  const [progress, setProgress] = useState({});
  const [view, setView] = useState("board"); // board | report | history
  const [fCat, setFCat] = useState("all");
  const [fSev, setFSev] = useState("all");
  const [fArea, setFArea] = useState("all"); // one of AREAS (T37)
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(() => new Set()); // category keys whose group is folded
  const [copied, setCopied] = useState(false);
  const seenRef = useRef(new Set());
  const [detail, setDetail] = useState(null); // the problem open in the detail panel (T36)
  const dlgRef = useRef(null);

  // The panel is a native <dialog>: showModal gives Esc to close, focus inside, the page behind inert,
  // and focus back on the Details button afterwards.
  useEffect(() => {
    const d = dlgRef.current;
    if (detail && d && !d.open) d.showModal();
  }, [detail]);
  useEffect(() => {
    const d = dlgRef.current;
    if (!d) return;
    const onClose = () => { setDetail(null); if (hashItemId()) setHash(""); };
    d.addEventListener("close", onClose);
    return () => d.removeEventListener("close", onClose);
  }, []);
  // A #p= link followed while the board is already open (firstLoad handles a fresh load).
  useEffect(() => {
    const onHash = () => { const want = hashItemId(); const it = want && problems.find((p) => p.id === want); if (it) setDetail(it); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [problems]);
  function openDetail(p) {
    setDetail(p);
    setHash("#p=" + encodeURIComponent(p.id));
  }
  const closeDetail = () => { if (dlgRef.current && dlgRef.current.open) dlgRef.current.close(); };

  const latestId = history.length ? history[history.length - 1].id : null;
  const isLatest = selId === latestId;

  useEffect(() => {
    (async () => {
      try { await firstLoad(); }
      catch (e) { if (e && e.locked) { setLocked(e.locked); setStatus("idle"); } }
    })();
  }, []);

  async function firstLoad() {
    // The live board only reads the server's sweeps: /api/data serves neither the seen ids nor the
    // pre-history sweep, so asking would only get a 400.
    if (!live) {
      const seen = await loadJSON(KEY_SEEN);
      if (Array.isArray(seen)) seenRef.current = new Set(seen);
    }

    let hist = await loadJSON(KEY_INDEX);
    hist = Array.isArray(hist) ? hist : [];

    // migrate a pre-history single sweep, if present
    if (hist.length === 0 && !live) {
      const legacy = await loadJSON(KEY_LEGACY);
      if (legacy && Array.isArray(legacy.problems) && legacy.problems.length) {
        const at = legacy.at || new Date().toISOString();
        const id = String(new Date(at).getTime());
        const p = legacy.problems;
        const entry = { id, at, total: p.length,
          newCount: p.filter((x) => x.isNew).length,
          highCount: p.filter((x) => x.severity === "High").length };
        await saveJSON(sweepKey(id), { at, problems: p });
        hist = [entry];
        await saveJSON(KEY_INDEX, hist);
      }
    }

    // demo/#report (the case study's "Sample digest" link) opens on the report
    const wantReport = demo && window.location.hash === "#report";

    if (hist.length) {
      setHistory(hist);
      const latest = hist[hist.length - 1];
      const full = await loadJSON(sweepKey(latest.id));
      if (full && Array.isArray(full.problems)) {
        setProblems(full.problems);
        setSelId(latest.id);
        setSweptAt(latest.at);
        setStatus("done");
        if (wantReport) setView("report");
        const want = hashItemId();
        const it = want && full.problems.find((p) => p.id === want);
        if (it) setDetail(it);
        return;
      }
    }
    if (wantReport) runSweep("report");
  }

  async function runSweep(nextView = "board") {
    setStatus("scanning");
    setView("board");
    setCopied(false);
    const init = {};
    CATS.forEach((c) => (init[c.key] = { state: "run", count: 0 }));
    setProgress(init);

    const seenBefore = new Set(seenRef.current);
    const results = await Promise.allSettled(
      CATS.map(async (c, i) => {
        try {
          const items = demo ? await replayCategory(sample, c, i) : await scanCategory(c);
          setProgress((p) => ({ ...p, [c.key]: { state: "done", count: items.length } }));
          return items;
        } catch (e) {
          setProgress((p) => ({ ...p, [c.key]: { state: "err", count: 0 } }));
          return [];
        }
      })
    );

    const merged = [];
    const idset = new Set();
    results.forEach((r) => {
      if (r.status === "fulfilled") {
        r.value.forEach((it) => {
          if (idset.has(it.id)) return;
          idset.add(it.id);
          merged.push({ ...it, isNew: !seenBefore.has(it.id) });
        });
      }
    });

    if (merged.length === 0) {
      setStatus(problems.length ? "done" : "error");
      return;
    }

    merged.sort((a, b) =>
      (b.isNew - a.isNew) || (SEV_RANK[b.severity] - SEV_RANK[a.severity])
    );

    const newCount = merged.filter((p) => p.isNew).length;
    const highCount = merged.filter((p) => p.severity === "High").length;
    const id = String(Date.now());
    const at = new Date().toISOString();
    const entry = { id, at, total: merged.length, newCount, highCount };

    let hist = [...history, entry];
    const drop = hist.slice(0, Math.max(0, hist.length - 60));
    hist = hist.slice(drop.length);

    // This sweep's ids go last, so an item that keeps coming back is never trimmed and shown as new again.
    const kept = [...[...seenBefore].filter((x) => !idset.has(x)), ...idset].slice(-800);

    // Each item's history (T36), kept for the same ids as the seen list.
    const idx0 = await loadJSON(KEY_ITEMS);
    const { index: itemIndex, items: saved } = trackItems(
      idx0 && typeof idx0 === "object" && !Array.isArray(idx0) ? idx0 : await buildItemIndex(history), merged, id, kept);

    // The new sweep and the index first: old files go only once nothing points at them.
    await saveJSON(sweepKey(id), { at, problems: saved });
    await saveJSON(KEY_INDEX, hist);
    await saveJSON(KEY_ITEMS, itemIndex);
    for (const d of drop) { try { await store.delete(sweepKey(d.id)); } catch (e) {} }

    setHistory(hist);
    setProblems(saved);
    setSelId(id);
    setSweptAt(at);
    setStatus("done");
    setView(nextView);

    seenRef.current = new Set(kept);
    await saveJSON(KEY_SEEN, kept);
  }

  async function openSweep(id) {
    let full;
    try { full = await loadJSON(sweepKey(id)); }
    catch (e) { if (e && e.locked) { setLocked(e.locked); setStatus("idle"); } return; }
    if (full && Array.isArray(full.problems)) {
      setProblems(full.problems);
      setSelId(id);
      const e = history.find((h) => h.id === id);
      setSweptAt(e ? e.at : full.at);
      setView("board");
      setFCat("all"); setFSev("all"); setFArea("all"); setQuery("");
    }
  }

  const busy = status === "scanning";
  const newCount = problems.filter((p) => p.isNew).length;
  const highCount = problems.filter((p) => p.severity === "High").length;

  // Every filter but the area, so each area's count is the cards that picking it would show (T37).
  const others = problems.filter((p) => {
    if (fCat !== "all" && p.cat !== fCat) return false;
    if (fSev !== "all" && p.severity !== fSev) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!(`${p.title} ${p.summary} ${p.opportunity}`.toLowerCase().includes(q))) return false;
    }
    return true;
  });
  const shown = fArea === "all" ? others : others.filter((p) => areaOf(p.region) === fArea);
  const areaCount = (list) => list.reduce((m, p) => m.set(areaOf(p.region), (m.get(areaOf(p.region)) || 0) + 1), new Map());
  const areaN = areaCount(others);
  const areaList = AREAS.filter((a) => areaN.get(a) || a === fArea);
  const showAreaTiles = areaCount(problems).size >= 2;
  const pickArea = (a) => setFArea((cur) => (cur === a ? "all" : a));
  // shown is already sorted (new first, then severity), so each group keeps that order
  const groups = CATS.map((c) => ({ c, items: shown.filter((p) => p.cat === c.key) })).filter((g) => g.items.length);
  const setGroupOpen = (key, open) => setCollapsed((s) => {
    const n = new Set(s);
    if (open) n.delete(key); else n.add(key);
    return n;
  });

  function buildReport() {
    const d = sweptAt ? new Date(sweptAt) : new Date();
    const lines = [];
    lines.push(`TRAVEL PROBLEM RADAR — DIGEST`);
    if (demo) {
      lines.push(`Demo replay ${d.toLocaleString()} of a saved sample sweep (items dated Jul 2026)`);
    } else {
      lines.push(`Swept ${d.toLocaleString()}`);
    }
    lines.push(`${problems.length} problems · ${newCount} new · ${highCount} high severity`);
    lines.push("");
    if (newCount) {
      lines.push(`== NEW SINCE LAST SWEEP (${newCount}) ==`);
      problems.filter((p) => p.isNew).forEach((p) => {
        lines.push(`• [${p.severity}] ${p.title}`);
        lines.push(`  ${p.summary}`);
        lines.push(`  ${p.source} · ${p.region} · ${p.date}`);
        if (p.link) lines.push(`  ${p.link}`);
        lines.push(`  OPPORTUNITY: ${p.opportunity}`);
        lines.push("");
      });
    }
    CATS.forEach((c) => {
      const items = problems.filter((p) => p.cat === c.key);
      if (!items.length) return;
      lines.push(`== ${c.label.toUpperCase()} (${items.length}) ==`);
      items.forEach((p) => {
        lines.push(`• [${p.severity}]${p.isNew ? " (NEW)" : ""} ${p.title}`);
        lines.push(`  ${p.summary}`);
        lines.push(`  ${p.source} · ${p.region} · ${p.date}`);
        if (p.link) lines.push(`  ${p.link}`);
        lines.push(`  OPPORTUNITY: ${p.opportunity}`);
        lines.push("");
      });
    });
    return lines.join("\n");
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(buildReport());
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    } catch (e) {}
  }

  const showStats = status === "done" && view !== "history";
  const showBanner = status === "done" && !isLatest && view !== "history";

  return (
    <div className="tpr">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="tpr-top">
        <div className="tpr-brand">
          <div className={"tpr-radar-mini" + (busy ? " spin" : "")} />
          <div className="tpr-title">
            <h1>TRAVEL PROBLEM <span>RADAR</span></h1>
            <p>Global opportunity feed</p>
          </div>
        </div>
        <div className="tpr-actions">
          {status === "done" && (
            <div className="tpr-tabs">
              <button className={"tpr-tab" + (view === "board" ? " on" : "")} onClick={() => setView("board")}>Board</button>
              <button className={"tpr-tab" + (view === "report" ? " on" : "")} onClick={() => setView("report")}>Report</button>
              <button className={"tpr-tab" + (view === "history" ? " on" : "")} onClick={() => setView("history")}>History</button>
            </div>
          )}
          {sweptAt && <div className="tpr-swept">{demo ? "Last replayed" : live ? "Updated 1 to 5 times a day · last sweep" : "Last swept"}<br /><b>{new Date(sweptAt).toLocaleString()}</b></div>}
          {!live && (
            <button className={"tpr-sweep-btn" + (busy ? " busy" : "")} onClick={() => runSweep()} disabled={busy}>
              <span className="dot" />
              {demo ? (busy ? "Replaying…" : "Replay sample sweep") : (busy ? "Sweeping…" : "Run sweep")}
            </button>
          )}
        </div>
      </div>

      {showBanner && (
        <div className="tpr-banner">
          <span>Viewing an archived sweep from <b>{new Date(sweptAt).toLocaleString()}</b>.</span>
          <button onClick={() => openSweep(latestId)}>Back to latest</button>
        </div>
      )}

      {showStats && (
        <div className="tpr-stats">
          <div className="tpr-stat"><div className="n">{problems.length}</div><div className="l">Problems tracked</div></div>
          <div className="tpr-stat pink"><div className="n">{newCount}</div><div className="l">New this sweep</div></div>
          <div className="tpr-stat amber"><div className="n">{highCount}</div><div className="l">High severity</div></div>
          <div className="tpr-stat lime"><div className="n">{history.length}</div><div className="l">Sweeps archived</div></div>
        </div>
      )}

      {status === "done" && view === "board" && showAreaTiles && (
        <div className="tpr-areas" role="group" aria-label="Areas">
          {areaList.map((a) => (
            <button key={a} className={"tpr-area" + (fArea === a ? " on" : "")} aria-pressed={fArea === a} onClick={() => pickArea(a)}>
              <span className="n">{areaN.get(a) || 0}</span>
              <span className="l">{a}</span>
            </button>
          ))}
        </div>
      )}

      {status === "done" && view === "board" && (
        <div className="tpr-filters">
          <div className="tpr-chips" role="group" aria-label="Category">
            <button className={"tpr-chip" + (fCat === "all" ? " on" : "")} aria-pressed={fCat === "all"} onClick={() => setFCat("all")}>All</button>
            {CATS.map((c) => (
              <button key={c.key} className={"tpr-chip" + (fCat === c.key ? " on" : "")} aria-pressed={fCat === c.key} onClick={() => { setFCat(c.key); setGroupOpen(c.key, true); }}>
                <span className="c" style={{ background: c.color }} />{c.label}
              </button>
            ))}
          </div>
          <div className="tpr-chips tpr-area-chips" role="group" aria-label="Area">
            <button className={"tpr-chip" + (fArea === "all" ? " on" : "")} aria-pressed={fArea === "all"} onClick={() => setFArea("all")}>All areas</button>
            {areaList.map((a) => (
              <button key={a} className={"tpr-chip" + (fArea === a ? " on" : "")} aria-pressed={fArea === a} onClick={() => pickArea(a)}>
                {a} <span className="k">{areaN.get(a) || 0}</span>
              </button>
            ))}
          </div>
          <div className="tpr-chips" role="group" aria-label="Severity">
            {["all", "High", "Medium", "Low"].map((s) => (
              <button key={s} className={"tpr-chip" + (fSev === s ? " on" : "")} aria-pressed={fSev === s} onClick={() => setFSev(s)}>
                {s === "all" ? "Any severity" : s}
              </button>
            ))}
          </div>
          <input className="tpr-search" placeholder="Search problems & angles…"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}

      {/* board */}
      {status === "done" && view === "board" && (
        <div className="tpr-groups">
          {groups.map(({ c, items }) => {
            const open = !collapsed.has(c.key);
            const nNew = items.filter((p) => p.isNew).length;
            const nHigh = items.filter((p) => p.severity === "High").length;
            const id = "tpr-group-" + c.key;
            return (
              <section className="tpr-group" key={c.key} aria-labelledby={id + "-h"} style={{ "--cat": c.color }}>
                <div className="tpr-group-head">
                  <span className="dot" aria-hidden="true" />
                  <div className="tpr-group-title">
                    <h2 id={id + "-h"}>{c.label}</h2>
                    <p>{c.desc[0].toUpperCase() + c.desc.slice(1)}</p>
                  </div>
                  <span className="tpr-group-count">
                    {items.length} {items.length === 1 ? "problem" : "problems"}
                    {nNew > 0 && ` · ${nNew} new`}
                    {nHigh > 0 && ` · ${nHigh} high`}
                  </span>
                  <button className="tpr-group-toggle" aria-expanded={open} aria-controls={id}
                    onClick={() => setGroupOpen(c.key, !open)}>
                    <span className="chev" aria-hidden="true">▾</span>{open ? "Hide" : "Show"}
                    <span className="tpr-sr"> {c.label}</span>
                  </button>
                </div>
                <div className="tpr-board" id={id} hidden={!open}>
                  {items.map((p) => (
                    <div className="tpr-card" key={p.id}>
                      {p.isNew && (
                        <div className="tpr-card-top">
                          <span className="tpr-new">New</span>
                        </div>
                      )}
                      <h3>{p.title}</h3>
                      {p.summary && <p className="tpr-summary">{p.summary}</p>}
                      <div className="tpr-meta">
                        {p.link
                          ? <a className="tpr-tag tpr-src" href={p.link} target="_blank" rel="noopener noreferrer">{p.source} ↗</a>
                          : <span className="tpr-tag">{p.source}</span>}
                        <span className="tpr-tag">{p.region}</span>
                        {p.date && <span className="tpr-tag">{p.date}</span>}
                        <span className={"tpr-tag tpr-sev " + p.severity}>{p.severity}</span>
                        {p.seen > 1 && <span className="tpr-tag tpr-seen">Seen in {p.seen}{p.firstEarlier ? "+" : ""} sweeps</span>}
                      </div>
                      {p.opportunity && (
                        <div className="tpr-opp">
                          <span className="lab">Opportunity</span>
                          <p>{p.opportunity}</p>
                        </div>
                      )}
                      <button className="tpr-more" type="button" onClick={() => openDetail(p)}>
                        Details<span className="tpr-sr">: {p.title}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
          {shown.length === 0 && (
            <div className="tpr-note">No problems match these filters.</div>
          )}
        </div>
      )}

      {/* report */}
      {status === "done" && view === "report" && (
        <div className="tpr-report">
          <div className="tpr-report-bar">
            <h2>Digest — {new Date(sweptAt || Date.now()).toLocaleDateString()}</h2>
            <button className="tpr-copy" onClick={copyReport}>{copied ? "Copied ✓" : "Copy report"}</button>
          </div>
          <pre>{buildReport()}</pre>
        </div>
      )}

      {/* history */}
      {status === "done" && view === "history" && (
        <div className="tpr-hist">
          {history.length === 0 && <div className="tpr-note">No sweeps archived yet.</div>}
          {groupByDay([...history].reverse()).map(([day, entries]) => (
            <div className="tpr-hist-day" key={day}>
              <h4>{day}</h4>
              {entries.map((e) => (
                <div className={"tpr-hrow" + (e.id === selId ? " cur" : "")} key={e.id}>
                  <span className="tpr-htime">
                    {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <div className="tpr-hcounts">
                    <span className="tpr-hc">{e.total} problems</span>
                    <span className="tpr-hc new">{e.newCount} new</span>
                    <span className="tpr-hc high">{e.highCount} high</span>
                  </div>
                  {e.id === selId ? (
                    <span className="tpr-hview cur">Viewing</span>
                  ) : (
                    <button className="tpr-hview" onClick={() => openSweep(e.id)}>Open</button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* empty / scanning / error */}
      {(status === "idle" || status === "scanning" || status === "error") && (
        <div className="tpr-empty">
          <div className={"tpr-radar-big" + (busy ? " spin" : "")} />
          {status === "error" ? (
            <>
              <h2>The sweep came back empty</h2>
              <p>Sources didn’t return usable results this time. Give it another run — the scan pulls fresh each time.</p>
            </>
          ) : status === "scanning" ? (
            <>
              <h2>{demo ? "Replaying the saved sample…" : "Sweeping global sources…"}</h2>
              <p>{demo
                ? "Loading the 8 saved items, two per problem type. Nothing is searched live in this demo."
                : "Scanning news, government sites, travel platforms and forums across all four problem types."}</p>
              <div className="tpr-progress">
                {CATS.map((c) => {
                  const pr = progress[c.key] || { state: "run", count: 0 };
                  const cls = pr.state === "done" ? "done" : pr.state === "err" ? "err" : "run";
                  return (
                    <div className={"tpr-prow " + cls} key={c.key}>
                      <span className="ic" />{c.label}
                      <span className="cnt">
                        {pr.state === "done" ? pr.count + " found" : pr.state === "err" ? "no data" : "scanning"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            live && locked === 401 ? (
              <>
                <h2>The board is for Pro members</h2>
                {proPriceLine() ? (
                  <p>Sign in to read the live board. Pro is {proPriceLine()}</p>
                ) : (
                  <p>Sign in to read the live board. New here? Create an account, then ask for Pro on your account page.</p>
                )}
                <p className="tpr-locked-actions">
                  <a className="tpr-hview cur" href="../signin/">Sign in</a>
                  {proPriceLine() ? (
                    <a className="tpr-hview" href="../pricing/">Get Pro</a>
                  ) : (
                    <a className="tpr-hview" href="../signup/">Create account</a>
                  )}
                </p>
                <p>or <a href="../demo/" style={{ color: "inherit" }}>try the sample demo</a></p>
              </>
            ) : live && locked === 402 ? (
              <>
                <h2>The live board is part of Pro</h2>
                <p>You’re signed in on the Free plan, which gets the daily email digest. Pro adds this live board and 1 to 5 emails a day.{proPriceLine() ? " It’s " + proPriceLine() : ""}</p>
                <p className="tpr-locked-actions">
                  <a className="tpr-hview cur" href="../manage/">{proPriceLine() ? "Go to your account" : "Request Pro"}</a>
                </p>
                <p>or <a href="../demo/" style={{ color: "inherit" }}>try the sample demo</a></p>
              </>
            ) : live ? (
              <>
                <h2>The first sweep hasn’t run yet</h2>
                <p>This page shows the result of an automatic sweep that runs 1 to 5 times a day. Nothing has been saved yet, so there is nothing to show. In the meantime, <a href="../demo/" style={{ color: "inherit" }}>try the sample demo</a>.</p>
              </>
            ) : demo ? (
              <>
                <h2>Radar’s ready (demo)</h2>
                <p>This demo replays a saved sweep: 8 travel problems from July 2026, two per category, each with its source link and a product angle. It doesn’t search the web or call any AI model.</p>
              </>
            ) : (
              <>
                <h2>Radar’s ready</h2>
                <p>Run a sweep to pull the latest travel problems from around the world — booking gripes, visa changes, platform outages and industry shocks — each tagged with a product angle worth building. Every run is saved by date.</p>
              </>
            )
          )}
        </div>
      )}

      {status === "done" && (
        <div className="tpr-note">
          {live
            ? "Live: an automatic sweep runs 1 to 5 times a day and every visitor sees the latest saved result. Items are gathered by an AI model with web search, so check each source link. Items unseen in any earlier sweep are flagged New."
            : demo
            ? "Demo: replays a saved July 2026 sample and keeps history in this browser only. Replay it again and nothing is flagged New, because every item was already seen."
            : "Every run is archived by date — open History to revisit past sweeps. Items unseen in any prior sweep are flagged New."}
        </div>
      )}

      {/* detail panel (T36); a click on the backdrop closes it */}
      <dialog className="tpr-dlg" ref={dlgRef} aria-labelledby="tpr-dlg-h"
        onClick={(e) => { if (e.target === e.currentTarget) closeDetail(); }}>
        {detail && (
          <div className="tpr-dlg-in" style={{ "--cat": (CATS.find((c) => c.key === detail.cat) || CATS[0]).color }}>
            <div className="tpr-dlg-top">
              {detail.isNew && <span className="tpr-new">New</span>}
              <span className="tpr-dlg-cat">{(CATS.find((c) => c.key === detail.cat) || { label: "" }).label}</span>
              <button className="tpr-dlg-x" type="button" onClick={closeDetail} aria-label="Close">×</button>
            </div>
            <h2 id="tpr-dlg-h">{detail.title}</h2>
            {detail.summary && <p className="tpr-summary">{detail.summary}</p>}
            <div className="tpr-meta">
              {detail.link
                ? <a className="tpr-tag tpr-src" href={detail.link} target="_blank" rel="noopener noreferrer">{detail.source} ↗</a>
                : <span className="tpr-tag">{detail.source}</span>}
              <span className="tpr-tag">{detail.region}</span>
              {detail.date && <span className="tpr-tag">{detail.date}</span>}
              <span className={"tpr-tag tpr-sev " + detail.severity}>{detail.severity}</span>
            </div>
            {detail.opportunity && (
              <div className="tpr-opp">
                <span className="lab">Opportunity</span>
                <p>{detail.opportunity}</p>
              </div>
            )}
            {detail.seen ? (
              <div className="tpr-dlg-hist">
                <h3>History</h3>
                <p>
                  First seen <b>{new Date(detail.firstAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}</b>
                  {detail.firstEarlier ? " or earlier" : ""} · in {detail.seen}{detail.firstEarlier ? " or more" : ""}
                  {detail.seen === 1 && !detail.firstEarlier ? " sweep" : " sweeps"}
                </p>
                {Array.isArray(detail.prev) && detail.prev.length > 0 && (
                  <ul aria-label="Earlier sweeps with this problem">
                    {[...detail.prev].reverse().map((pid) => (
                      <li key={pid}>
                        <span>{new Date(Number(pid)).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                        {history.some((h) => h.id === pid)
                          ? <button className="tpr-hview" type="button" onClick={() => { closeDetail(); openSweep(pid); }}>Open</button>
                          : <span className="tpr-dlg-gone">No longer kept</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="tpr-dlg-none">This sweep was saved before the board kept each problem’s history.</p>
            )}
          </div>
        )}
      </dialog>
    </div>
  );
}
