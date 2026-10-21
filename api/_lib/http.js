// Small HTTP helpers shared by the endpoints (docs/subscriptions/tasks/T03): JSON replies, a
// bearer-token check, the request body, and the plain HTML pages the confirm and unsubscribe
// links answer with. Nothing here imports anything.
import { timingSafeEqual } from "node:crypto";

export const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const sendJson = (res, code, body) => {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
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

const PAGE_CSS = `html,body{margin:0;background:#0B0B0D;color:#F4F4F7}
body{font:16px/1.55 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:0 16px}
main{max-width:520px;margin:0 auto;padding:48px 0}
h1{font-size:22px;margin:0 0 12px}
p{margin:0 0 14px;color:#C9C9D2}
a{color:#C6FF3D}
button{font:inherit;font-weight:600;background:#C6FF3D;color:#0B0B0D;border:0;border-radius:6px;padding:10px 18px;cursor:pointer}
button:hover{background:#d8ff6f}
small{color:#93939F}`;

// A minimal HTML page. `title` is escaped here. `body` is HTML the caller built, so every value
// that came from a request must already have gone through esc(). The page is never cached or
// indexed, and sends no Referer, because the links that lead here carry tokens.
export function sendPage(res, code, { title, body }) {
  res.statusCode = code;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-robots-tag", "noindex");
  res.setHeader("referrer-policy", "no-referrer");
  res.end(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
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
