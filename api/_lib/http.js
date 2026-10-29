// Small HTTP helpers shared by the endpoints (docs/subscriptions/tasks/T03): JSON replies, a
// bearer-token check, the request body, and the plain HTML pages the confirm and unsubscribe
// links answer with. Nothing here imports anything.
import { timingSafeEqual } from "node:crypto";

export const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// `headers` are set last, before the body is sent (a header set after end() throws).
export const sendJson = (res, code, body, headers = {}) => {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
};

export function bearerOk(header, secret) {
  if (!secret || !header) return false;
  const want = Buffer.from("Bearer " + secret);
  const got = Buffer.from(String(header));
  return got.length === want.length && timingSafeEqual(got, want);
}

// Answers 405 with an Allow header and returns false when the method isn't in the list.
export function allowMethods(req, res, list) {
  if (list.includes(req.method)) return true;
  res.setHeader("allow", list.join(", "));
  sendJson(res, 405, { error: "method not allowed" });
  return false;
}

export class BodyTooLargeError extends Error {
  constructor(limit) {
    super(`request body is over ${limit} bytes`);
    this.name = "BodyTooLargeError";
    this.statusCode = 413;
  }
}

const bodyLength = (b) => (Buffer.isBuffer(b) ? b.length : Buffer.byteLength(b));

// The raw body as a string. Uses req.body if the platform already read it (a string, a Buffer, or
// an object it parsed, which comes back as JSON text), otherwise reads the stream. Stops at
// `limit` bytes and throws BodyTooLargeError, so the caller can answer 413.
export async function readBody(req, { limit = 8192 } = {}) {
  const pre = req.body;
  if (pre !== undefined && pre !== null) {
    const text = Buffer.isBuffer(pre) ? pre.toString("utf8") : typeof pre === "string" ? pre : JSON.stringify(pre);
    if (bodyLength(text) > limit) throw new BodyTooLargeError(limit);
    return text;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limit) {
      if (typeof req.destroy === "function") req.destroy();
      throw new BodyTooLargeError(limit);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// JSON or form-encoded text to a plain object. Anything else, or malformed text, gives {}.
export function parseForm(raw, contentType = "") {
  const type = String(contentType).split(";")[0].trim().toLowerCase();
  try {
    if (type === "application/json") {
      const v = JSON.parse(raw);
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    }
    if (type === "application/x-www-form-urlencoded") return Object.fromEntries(new URLSearchParams(raw));
  } catch (e) { /* malformed: fall through */ }
  return {};
}

// The request's fields as an object. A body the platform already parsed into an object is used
// as it is; otherwise the text is read (up to `limit`) and parsed by content type.
export async function readFields(req, { limit = 8192 } = {}) {
  const pre = req.body;
  if (pre && typeof pre === "object" && !Buffer.isBuffer(pre)) {
    if (bodyLength(JSON.stringify(pre)) > limit) throw new BodyTooLargeError(limit);
    return pre;
  }
  return parseForm(await readBody(req, { limit }), req.headers && req.headers["content-type"]);
}

// The brand colors from brand.css, inline so the page needs no other file. No web font: these
// pages are reached by links that carry tokens, so they load nothing from another site. Dark mode
// is light-dark(), not a media query: the tests require that no page holds an "@" (no address). Each
// light-dark() follows a plain light value, which a browser without light-dark() keeps.
const PAGE_CSS = `:root{color-scheme:light dark}
html,body{margin:0;background:#f6f9f8;background:light-dark(#f6f9f8,#0c1816);color:#0f2924;color:light-dark(#0f2924,#ecf3f2)}
body{font:16px/1.55 'Inter Tight',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;padding:0 16px}
main{max-width:520px;margin:0 auto;padding:48px 0}
h1{font-size:22px;margin:0 0 12px}
p{margin:0 0 14px;color:#2f4a45;color:light-dark(#2f4a45,#c9d6d4)}
a{color:#1d4e45;color:light-dark(#1d4e45,#5fbfa9)}
button{font:inherit;font-weight:600;background:#1d4e45;background:light-dark(#1d4e45,#1e5248);color:#f6f9f8;color:light-dark(#f6f9f8,#ecf3f2);border:0;border-radius:6px;padding:10px 18px;cursor:pointer}
button:hover{background:#163d36;background:light-dark(#163d36,#25665a)}
small{color:#516763;color:light-dark(#516763,#a4b7b4)}
dl.item{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0 0 18px;padding:14px 16px;border:1px solid #d5e0de;border:1px solid light-dark(#d5e0de,#24403b);border-radius:8px;overflow-wrap:anywhere}
dl.item dt{color:#516763;color:light-dark(#516763,#a4b7b4);font-size:14px}
dl.item dd{margin:0}`;

// A minimal HTML page. `title` is escaped here. `body` is HTML the caller built, so every value
// that came from a request must already have gone through esc(). The page is never cached or
// indexed, and sends no Referer to other sites, because the links that lead here carry tokens. Not
// "no-referrer": with it, a form posted from the page (the sign-in button) carries Origin: null, and
// originOk refuses that. "same-origin" sends the real Origin to this site and nothing to others.
// `meta` adds head tags, as [{ property | name, content }] (the Open Graph and Twitter tags of a
// shared problem, T40); each value is escaped here.
export function sendPage(res, code, { title, body, meta = [] }) {
  res.statusCode = code;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-robots-tag", "noindex");
  res.setHeader("referrer-policy", "same-origin");
  res.end(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
${meta.map((m) => `<meta ${m.property ? `property="${esc(m.property)}"` : `name="${esc(m.name)}"`} content="${esc(m.content)}">\n`).join("")}<title>${esc(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
${body}
</main>
</body>
</html>
`);
}
